import { mountSpeech, stopSpeech } from './office-speech.mjs?v=1';
import { runSlashAction } from './office-slash-actions.mjs?v=1';
import {paintContext,contextJobForDisplay} from './office-context.mjs?v=3';
import { mountSlash } from './office-slash.mjs?v=claude-context-1';
import { latestConversationTurns } from './office-threads.mjs?v=2';
import { attachmentControls } from './office-attachments.mjs?v=4';
import { cliFeatures } from './office-cli.mjs?v=workspace-history-1';
import { renderAnswer } from './office-markdown.js?v=2';
import { deletePassword } from './office-delete.mjs?v=2';
import { renameConversation } from './office-rename.mjs?v=1';
import { accountsOf, handoffOptions, executionAccountLabel, conversationExecutionLabel, accountCommandTarget, accountRemovalTarget, subscriptionPresentation, sharedCreditAccounts, isVpsExecutor, localMachines } from './office-accounts.mjs?v=4';

const $ = id => document.getElementById(id);
const make = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};

if (location.protocol === 'file:') {
  const note = document.querySelector('.demo-note p');
  note.replaceChildren(document.createTextNode('Đây là bản xem tĩnh. Để giao việc cho AI thật, mở '));
  const link = make('a', '', 'Văn phòng AI trên server');
  link.href = 'http://127.0.0.1:3010/ai-office/';
  note.append(link, document.createTextNode(' và đăng nhập.'));
} else {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './office-live.css?v=31';
  document.head.append(css);

  let jobs = [];
  let capabilities = null;
  let busy = false;
  let jobsSignature = '';
  let displayedResultId = null;
  let followupSpeech = null;
  let startNewChat = () => {};
  const openPlans = new Set();
  const assigned = { sales: [2], product: [6], video: [5], technical: [7], research: [1], design: [4], general: [3] };
  const running = () => jobs.find(job => job.status === 'running');
  window.mocOfficeLive = {
    selected: 0,
    currentKind() { return running()?.kind; },
    snapshot() { return { jobs, capabilities }; },
    openJob(id) { const job = jobs.find(item => item.id === id); if (job) openResult(job); },
    isBusy(index) { return jobs.some(job => job.status === 'running' &&
      (index === 0 || index === (assigned[job.kind] || assigned.general)[0])); },
    updateAgentStatus(index) {
      this.selected = index;
      const job = running();
      const selectedBusy = this.isBusy(index);
      $('agent-status').textContent = selectedBusy ? 'Đang làm' : 'Sẵn sàng';
      $('agent-current').textContent = selectedBusy
        ? (index === 0 ? `Bạn đang điều phối: ${job.question}` : job.question)
        : 'Chờ công việc tiếp theo từ bạn ✨';
      $('done-count').textContent = String(jobs.filter(item => item.status === 'done').length).padStart(2, '0');
      document.querySelectorAll('.agent-label').forEach((label, i) => label.classList.toggle('busy', this.isBusy(i)));
      $('working-count').textContent = String(window.mocOfficeCrew?.working() ?? 0).padStart(2, '0');
    },
  };

  const plainStatus = { waiting: 'Đang chờ', pending: 'Đang xếp hàng', running: 'Đang chạy', done: 'Đã xong', error: 'Lỗi' };
  const statusLabel = status => { const node=make('span','live-status',plainStatus[status]||status);node.dataset.status=status;return node; };
  const statusText = { waiting: 'Chờ phần trước / máy rảnh', pending: 'Đang xếp hàng', running: 'AI đang xử lý', done: 'Đã có kết quả', error: 'Cần thử lại' };
  const kindText = { sales: 'Doanh thu', product: 'Sản phẩm', video: 'Video', technical: 'Kỹ thuật', research: 'Nghiên cứu', design: 'Thiết kế', general: 'Việc khác' };
  const setNote = message => { document.querySelector('.demo-note p').textContent = message; };
  const showModal = id => { $(id).hidden = false; document.body.style.overflow = 'hidden'; };
  const hideModal = id => { $(id).hidden = true; document.body.style.overflow = ''; };
  async function api(path, options = {}) {
    const response = await fetch(`/api/ai-office${path}`, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && !/mật khẩu/i.test(data.error || '')) { window.mocOfficeSessionExpired?.(); throw new Error('Phiên đăng nhập đã hết hạn'); }
    if (!response.ok || !data.success) { const error=new Error(data.error || `Lỗi HTTP ${response.status}`);error.status=response.status;throw error; }
    return data.data;
  }
  const mountAttachments=attachmentControls({api,make,enabled:()=>!!capabilities?.fileAccess});
  const cli=cliFeatures({api,make,renderAnswer,capabilities:()=>capabilities,visibleId:()=>displayedResultId,contextJob:job=>contextJobForDisplay(job,jobs)});
  const routingText = value => String(value || '').replace(/(^|[→·]\s*|Bàn giao từ )(?:An|Linh|Minh|Mai|Bông|Nam|Hà|Tú)(?=\s|$)/g, '$1AI');
  const providerName = provider => provider === 'codex' ? 'Codex' : 'Claude';
  // Default to the Windows machine that holds the video pipeline, then any online local worker, never the legacy VPS group.
  const preferredMachine = caps => { const machines = localMachines(caps || {}); const windows = machine => (machine.profile?.platform || machine.policy?.declaredPlatform) === 'win32';
    return machines.find(machine => machine.online && windows(machine)) || machines.find(machine => machine.online) || machines[0]; };
  const machineLabel = machine => `${machine.name} · ${{linux:'Linux',win32:'Windows',darwin:'macOS'}[machine.profile?.platform || machine.policy?.declaredPlatform] || 'chưa rõ OS'} · ${machine.online ? 'đang online' : 'offline'}`;
  const executorName = executor => isVpsExecutor(executor) ? 'VPS' :
    localMachines(capabilities || {}).find(machine => machine.id === executor || machine.members?.some(member => member.id === executor))?.name || 'Máy local';

  async function runOfficeSlash(command,args,job,control,show){
    return runSlashAction(command,args,{api,job,make,show,openJob:openResult,refresh,
      close:()=>{hideModal('result-modal');hideModal('task-modal')},
      model:async value=>{
        if(!control)throw new Error('Chưa có ô chọn model');
        const parts=value.trim().split(/\s+/).filter(Boolean);
        if(parts.length>2)throw new Error('Dùng /model [model-id] [effort]');
        if(parts[0]){
          if(![...control.model.options].some(o=>o.value===parts[0]&&!o.disabled))throw new Error('Model không nằm trong tài khoản/provider đang chọn');
          control.model.value=parts[0];control.model.dispatchEvent(new Event('change'));
        }
        if(parts[1]){
          if(![...control.effort.options].some(o=>o.value===parts[1]))throw new Error('Effort không được model hỗ trợ');
          control.effort.value=parts[1];
        }
        const details=control.model.closest('details');if(details)details.open=true;
        control.model.focus();
      },
      usage:()=>{hideModal('result-modal');hideModal('task-modal');renderQuotaOverview();const overview=$('live-quota-overview');overview.open=true;overview.scrollIntoView({block:'start',behavior:'smooth'})},
      rename:async value=>{
        const save=async name=>{const changed=await api(`/tasks/${job.id}/rename`,{method:'POST',body:JSON.stringify({name})});jobsSignature='';await refresh();openResult(changed)};
        if(value)await save(value);else renameConversation(job.conversationName||job.question,save);
      },
      remove:async()=>{
        const password=await deletePassword('Xóa luồng công việc?','Xóa lịch sử và kết quả trong app. Không xóa tệp dự án Drive hay hồ sơ CLI trên máy xử lý.');
        if(password===null)return;
        await api(`/tasks/${job.id}`,{method:'DELETE',body:JSON.stringify({password})});hideModal('result-modal');displayedResultId=null;jobsSignature='';await refresh();
      },
      logout:async()=>{
        const all=[...accountsOf(capabilities,'vps'),...localMachines(capabilities).flatMap(m=>accountsOf(capabilities,m.id))];
        const account=all.find(a=>a.id===job.selection?.accountId)||all.find(a=>a.workerId===job.executor&&a.provider===job.provider);
        if(!account)throw new Error('Không xác định được tài khoản AI của phiên');
        const password=await deletePassword('Gỡ tài khoản AI khỏi máy?','Gỡ '+(account.label||account.id)+' khỏi máy xử lý. Không hủy gói, giữ lịch sử. Hệ thống từ chối nếu tài khoản còn đang chạy việc.',{submitText:'Gỡ tài khoản'});
        if(password===null)return;
        await api('/accounts/remove',{method:'POST',body:JSON.stringify({...accountRemovalTarget(account),password,confirm:true})});show('Đã gửi yêu cầu gỡ tài khoản; xem trạng thái trong Hạn mức.');await refreshMachines();
      },
    });
  }

  function renderJobs() {
    const list = $('task-list');
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    const latest=latestConversationTurns(jobs);
    $('task-dot').style.display = jobs.some(job => ['pending', 'running'].includes(job.status)) ? 'block' : 'none';
    if (!jobs.length) list.append(make('div', 'empty-tasks', 'Chưa có công việc. Hãy giao một câu hỏi để AI bắt đầu.'));
    const diffText = { easy: 'Dễ · model nhẹ', medium: 'Vừa · model chuẩn', hard: 'Khó · model mạnh' };
    const children = new Map();
    for (const job of jobs) if (job.planId && job.planId !== job.id && jobs.some(p => p.id === job.planId)) {
      if (!children.has(job.planId)) children.set(job.planId, []);
      children.get(job.planId).push(job);
    }
    const nested = new Set([...children.values()].flat().map(job => job.id));
    const retryButton = job => {
      const retry = make('button', 'live-result-button', 'Thử lại phần này ↻'); retry.type = 'button';
      retry.onclick = async event => {
        event.stopPropagation(); retry.disabled = true;
        try { await api(`/tasks/${job.id}/retry`, { method: 'POST' }); notify('Đã đưa phần lỗi vào hàng chờ lại.'); await refresh(); }
        catch (error) { notify(error.message); retry.disabled = false; }
      };
      return retry;
    };
    const deleteButton = job => {
      const button = make('button', 'live-delete-button', 'Xóa luồng'); button.type = 'button';
      button.onclick = async event => {
        event.stopPropagation();
        const password = await deletePassword('Xóa luồng công việc?', 'Xóa toàn bộ lượt trao đổi và kết quả trong luồng này khỏi Văn phòng AI. Tệp đã lưu trong dự án Drive sẽ được giữ cho tới khi bạn xóa dự án.');
        if (password === null) return;
        button.disabled = true;
        try {
          await api(`/tasks/${job.id}`, { method:'DELETE', body:JSON.stringify({ password }) });
          if (displayedResultId === job.id && !$('result-modal').hidden) hideModal('result-modal');
          displayedResultId = null; jobsSignature = '';
          await refresh(); notify('Đã xóa luồng công việc.');
        } catch (error) { notify(error.message); button.disabled = false; }
      };
      return button;
    };
    const sqlTime = value => value ? Date.parse(String(value).replace(' ', 'T') + 'Z') : NaN;
    const duration = ms => !Number.isFinite(ms) || ms < 0 ? '' : ms < 60000 ? `${Math.round(ms / 1000)} giây` : `${Math.floor(ms / 60000)} phút ${Math.round(ms % 60000 / 1000)} giây`;
    const shortModel = id => ((capabilities.models || []).find(m => m.id === id)?.label || id || '').replace(/^Claude /, '').replace(/^GPT-/, 'GPT ');
    const levelChip = { easy: ['Dễ', 'is-easy'], medium: ['Vừa', 'is-medium'], hard: ['Khó', 'is-hard'] };
    const stepIcon = { done: '✓', error: '!', running: '◐', pending: '…', waiting: '○' };
    const tokensOf = list => list.reduce((sum, j) => sum + (j.execution?.usage ? (j.execution.usage.input || 0) + (j.execution.usage.output || 0) : 0), 0);
    const kTokens = n => n >= 1000 ? `${Math.round(n / 1000)}k token` : `${n} token`;
    const reviewText = text => /KẾT LUẬN:\s*CẦN SỬA/i.test(text || '') ? 'đã sửa lỗi' : /KẾT LUẬN:\s*ĐẠT/i.test(text || '') ? 'đạt' : '';
    const renderTeam = (plan, item) => {
      const subs = (children.get(plan.id) || []).sort((a, b) => (a.teamRole === 'merge') - (b.teamRole === 'merge') || (a.part?.index || 0) - (b.part?.index || 0));
      const steps = subs.filter(j => j.teamRole === 'step');
      const merge = subs.find(j => j.teamRole === 'merge');
      const final = plan.part?.self ? plan : merge || (steps.length === 1 ? steps[0] : null);
      const tokens = tokensOf([plan, ...subs]);
      const doneCount = steps.filter(j => j.status === 'done').length;
      const failed = subs.some(j => j.status === 'error') || plan.status === 'error';
      const finished = final?.status === 'done';
      const status = make('div', `team-status live-status ${finished ? 'is-done' : failed ? 'is-error' : 'is-running'}`);
      status.dataset.status=finished?'done':failed?'error':['waiting','pending'].includes(plan.status)?plan.status:'running';
      if (!subs.length && !(plan.part?.self && finished)) status.textContent = plan.status === 'error' ? '! Chưa chia được việc — bấm Thử lại' : '◐ Đang chia việc…';
      if (plan.part?.self && finished) status.textContent = `✓ Xong · Một AI hoàn thành, không cần chia · ${duration(sqlTime(plan.finishedAt) - sqlTime(plan.startedAt))}${tokens ? ` · ${kTokens(tokens)}` : ''}`;
      else if (finished) status.textContent = `✓ Xong · ${duration(sqlTime(final.finishedAt) - sqlTime(plan.startedAt || plan.createdAt))}${tokens ? ` · ${kTokens(tokens)}` : ''}`;
      else if (failed) status.textContent = '! Có phần chưa làm được — bấm Thử lại';
      else status.textContent = merge?.status === 'running' ? '◐ Đang viết bản cuối…' : `◐ Đang làm ${doneCount}/${steps.length} phần`;
      item.append(status);
      if (!finished && !failed) {
        const stop = make('button', 'soft-button live-stop', 'Dừng nhóm'); stop.type = 'button';
        stop.onclick = async event => {
          event.stopPropagation(); stop.disabled = true;
          try { await api(`/tasks/${plan.id}/stop`, { method:'POST' }); await refresh(); }
          catch (error) { notify(error.message); stop.disabled = false; }
        };
        item.append(stop);
      }
      if (steps.length > 1 && !finished) {
        const bar = make('progress', 'team-progress'); bar.max = steps.length + 1; bar.value = doneCount + (merge?.status === 'done' ? 1 : 0);
        bar.setAttribute('aria-label', `Tiến độ ${doneCount}/${steps.length} phần`); item.append(bar);
      }
      if (finished) {
        const open = make('button', 'primary team-final', 'Xem kết quả →'); open.type = 'button';
        open.onclick = event => { event.stopPropagation(); openResult(final); };
        item.append(open);
      }
      if (!subs.length) return;
      const details = make('details', 'team-details');
      details.open = failed || openPlans.has(plan.id);
      details.ontoggle = () => details.open ? openPlans.add(plan.id) : openPlans.delete(plan.id);
      const reviews = subs.filter(j => j.teamRole === 'review');
      details.append(make('summary', '', `Xem từng phần (${steps.length}${reviews.length ? ` · ${reviews.length} kiểm tra chéo` : ''})`));
      const list = make('ol', 'team-steps');
      for (const sub of subs) {
        const li = make('li', `team-step is-${sub.status}`);
        const line = make('div', 'team-step-line');
        if (sub.teamRole === 'review') li.classList.add('is-review');
        line.append(make('span', 'team-step-icon', sub.teamRole === 'review' ? '⇄' : stepIcon[sub.status] || '○'), make('strong', '', sub.teamRole === 'merge' ? 'Tổng hợp bản cuối' : sub.title || sub.question));
        const chips = make('div', 'team-chips');
        chips.append(make('span', 'team-chip', conversationExecutionLabel(capabilities, sub)));
        if (sub.teamRole !== 'merge' && levelChip[sub.difficulty]) chips.append(make('span', `team-chip ${levelChip[sub.difficulty][1]}`, levelChip[sub.difficulty][0]));
        if (sub.selection?.model && sub.status !== 'waiting') chips.append(make('span', 'team-chip', `${shortModel(sub.selection.model)} · ${sub.selection.effort}`));
        if (sub.status === 'waiting') chips.append(statusLabel(sub.status));
        if (sub.status === 'running' || sub.status === 'pending') chips.append(statusLabel(sub.status));
        if (sub.teamRole === 'review' && sub.status === 'done' && reviewText(sub.result)) chips.append(make('span', `team-chip ${reviewText(sub.result) === 'đạt' ? 'is-easy' : 'is-hard'}`, reviewText(sub.result)));
        if (sub.status === 'done' && sub.startedAt) chips.append(make('span', 'team-chip is-muted', duration(sqlTime(sub.finishedAt) - sqlTime(sub.startedAt))));
        if (sub.execution?.usage) chips.append(make('span', 'team-chip is-muted', kTokens(tokensOf([sub]))));
        if (sub.part?.autoRetried) chips.append(make('span', 'team-chip is-muted', 'đã tự thử lại'));
        if (sub.status === 'done' || sub.status === 'error') {
          const open = make('button', 'team-open', sub.status === 'done' ? 'Xem' : 'Xem lỗi'); open.type = 'button';
          open.onclick = event => { event.stopPropagation(); openResult(sub); };
          chips.append(open);
        }
        if (sub.status === 'error') chips.append(retryButton(sub));
        li.append(line, chips); list.append(li);
      }
      details.append(list);
      item.append(details);
    };
    const contextLine=job=>{
      const line=make('div','live-context live-context-list');
      paintContext(line,job.execution?.context,job.provider,make);return line;
    };
    const visible=latest.filter(job=>!nested.has(job.id));
    $('queue-count').textContent=`${visible.length} luồng`;
    visible.sort((a,b)=>Number(b.pinned)-Number(a.pinned)).forEach(job => {
      const item = make('div', 'task-item live-task');
      item.classList.toggle('is-pinned',!!job.pinned);
      item.append(pinButton(job,true));
      if (job.teamRole === 'plan') {
        item.classList.add('team-task');
        const head = make('button'); head.type = 'button';
        head.append(make('span', '', '⧉'), make('span', 'task-title', job.conversationName || job.question));
        head.onclick = () => {
          const kids = children.get(job.id) || [];
          const final = kids.find(j => j.teamRole === 'merge') || (kids.filter(j => j.teamRole === 'step').length === 1 ? kids.find(j => j.teamRole === 'step') : null);
          if (final?.status === 'done') openResult(final);
          else if (job.status === 'done' || job.status === 'error') openResult(job);
          else notify(statusText[job.status]);
        };
        item.append(head);
        const meta = make('div', 'task-meta');
        meta.append(make('span', 'team-badge', 'Nhiều AI cùng làm'), make('span', '', `${executorName(job.selection?.machineId || job.executor)} · lập kế hoạch: ${shortModel(job.selection?.model)} ${job.selection?.effort || ''}`));
        item.append(meta);
        meta.append(renameButton(job));
        const activeParts = (children.get(job.id) || []).filter(part => part.status === 'running');
        for (const current of activeParts.length ? activeParts : [job]) {
          item.append(make('p', 'live-executor-label', conversationExecutionLabel(capabilities, current)));
          item.append(contextLine(current));
        }
        renderTeam(job, item);
        if (job.status === 'done' || job.status === 'error') item.append(deleteButton(job));
        if (job.status === 'error') item.append(retryButton(job));
        list.append(item);
        return;
      }
      const activity=job.conversationActivity;
      const current=activity||job;
      const displayStatus=activity?.status||job.status;
      const button = make('button');
      button.type = 'button';
      button.append(make('span', '', displayStatus === 'done' ? '✓' : displayStatus === 'error' ? '!' : '◌'));
      button.append(make('span', 'task-title', job.conversationName || job.question));
      button.onclick = () => openResult(job);
      item.append(button);
      const meta = make('div', 'task-meta');
      meta.append(statusLabel(displayStatus));
      meta.append(make('span', '', current.selection?.model ? `${shortModel(current.selection.model)} · ${current.selection.effort}` : providerName(current.provider)));
      item.append(meta);
      item.append(contextLine(current));
      item.append(make('p', 'live-executor-label', conversationExecutionLabel(capabilities, job)));
      // The open button sits at the end of the status line to keep each row short.
      if (job.status === 'done' || job.status === 'error' || !job.teamRole) {
        const resultButton = make('button', 'live-result-button', displayStatus==='running'?'Mở hội thoại →':job.status === 'done' ? 'Xem kết quả →' : job.status === 'error' ? 'Xem lỗi →' : 'Mở hội thoại →');
        resultButton.type = 'button';
        resultButton.onclick = () => openResult(job);
        meta.append(resultButton);
      }
      meta.append(renameButton(job));
      if (['done','error'].includes(displayStatus)) meta.append(deleteButton(job));
      if (activity?.status==='running'&&activity.progress?.message) item.append(make('p','live-progress-note live-status-note',activity.progress.message));
      list.append(item);
    });
    list.scrollTop = scrollTop;
    window.mocOfficeLive.updateAgentStatus(window.mocOfficeLive.selected);
  }

  function renameButton(job) {
    const button = make('button', 'live-rename-button', 'Đổi tên');
    button.type = 'button';
    button.onclick = event => {
      event.stopPropagation();
      renameConversation(job.conversationName || job.question, async name => {
        const updated = await api(`/tasks/${job.id}/rename`, { method:'POST', body:JSON.stringify({ name }) });
        for (const item of jobs) {
          if (item.conversationRoot === updated.conversationRoot) item.conversationName = updated.conversationName;
        }
        job.conversationName = updated.conversationName;
        renderJobs(); jobsSignature = '';
        const visible = jobs.find(item => item.id === displayedResultId);
        if (visible) $('result-brief').textContent = visible.conversationName || visible.question;
        notify('Đã đổi tên luồng công việc.');
      });
    };
    return button;
  }

  function pinButton(job,compact=false) {
    const button=make('button','soft-button live-pin',job.pinned?'📌 Bỏ ghim':'Ghim cuộc trao đổi');
    button.type='button';button.setAttribute('aria-pressed',String(!!job.pinned));
    // List rows use a small corner icon; the conversation view keeps the text button.
    if(compact){button.textContent=job.pinned?'📌':'☆';button.title=job.pinned?'Bỏ ghim':'Ghim cuộc trao đổi';button.setAttribute('aria-label',button.title);button.classList.add('is-compact')}
    button.onclick=async event=>{
      event.stopPropagation();button.disabled=true;
      try{
        const updated=await api(`/tasks/${job.id}/pin`,{method:'POST',body:JSON.stringify({pinned:!job.pinned})});
        await refresh();
        if(displayedResultId===job.id){job.pinned=updated.pinned;button.textContent=job.pinned?'📌 Bỏ ghim':'Ghim cuộc trao đổi';button.setAttribute('aria-pressed',String(job.pinned));}
      }catch(error){notify(error.message)}finally{button.disabled=false}
    };
    return button;
  }

  function notify(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  function modelControls(container, selection, provider, chosenAccounts = null) {
    const modelField = make('label', '', 'Model');
    const model = make('select');
    model.setAttribute('aria-label', 'Model');
    const effortField = make('label', '', 'Effort');
    const effort = make('select');
    effort.setAttribute('aria-label', 'Effort');
    // Effort list follows the chosen model: only levels allowed by the admin cap (tab Model).
    function refreshEfforts() {
      const previous = effort.value || selection?.requestedEffort || 'auto';
      const chosen = (capabilities.models || []).find(m => m.id === model.value);
      const levels = chosen ? chosen.efforts : [...new Set((capabilities.models || []).flatMap(m => m.efforts))];
      effort.replaceChildren(new Option('Tự động', 'auto'));
      for (const level of (capabilities.efforts || levels).filter(l => levels.includes(l))) effort.append(new Option(level, level));
      effort.value = [...effort.options].some(o => o.value === previous) ? previous : 'auto';
    }
    function refreshModels() {
      const previous = model.value || selection?.requestedModel || 'auto';
      const accounts = chosenAccounts?.() || [];
      const advertised = [...new Set(accounts.flatMap(account => account.models || []))];
      model.replaceChildren(new Option('Tự động', 'auto'));
      for (const item of capabilities.models || []) {
        if ((!provider || provider.value === 'auto' || provider.value === item.provider) && (!advertised.length || advertised.includes(item.id)))
          model.append(new Option(`${item.label} · tối đa ${item.maxEffort}`, item.id));
      }
      model.value = [...model.options].some(o => o.value === previous) ? previous : 'auto';
    }
    refreshModels(); refreshEfforts();
    model.addEventListener('change', refreshEfforts);
    window.addEventListener('office:models-changed', async () => { await refreshMachines(); refreshModels(); refreshEfforts(); });
    if (provider) provider.addEventListener('change', () => { refreshModels(); refreshEfforts(); });
    modelField.append(model); effortField.append(effort);
    container.append(modelField, effortField);
    return { model, effort, refresh:() => { refreshModels(); refreshEfforts(); } };
  }

  // Opening a conversation lands on the newest turn and the follow-up box, ready to continue. Every scrollable
  // ancestor is moved because the chat scrolls inside the modal or the expanded panel depending on layout.
  function scrollChatToEnd() {
    const toEnd = () => {
      for (let node = $('result-body'); node && node !== document.body; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) node.scrollTop = node.scrollHeight;
      }
    };
    requestAnimationFrame(toEnd); setTimeout(toEnd, 300); // again after images and the CLI block finish laying out
  }
  function openResult(job) {
    stopSpeech(); followupSpeech?.destroy(); followupSpeech = null;
    displayedResultId = job.id;
    $('result-title').textContent = job.status === 'error' ? 'AI chưa hoàn thành' : job.status === 'done' ? 'Cuộc trao đổi' : 'AI đang làm việc';
    $('result-modal').dataset.jobStatus = job.status;
    $('result-brief').textContent = job.conversationName || job.question;
    const body = $('result-body');
    body.replaceChildren();
    body.append(statusLabel(job.status));
    body.append(pinButton(job));
    body.append(renameButton(job));
    // Chat order: earlier turns (collapsed) → this turn's question → its answer → follow-up box. The question and
    // its attachments are appended right before the answer below.
    let asked = null, filesNode = null;
    if (job.question) { asked = make('article', 'live-conversation-turn live-current-question'); asked.append(make('strong', '', job.question)); }
    const inputs=(job.attachments||[]).filter(file=>file.kind==='input');
    if(inputs.length){
      const files=make('details','live-chat-files');files.append(make('summary','',`Tư liệu đính kèm (${inputs.length})`));
      for(const file of inputs){
        const item=make('p');
        if(file.id && /^image\//.test(file.mime||'')){
          const url=`/api/ai-office/tasks/${job.id}/media/${file.id}`;
          const link=make('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';
          const image=make('img');image.src=url;image.alt=file.name||'Ảnh đính kèm';image.loading='lazy';
          link.append(image,make('span','',file.name||'Ảnh đính kèm'));item.append(link);
        }
        else if(file.id){const link=make('a','',file.name||file.path);link.href=`/api/ai-office/tasks/${job.id}/media/${file.id}`;link.download=file.name||file.path;item.append(link)}
        else if(/^https:\/\/drive\.google\.com\//.test(file.link||'')){const link=make('a','',file.path);link.href=file.link;link.target='_blank';link.rel='noopener noreferrer';item.append(link)}
        else item.textContent=file.path;
        files.append(item);
      }filesNode = files;
    }
    // Technical routing details stay available but folded away from the main reading.
    const tech = make('details', 'live-tech'); tech.append(make('summary', '', 'Ghi chú về số liệu'));
    const accountName = executionAccountLabel(capabilities, job.executor, job.provider, job.selection?.accountId);
    body.append(make('p', 'live-routing', `${accountName} trên ${executorName(job.executor)} · ${routingText(job.reason)}${job.shop ? ` · ${job.shop}` : ''}`));
    const handoffInfo = job.handoff || job.handoffOrigin;
    if (handoffInfo) {
      const line = make('p', 'live-execution', `Luồng nhận bàn giao: ${executorName(handoffInfo.fromMachine)} / ${executionAccountLabel(capabilities, handoffInfo.fromMachine, handoffInfo.fromProvider)} → ${executorName(job.executor)} / ${accountName}. ${job.project ? 'Tệp dự án đi qua Drive chung.' : 'Đã chuyển ngữ cảnh văn bản; tệp trên đĩa không tự chuyển.'} `);
      const source = make('button', 'soft-button', 'Mở luồng gốc'); source.type = 'button';
      source.onclick = async () => {
        source.disabled = true;
        try { openResult(await api(`/tasks/${handoffInfo.fromJob}`)); }
        catch (error) { notify(error.message); source.disabled = false; }
      };
      line.append(source); body.append(line);
    }
    if (job.selection) body.append(make('p', 'live-routing', `Đã chọn: ${job.selection.model} · Effort: ${job.selection.effort} · ${routingText(job.selection.reason)}`));
    if (job.project) {
      const line = make('p', 'live-routing', `Dự án: ${job.project.name} `);
      if (job.project.link) { const a = make('a', '', 'Mở Drive ↗'); a.href = job.project.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; line.append(a); }
      body.append(line);
    }
    if (job.files?.length) {
      const box = make('section', 'live-files');
      box.append(make('h3', 'live-evidence-title', `Tệp kết quả đã lưu lên Drive (${job.files.length})`));
      const list = make('ul');
      for (const file of job.files) {
        const item = make('li'); const link = make(file.link ? 'a' : 'span', '', file.name);
        if (file.link) { link.href = file.link; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        item.append(link); list.append(item);
      }
      box.append(list); body.append(box);
    }
    const usage = job.execution?.usage;
    const executionNote = `Model: ${job.execution?.model || 'Chưa ghi nhận'} · Effort: ${job.execution?.effort || 'Chưa ghi nhận'}${usage ? ` · Token: ${(usage.input || 0).toLocaleString('vi-VN')} vào (${(usage.cached || 0).toLocaleString('vi-VN')} từ cache) + ${(usage.output || 0).toLocaleString('vi-VN')} ra` : ''}`;
    body.append(make('p', 'live-execution', executionNote));
    if (job.status === 'done') {
      const shortcut = make('button', 'soft-button', 'Bàn giao bước tiếp theo →'); shortcut.type = 'button';
      shortcut.onclick = () => {
        const toggle = body.querySelector('#live-handoff');
        const settings=toggle.closest('details');if(settings)settings.open=true;
        if (!toggle.checked) toggle.click();
        toggle.scrollIntoView({ block:'center' }); toggle.focus();
      };
      body.append(shortcut);
    }
    if (job.conversation?.length) {
      const history = make('details', 'live-conversation');
      history.open = false; // earlier turns stay folded; only the latest question and answer are shown
      history.append(make('summary', '', `Xem ${job.conversation.length} lượt trước`));
      for (const turn of job.conversation) {
        const message = make('article', 'live-conversation-turn');
        message.append(make('strong', '', turn.question));
        for (const file of turn.attachments || []) if (turn.jobId && file.id) {
          const url=`/api/ai-office/tasks/${turn.jobId}/media/${file.id}`;
          const link=make('a','live-turn-image');link.href=url;link.target='_blank';link.rel='noopener noreferrer';
          if(/^image\//.test(file.mime||'')){
            const image=make('img');image.src=url;image.alt=file.name||'Ảnh đã gửi';image.loading='lazy';link.append(image);
          }else link.download=file.name;
          link.append(make('span','',file.name||'Tệp đã gửi'));message.append(link);
        }
        const answer = make('div', 'live-result');
        renderAnswer(answer, String(turn.answer || 'Lượt trước chưa hoàn tất'), turn.jobId ? source => `/api/ai-office/tasks/${turn.jobId}/image?path=${encodeURIComponent(source)}` : undefined);
        message.append(answer); history.append(message);
      }
      body.append(history);
    }
    if (job.parentId) {
      const parent = make('button', 'soft-button', '← Xem lượt trước'); parent.type = 'button';
      parent.onclick = async () => { try { openResult(await api(`/tasks/${job.parentId}`)); } catch (error) { notify(error.message); } };
      body.append(parent);
    }
    if (asked) body.append(asked);
    if (filesNode) body.append(filesNode);
    const result = make('div', 'live-result'); result.id='live-cli-answer';
    let content = String(job.status === 'error' ? job.error || '' : job.result || '');
    if (job.teamRole === 'plan' && job.status === 'done' && !job.part?.self) {
      try {
        const raw = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
        const plan = JSON.parse(raw);
        const level = { easy: 'dễ', medium: 'vừa', hard: 'khó' };
        content = `### Kế hoạch chia việc\n${routingText(plan.reason)}\n\n` + (plan.steps || []).map((s, i) =>
          `${i + 1}. **${s.title || 'Phần ' + (i + 1)}** (${level[s.difficulty] || 'vừa'}${s.depends_on?.length ? ', sau ' + s.depends_on.join(', ') : ', chạy song song'})\n   ${s.brief}`).join('\n');
      } catch {}
    }
    renderAnswer(result, content, source => `/api/ai-office/tasks/${job.id}/image?path=${encodeURIComponent(source)}`);
    body.append(result);
    if (['pending','running','waiting'].includes(job.status)) {
      const activity = make('p', 'live-progress-note live-status', job.cancelRequested ? 'Đang dừng…' : job.progress?.message || (job.status === 'waiting' ? 'Tin nhắn đang chờ lượt trước hoàn tất' : 'Đang chờ AI nhận việc'));
      activity.dataset.status=job.status;
      activity.id = 'live-job-progress'; activity.setAttribute('role', 'status');
      const stop = make('button', 'soft-button live-stop', job.status === 'running' ? 'Dừng công việc' : 'Hủy tin nhắn chờ'); stop.type = 'button';
      stop.disabled = !!job.cancelRequested;
      stop.onclick = async () => {
        stop.disabled = true;
        try { await api(`/tasks/${job.id}/stop`, { method: 'POST' }); activity.textContent = 'Đã yêu cầu dừng. Đang chờ worker kết thúc…'; await refresh(); }
        catch (error) { activity.textContent = error.message; stop.disabled = false; }
      };
      body.append(activity, stop);
    }
    if (job.status === 'done' && job.evidence?.rows?.length) {
      const evidence = make('section', 'live-evidence');
      evidence.append(make('h3', 'live-evidence-title', 'Sản phẩm (ảnh từ shop)'));
      const money = value => value == null ? 'Chưa đủ dữ liệu' : `${Math.round(value).toLocaleString('vi-VN')}đ`;
      for (const row of job.evidence.rows) for (const platform of ['shopee', 'tiktok']) {
        const report = row[platform];
        if (!report) continue;
        evidence.append(make('h3', '', `@${row.shop} · ${platform === 'shopee' ? 'Shopee' : 'TikTok Shop'}`));
        const totals = make('div', 'live-evidence-totals');
        for (const [label, value] of [['Doanh thu đơn hàng', report.revenue],
          ['Tiền thực về ví', report.financials?.actual_wallet],
          [report.financials?.expected_profit == null ? 'Lãi dự kiến · phần có vốn' : 'Lãi dự kiến',
            report.financials?.expected_profit ?? report.financials?.expected_profit_known_cost_portion]]) {
          const stat = make('div'); stat.append(make('span', '', label), make('strong', '', money(value))); totals.append(stat);
        }
        evidence.append(totals);
        if (report.financials) {
          tech.append(make('p', 'live-evidence-note', `${report.financials.actual_wallet_basis || ''} ${report.financials.basis || ''}`));
          tech.append(make('p', 'live-evidence-note', `${report.financials.covered_units || 0}/${report.financials.total_units || 0} sản phẩm có giá vốn chi tiết trong kỳ.`));
          if (report.financials.missing?.length) tech.append(make('p', 'live-evidence-note', report.financials.missing.join(' · ')));
        }
        const cards = make('div', 'live-product-cards');
        const answerText = String(job.result || '').toLowerCase();
        const mentioned = (report.products || []).filter(p => [p.sku, p.model_name, String(p.name || '').slice(0, 30)].some(v => v && v.length > 2 && answerText.includes(String(v).toLowerCase())));
        for (const product of (mentioned.length ? mentioned : report.products || []).slice(0, 8)) {
          const card = make('article', 'live-product-card');
          if (/^https?:\/\//i.test(product.image || '')) {
            const img = make('img'); img.src = product.image; img.alt = product.model_name || product.name || 'Sản phẩm';
            img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; card.append(img);
          }
          const text = make('div');
          text.append(make('strong', '', product.name || `SP ${product.item_id}`));
          if (product.model_name) text.append(make('p', '', product.model_name));
          text.append(make('p', '', `${product.units || 0} sản phẩm · ${money(product.revenue)}`));
          card.append(text); cards.append(card);
        }
        evidence.append(cards);
      }
      body.append(evidence);
    }
    if (tech.children.length > 1) body.append(tech);
    const download = $('download-result');
    download.hidden = job.status !== 'done';
    download.onclick = () => {
      const url = URL.createObjectURL(new Blob([executionNote + '\n\n' + (job.result || '')], { type: 'text/plain;charset=utf-8' }));
      const link = make('a');
      link.href = url;
      link.download = `van-phong-ai-${job.id}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (!job.teamRole || job.status === 'done') {
      const form = make('form', 'live-followup');
      const label = make('label', '', 'Hỏi tiếp / Yêu cầu chỉnh sửa');
      const input = make('textarea');
      input.rows = 3;

      input.required = true;
      input.placeholder = 'Ví dụ: Giải thích kỹ hơn, viết ngắn gọn hơn hoặc làm tiếp…';
      label.append(input);
      const suggestions = make('div', 'live-followup-suggestions');
      for (const text of ['Giải thích kỹ hơn', 'Viết ngắn gọn hơn', 'Làm tiếp']) {
        const button = make('button', '', text);
        button.type = 'button';
        button.onclick = () => { input.value = text; input.focus(); };
        suggestions.append(button);
      }
      const send = make('button', 'primary full', job.status === 'running' || job.status === 'waiting' ? 'Gửi nối tiếp →' : 'Gửi tiếp →');
      send.type = 'submit';
      const status = make('p', 'live-followup-status');
      status.setAttribute('role', 'status');
      const choices = make('div', 'live-controls');
      const handoffLabel = make('label', 'live-handoff-toggle');
      const handoff = make('input'); handoff.type = 'checkbox'; handoff.id = 'live-handoff'; handoff.disabled = !['done','error'].includes(job.status);
      handoffLabel.append(handoff, document.createTextNode(' Bàn giao sang luồng mới cho máy / AI khác'));
      const destination = make('div', 'live-controls'); destination.hidden = true;
      const targetLabel = make('label', '', 'Máy nhận việc'); const target = make('select'); target.id = 'live-handoff-machine';
      const vps = new Option(`VPS · ${capabilities.vpsOnline ? 'online' : 'offline'}`, 'vps'); vps.disabled = !capabilities.vpsOnline; target.append(vps);
      for (const machine of localMachines(capabilities)) {
        const option = new Option(machineLabel(machine), machine.id);
        option.disabled = !machine.online; target.append(option);
      }
      const selectedMachine = job.selection?.machineId || job.executor;
      const currentMachine = isVpsExecutor(selectedMachine) ? 'vps' : selectedMachine;
      target.value = [...target.options].find(o => o.value === currentMachine && !o.disabled)?.value || [...target.options].find(o => !o.disabled)?.value || '';
      targetLabel.append(target);
      const providerLabel = make('label', '', 'AI nhận việc'); const receiver = make('select'); receiver.id = 'live-handoff-account';
      const receiverProvider = make('select');
      receiverProvider.append(new Option('Tự chọn', 'auto'), new Option('Claude', 'claude'), new Option('Codex', 'codex'));
      const receiverAccount = () => handoff.checked ? accountsOf(capabilities, target.value).find(account => account.id === receiver.value) : null;
      const renderReceivers = () => {
        const previous = receiver.value;
        receiver.replaceChildren(new Option('Tự chọn AI còn hạn mức trên máy này', 'auto'));
        for (const account of handoffOptions(capabilities, target.value)) {
          const option = new Option(account.label, account.id); option.disabled = account.disabled; receiver.append(option);
        }
        receiver.value = [...receiver.options].some(option => option.value === previous && !option.disabled) ? previous : 'auto';
        receiverProvider.value = receiverAccount()?.provider || 'auto';
      };
      renderReceivers(); providerLabel.append(receiver);
      destination.append(targetLabel, providerLabel, make('small', '', 'Tạo luồng chat riêng cho AI nhận, kèm câu hỏi/câu trả lời đã lưu. Luồng cũ giữ nguyên để mở lại và tiếp tục khi AI cũ còn hạn mức. Tệp trên đĩa, phiên công cụ, Chrome và desktop không tự chuyển; tệp dự án dùng Drive chung.'));
      const followupModel = modelControls(choices, job.selection ? { ...job.selection, requestedModel: job.selection.requestedModel || job.selection.model, requestedEffort: job.selection.requestedEffort || job.selection.effort } : null, receiverProvider,
        () => handoff.checked ? accountsOf(capabilities, target.value).filter(account => account.online && !account.removalPending && (receiver.value === 'auto' || account.id === receiver.value))
          : accountsOf(capabilities, currentMachine).filter(account => account.workerId === job.executor || account.id === job.selection?.accountId));
      receiver.addEventListener('change', () => {
        receiverProvider.value = receiverAccount()?.provider || 'auto';
        followupModel.refresh();
      });
      target.addEventListener('change', () => { renderReceivers(); followupModel.refresh(); });
      handoff.onchange = () => {
        destination.hidden = !handoff.checked;
        renderReceivers();
        receiverProvider.value = receiverAccount()?.provider || 'auto';
        followupModel.refresh();
        followupModel.model.value = handoff.checked ? 'auto' : job.selection?.requestedModel || job.selection?.model || 'auto';
        followupModel.effort.value = handoff.checked ? 'auto' : job.selection?.requestedEffort || job.selection?.effort || 'auto';
        send.textContent = handoff.checked ? 'Bàn giao việc →' : job.status === 'running' || job.status === 'waiting' ? 'Gửi nối tiếp →' : 'Gửi tiếp →';
      };
      const settings=make('details','live-chat-settings');settings.append(make('summary','','Model, effort và bàn giao'),handoffLabel,destination,choices);
      const keys=make('small','live-chat-keys','Enter để gửi · Shift+Enter xuống dòng');
      input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.ctrlKey&&!event.metaKey){event.preventDefault();form.requestSubmit()}});
      form.append(label, keys, suggestions, settings, send, status);
      const attachments=mountAttachments(form,input,job.id,job.projectId);
      followupSpeech=mountSpeech({form,input,make,scope:$('result-modal')});
      mountSlash({form,input,make,api,job,attachments,onNew:()=>startNewChat(),
        onJob:async created=>{openResult(created);await refresh()},
        describeStatus:data=>`${executionAccountLabel(capabilities,data.executor,data.provider,data.accountId)} trên ${executorName(data.executor)}`,
        onAction:(name,args,show)=>runOfficeSlash(name,args,job,followupModel,show)});
      const attachmentBox=form.querySelector('.live-attachments');
      if (attachmentBox) attachmentBox.hidden = false;
      form.onsubmit = async event => {
        event.preventDefault();
        const question = input.value.trim() || 'Xem và xử lý tệp đính kèm theo nội dung cuộc trao đổi.';
        if (send.disabled) return;
        send.disabled = true;
        send.textContent = 'Đang gửi…';
        try {
          const projectId=await attachments.prepare(question);
          const created = await api('/tasks', { method: 'POST', body: JSON.stringify({ question, projectId:projectId||undefined, images:attachments.imageNames(), mediaIds:attachments.mediaIds(), parentId: job.id, queue: ['pending','running','waiting'].includes(job.status), model: followupModel.model.value, effort: followupModel.effort.value,
            ...(handoff.checked ? { handoff:true, executor:target.value, provider:receiverAccount()?.provider || 'auto',
              ...(receiverAccount() ? {accounts:[receiverAccount().id]} : {}) } : {}) }) });
          attachments.clear();
          openResult(created);
          await refresh();
        } catch (error) {
          attachments.unlock();
          status.textContent = error.message;
          send.disabled = false;
          send.textContent = handoff.checked ? 'Bàn giao việc →' : job.status === 'running' || job.status === 'waiting' ? 'Gửi nối tiếp →' : 'Gửi tiếp →';
        }
      };
      body.append(form);
      const approve = make('button', 'soft-button live-approve', job.approvedAt ? '✓ Đã xem kết quả' : 'Đánh dấu đã xem');
      approve.disabled = !!job.approvedAt || job.status !== 'done';
      approve.onclick = async () => {
        try {
          const updated = await api(`/tasks/${job.id}/approve`, { method: 'POST' });
          jobs = jobs.map(item => item.id === updated.id ? updated : item);
          approve.textContent = '✓ Đã xem kết quả';
          approve.disabled = true;
          notify('Đã đánh dấu xem kết quả.');
        } catch (error) { notify(error.message); }
      };
      if (job.status === 'done') body.append(approve);
    }
    document.querySelector('#result-modal > .modal > small').textContent = 'AI có thể sai. Hãy kiểm tra số liệu và nội dung trước khi dùng.';
    showModal('result-modal');
    cli.mount(job);
    scrollChatToEnd();
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      jobs = await api('/tasks');
      const signature = JSON.stringify(jobs.map(job => [job.id, job.status, job.question, job.conversationName,
        job.agent, job.provider, job.executor, job.pinned, job.approvedAt, job.selection?.model, job.finishedAt, job.progress?.updatedAt, job.cancelRequested, job.execution?.context]));
      if (signature !== jobsSignature) { renderJobs(); jobsSignature = signature; }
      const visible = jobs.find(job => job.id === displayedResultId);
      if (visible && !$('result-modal').hidden) {
        cli.updateContext(visible);
        $('result-brief').textContent = visible.conversationName || visible.question;
        if ($('result-modal').dataset.jobStatus !== visible.status) {
          const draft = $('result-body').querySelector('.live-followup textarea')?.value || '';
          openResult(visible);
          const input = $('result-body').querySelector('.live-followup textarea');
          if (input) input.value = draft;
        } else if ($('live-job-progress')) $('live-job-progress').textContent = visible.cancelRequested ? 'Đang dừng…' : visible.progress?.message || (visible.status === 'waiting' ? 'Tin nhắn đang chờ lượt trước hoàn tất' : 'Đang chờ AI nhận việc');
      }

    } catch (error) { setNote(`Không tải được công việc: ${error.message}`); }
    finally { busy = false; }
  }

  const usageDetailsOpen = new Set();
  const quotaTime = value => new Date(value * 1000).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  // Overview cards are narrow on phones: drop the year, keep hour first.
  const quotaShort = value => new Date(value * 1000).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
  });
  function paintMachineUsage(box, machineId, overview=false) {
    if (!box) return;
    box.replaceChildren();
    if(!overview)box.append(make('h3','','Hạn mức AI trên máy đã chọn'));
    const accounts = accountsOf(capabilities, machineId);
    const grid = make('div', 'live-quota-grid');
    for (const account of accounts) {
      const card = make('article', 'live-quota-card');
      const header = make('div', 'live-quota-header');
      const session = make('div', 'live-quota-period');
      const weekly = make('div', 'live-quota-period');
      const extra = make('div', 'live-quota-extra');
      const creditSummary = make('div', 'live-quota-credit-summary');
      header.append(make('strong', '', account.label || 'Tài khoản AI'));
      if (!account.online) header.append(make('small', '', 'Offline'));
      if (account.removalPending) header.append(make('p', 'live-removal-state', account.removalStatus === 'error'
        ? 'Gỡ bị lỗi · đã ngừng nhận việc' : 'Đang chờ gỡ · đã ngừng nhận việc'));
      const details = make('details', 'live-quota-details');
      const summary = make('summary', '', 'Xem chi tiết');
      summary.setAttribute('aria-label', `Xem chi tiết ${account.label || 'tài khoản AI'}`);
      const detailBody = make('div', 'live-quota-detail-body');
      details.append(summary, detailBody);
      const detailKey = `${overview?'overview':'form'}:${machineId}:${account.id}`;
      details.open = usageDetailsOpen.has(detailKey);
      summary.textContent = details.open ? 'Thu gọn' : 'Xem chi tiết';
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        details.open ? usageDetailsOpen.add(detailKey) : usageDetailsOpen.delete(detailKey);
        summary.textContent = details.open ? 'Thu gọn' : 'Xem chi tiết';
      });
      if (account.removalError) detailBody.append(make('p', 'live-removal-state', account.removalError));
      const providerUsage = { ...(account.usage || {}) };
      for (const provider of account.providers || [account.provider]) {
        if (provider && !providerUsage[provider]) providerUsage[provider] = {};
      }
      for (const [provider, usage] of Object.entries(providerUsage)) {
        const subscription = subscriptionPresentation(provider, usage);
        const plan = make('div', 'live-subscription');
        // Keep the date compact, but flag cached entitlement data in the overview.
        const sub = usage.subscription || {};
        const hasDate = Number.isFinite(sub.validUntil) && sub.validUntil > 0;
        const staleDate = hasDate && sub.status === 'unknown';
        const expiry = hasDate
          ? `Hạn gói: ${new Date(sub.validUntil * 1000).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}${staleDate ? ' · dữ liệu cũ' : ''}`
          : sub.status === 'expired' ? 'Gói đã hết hạn' : 'Hạn gói: chưa rõ';
        if (subscription.planLabel !== account.label) plan.append(make('small', '', subscription.planLabel));
        plan.append(make('small', '', expiry));
        header.append(plan);
        detailBody.append(make('small', '', subscription.statusLabel), make('small', '', subscription.expiryLabel));
        if (subscription.renewalLabel) detailBody.append(make('small', '', subscription.renewalLabel));
        if (subscription.note) detailBody.append(make('small', '', subscription.note));
        const credits = usage.resetCredits;
        if (credits?.available) {
          creditSummary.append(make('small', 'live-credit-summary', `🎁 ${credits.available} lượt reset miễn phí`));
          const credit = credits.credits?.[0];
          if (credit?.expiresAt) creditSummary.append(make('small', '', `Hạn dùng: ${quotaTime(credit.expiresAt)}`));
          const creditBox = make('div', 'live-reset-credit');
          creditBox.append(make('strong', '', `🎁 ${credits.available} lượt reset miễn phí${credit?.title ? ` · ${credit.title}` : ''}`));
          const sharedWith = sharedCreditAccounts(capabilities, account, credit?.id);
          if (sharedWith.length) creditBox.append(make('small', '', `Cùng tài khoản với: ${sharedWith.join(', ')}. Dùng ở đâu cũng tính chung một lượt.`));
          if (credit?.expiresAt) creditBox.append(make('small', '', `Hết hạn ${new Date(credit.expiresAt * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (giờ VN)`));
          if (capabilities.fileAccess && !account.removalPending) {
            const use = make('button', 'soft-button', 'Dùng lượt reset'); use.type = 'button';
            const remaining = Math.min(...(usage.windows || []).map(w => w.remainingPercent ?? 100));
            use.onclick = () => runAccountCommand(account, provider, 'reset_credit', use, remaining);
            creditBox.append(use);
          }
          detailBody.append(creditBox);
        }
        const fresh = usage.checkedAt && usage.checkedAt <= Date.now() + 60000 && Date.now() - usage.checkedAt <= 300000;
        if (usage.status !== 'ok' || !usage.windows?.length) {
          session.append(make('span', '', 'Phiên: chưa rõ'));
          weekly.append(make('span', '', 'Tuần: chưa rõ'));
        } else for (const w of usage.windows) {
          const expired = w.resetsAt && w.resetsAt * 1000 <= Date.now();
          const label = w.label.replace(/^(codex|claude)\s*·\s*/i, '');
          const line = make('div', 'live-quota-window');
          line.append(make('span', '', `${label}: ${expired ? 'chờ cập nhật' : `còn ${Math.round(w.remainingPercent)}%${!fresh ? ' (cũ)' : ''}`}`));
          if (!expired) {
            const meter = make('progress'); meter.max = 100; meter.value = w.remainingPercent;
            meter.setAttribute('aria-label', `${account.label || providerName(provider)} · ${w.label} còn ${w.remainingPercent}%`);
            if (w.remainingPercent <= 10) meter.classList.add('low');
            line.append(meter);
          }
          const slot = w.id === 'five_hour' || w.id === 'codex:primary' ? session
            : w.id === 'seven_day' || w.id === 'codex:secondary' ? weekly : extra;
          slot.append(line);
          if (w.resetsAt) line.append(make('small', 'live-quota-reset-time', `Reset: ${overview ? quotaShort(w.resetsAt) : quotaTime(w.resetsAt)}`));
        }
        // Luôn hiện đủ cả phiên và tuần; thiếu cửa sổ nào thì ghi rõ là chưa rõ.
        if (!session.children.length) session.append(make('span', '', 'Phiên: chưa rõ'));
        if (!weekly.children.length) weekly.append(make('span', '', 'Tuần: chưa rõ'));
        if(overview&&usage.checkedAt)extra.append(make('small','live-quota-updated',`Cập nhật: ${new Date(usage.checkedAt).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}${!fresh?' · dữ liệu cũ':''}`));
        if (usage.checkedAt) detailBody.append(make('small', '', `Cập nhật ${new Date(usage.checkedAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`));
      }
      detailBody.append(make('small', '', 'Thời gian theo giờ Việt Nam. Hạn mức dùng chung theo tài khoản, kể cả ngoài Văn phòng AI. Hệ thống tránh tài khoản hết lượt và ưu tiên tài khoản còn đủ.'));
      if (capabilities.fileAccess && account.online && account.usage?.codex && !account.removalPending) {
        const reread = make('button', 'live-reread', '↻ Đọc lại hạn mức'); reread.type = 'button';
        reread.onclick = () => runAccountCommand(account, 'codex', 'refresh_usage', reread);
        detailBody.append(reread);
      }
      if (capabilities.fileAccess && isVpsExecutor(machineId)) {
        const remove = make('button', 'live-remove-account', account.removalPending ? 'Đã ngừng nhận việc' : 'Gỡ khỏi VPS');
        remove.type = 'button'; remove.disabled = !!account.removalPending;
        remove.onclick = () => openAccountRemoval(account);
        detailBody.append(remove);
      }
      card.append(header, session, weekly, extra, creditSummary, details);
      grid.append(card);
    }
    if (!accounts.length) grid.append(make('p', '', 'Đang chờ dữ liệu hạn mức từ máy.'));
    box.append(grid);
  }

  function renderQuotaOverview() {
    let overview=$('live-quota-overview');
    if(!overview){
      // Collapsed by default so the task list keeps the screen; the summary line
      // still shows each account's session quota. The open state is remembered.
      overview=make('details','live-quota-overview');overview.id='live-quota-overview';
      try{overview.open=localStorage.getItem('moc-office-quota-open')==='1'}catch{}
      const head=make('summary');head.append(make('span','live-quota-overview-title','Hạn mức'),make('span','live-quota-overview-brief'));
      overview.append(head);
      overview.addEventListener('toggle',()=>{try{localStorage.setItem('moc-office-quota-open',overview.open?'1':'0')}catch{}});
      const toolbar=make('div','live-quota-overview-toolbar');
      const label=make('label','','Máy xử lý '),select=make('select');select.id='overview-quota-machine';
      select.setAttribute('aria-label','Xem hạn mức theo máy xử lý');label.append(select);
      toolbar.append(label,make('small','','Dùng chung theo tài khoản; giới hạn riêng từng model được ghi khi có dữ liệu.'));
      const cards=make('div','live-overview-cards');cards.id='live-overview-cards';
      overview.append(toolbar,cards);document.querySelector('.work-area').before(overview);
      select.onchange=()=>{try{localStorage.setItem('moc-office-quota-machine',select.value)}catch{}renderQuotaOverview()};
    }
    const select=$('overview-quota-machine');
    let selected=select.value;
    if(!selected){try{selected=localStorage.getItem('moc-office-quota-machine')}catch{}}
    select.replaceChildren(new Option('VPS','vps'));
    for(const machine of localMachines(capabilities))select.append(new Option(machineLabel(machine),machine.id));
    select.value=[...select.options].some(option=>option.value===selected)?selected:(preferredMachine(capabilities)?.id||'vps');
    const cards=$('live-overview-cards'),scroll=cards.scrollTop;
    paintMachineUsage(cards,select.value,true);cards.scrollTop=scroll;
    overview.querySelector('.live-quota-overview-brief').textContent=quotaBrief(select.value);
  }
  // One line per account: the 5-hour session window is what blocks new work first.
  function quotaBrief(machineId) {
    return accountsOf(capabilities, machineId).map(account => {
      const windows = Object.values(account.usage || {}).flatMap(usage => usage.status === 'ok' ? usage.windows || [] : []);
      const session = windows.find(w => (w.id === 'five_hour' || w.id === 'codex:primary') && !(w.resetsAt && w.resetsAt * 1000 <= Date.now()));
      const state = !account.online ? 'offline' : session ? `${Math.round(session.remainingPercent)}%` : '?';
      return `${account.label || 'AI'} ${state}`;
    }).join(' · ');
  }
  function renderMachineUsage() {
    renderQuotaOverview();
  }

  function openAccountRemoval(account) {
    if (!capabilities.fileAccess || account.removalPending || document.querySelector('.live-remove-dialog')) return;
    const previousFocus = document.activeElement;
    const dialog = make('dialog', 'live-remove-dialog');
    dialog.setAttribute('aria-labelledby', 'live-remove-title');
    const title = make('h2', '', 'Gỡ tài khoản khỏi VPS'); title.id = 'live-remove-title';
    const target = make('p', '', `Tài khoản: ${account.label || 'AI'} · ${account.id}`);
    const consequence = make('p', '', 'Ngừng dùng và xóa phiên đăng nhập trên VPS; giữ lịch sử; không hủy gói, không xóa trên máy khác');
    const form = make('form');
    const label = make('label', '', 'Mật khẩu đăng nhập phần mềm'); label.htmlFor = 'live-remove-password';
    const password = make('input'); password.id = 'live-remove-password'; password.type = 'password'; password.required = true;
    password.autocomplete = 'current-password';
    const status = make('p', 'live-removal-state'); status.setAttribute('role', 'status');
    const actions = make('div', 'live-remove-actions');
    const close = make('button', 'soft-button', 'Hủy'); close.type = 'button'; close.onclick = () => dialog.close();
    const submit = make('button', 'live-remove-account', 'Xác nhận gỡ khỏi VPS'); submit.type = 'submit';
    actions.append(close, submit); form.append(label, password, status, actions);
    dialog.append(title, target, consequence, form); document.body.append(dialog);
    let closed = false;
    let timer;
    let wake;
    let request;
    const sleep = () => new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 3000); });
    const fetchBounded = async (path, options) => {
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 20000);
      try { return await api(path, { ...options, signal: request.signal }); }
      finally { clearTimeout(timeout); request = null; }
    };
    dialog.addEventListener('close', () => {
      closed = true; password.value = ''; request?.abort(); clearTimeout(timer); wake?.(); dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
    }, { once: true });
    form.onsubmit = async event => {
      event.preventDefault(); if (submit.disabled) return;
      const body = JSON.stringify({ ...accountRemovalTarget(account), password: password.value, confirm: true });
      password.value = ''; submit.disabled = true; password.disabled = true;
      status.textContent = 'Đang xác nhận và gửi yêu cầu…';
      let accepted = false;
      try {
        const { id } = await fetchBounded('/accounts/remove', { method: 'POST', body });
        accepted = true;
        account.removalPending = true;
        close.textContent = 'Đóng';
        status.textContent = account.online ? 'Đã ngừng nhận việc mới. Đang chờ VPS gỡ phiên đăng nhập…' : 'VPS đang offline. Đã ngừng nhận việc mới; yêu cầu gỡ sẽ chạy khi worker online lại.';
        await refreshMachines();
        for (let i = 0; i < 40 && !closed; i++) {
          await sleep(); if (closed) return;
          const command = await fetchBounded(`/usage/command/${id}`);
          if (['done', 'error'].includes(command.status)) {
            status.textContent = command.status === 'done' ? 'Đã gỡ tài khoản khỏi VPS. Lịch sử vẫn được giữ.' : `Chưa gỡ được: ${command.error || 'Worker báo lỗi'}. Tải lại trạng thái trước khi thao tác tiếp.`;
            await refreshMachines(); return;
          }
        }
        if (!closed) status.textContent = 'Yêu cầu gỡ vẫn đang chờ VPS phản hồi. Đã ngừng nhận việc mới; đóng hộp thoại và đọc lại trạng thái sau.';
      } catch (error) {
        if (closed) return;
        status.textContent = accepted ? 'Đã gửi yêu cầu gỡ; chưa đọc được kết quả. Đóng hộp thoại và đọc lại trạng thái trước khi thao tác tiếp.' : error.name === 'AbortError' ? 'Chưa xác định yêu cầu đã được nhận. Đóng hộp thoại và tải lại trạng thái trước khi thao tác tiếp.' : error.message;
        // A timeout may have reached the server: require re-reading rather than duplicate submission.
        if (!accepted && error.name !== 'AbortError') { submit.disabled = false; password.disabled = false; password.focus(); }
        await refreshMachines();
      }
    };
    dialog.showModal(); password.focus();
  }

  // Commands are executed by the worker holding the account; poll until it answers.
  async function runAccountCommand(account, provider, kind, button, remaining = 100) {
    if (kind === 'reset_credit') {
      const warn = remaining > 30 ? `\n\nLưu ý: tài khoản này vẫn còn ${Math.round(remaining)}% hạn mức. Reset lúc này sẽ phí lượt miễn phí; nên dùng khi gần hết.` : '';
      if (!confirm(`Dùng 1 lượt RESET MIỄN PHÍ của "${account.label}"?\nHạn mức phiên 5 giờ và tuần sẽ được làm đầy lại. Lượt này chỉ dùng được một lần, không hoàn tác.${warn}`)) return;
    }
    const label = button.textContent; button.disabled = true; button.textContent = 'Đang gửi tới máy…';
    try {
      const { id } = await api('/usage/command', { method: 'POST', body: JSON.stringify({ kind, ...accountCommandTarget(account, provider), confirm: kind === 'reset_credit' }) });
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const cmd = await api(`/usage/command/${id}`);
        if (cmd.status === 'done' || cmd.status === 'error') {
          const text = { reset: 'Đã reset hạn mức', nothingToReset: 'Hạn mức đang đầy nên Codex không reset', noCredit: 'Không còn lượt reset', alreadyRedeemed: 'Lượt này đã được dùng trước đó', refreshed: 'Đã đọc lại hạn mức' };
          notify(cmd.status === 'error' ? `Máy báo lỗi: ${cmd.error}` : text[cmd.outcome] || `Kết quả: ${cmd.outcome}`);
          await refreshMachines(); return;
        }
      }
      notify('Máy chưa phản hồi (có thể đang offline). Lệnh sẽ chạy khi máy online lại.');
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; button.textContent = label; }
  }

  function setupForm() {
    const form = $('task-form');
    $('brief').removeAttribute('maxlength');
    $('brief').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.ctrlKey&&!event.metaKey){event.preventDefault();form.requestSubmit()}});
    const controls = make('div', 'live-controls');
    const shopField = make('label', '', 'Shop (tuỳ chọn)');
    const shop = make('select');
    shop.id = 'live-shop';
    shop.append(new Option('Tất cả shop được phép', ''));
    capabilities.shops.forEach(name => shop.append(new Option(name, name)));
    shopField.append(shop);
    // AI accounts of the chosen machine as checkboxes; the hidden provider select only
    // narrows the model list when every ticked account is the same vendor.
    const providerField = make('fieldset', 'live-accounts');
    providerField.append(make('legend', '', 'Tài khoản AI được dùng'));
    const accountList = make('div', 'live-account-list');
    const provider = make('select'); provider.id = 'live-provider'; provider.hidden = true;
    provider.append(new Option('auto', 'auto'), new Option('Claude', 'claude'), new Option('ChatGPT', 'codex'));
    providerField.append(accountList, provider);
    const unticked = new Set();
    let modelChoice;
    const checkedAccounts = () => [...accountList.querySelectorAll('input:checked')].map(i => i.value);
    function syncProvider() {
      const chosen = accountsOf(capabilities, executor.value).filter(a => checkedAccounts().includes(a.id));
      const vendors = [...new Set(chosen.map(a => a.provider))];
      const value = vendors.length === 1 ? vendors[0] : 'auto';
      if (provider.value !== value) { provider.value = value; provider.dispatchEvent(new Event('change')); }
    }
    function renderAccounts() {
      accountList.replaceChildren();
      for (const account of accountsOf(capabilities, executor.value)) {
        const label = make('label', `live-account${account.online ? '' : ' is-offline'}`);
        const box = make('input'); box.type = 'checkbox'; box.value = account.id;
        box.checked = account.online && !account.removalPending && !unticked.has(account.id); box.disabled = !account.online || !!account.removalPending;
        box.onchange = () => { box.checked ? unticked.delete(account.id) : unticked.add(account.id); syncProvider(); modelChoice?.refresh(); };
        const windows = (account.usage?.[account.provider]?.windows || []).filter(w => !(w.resetsAt && w.resetsAt * 1000 <= Date.now()));
        const left = ids => { const w = windows.find(x => ids.includes(x.id)); return w ? `${Math.round(w.remainingPercent)}%` : 'chưa rõ'; };
        const quota = `Phiên ${left(['five_hour', 'codex:primary'])} · Tuần ${left(['seven_day', 'codex:secondary'])}`;
        label.append(box, make('strong', '', account.label),
          make('small', '', [account.provider === 'codex' ? 'ChatGPT' : 'Claude', account.removalPending ? 'đang chờ gỡ' : account.online ? quota : 'offline'].filter(Boolean).join(' · ')));
        accountList.append(label);
      }
      if (!accountList.children.length) accountList.append(make('small', '', 'Máy này chưa có tài khoản AI nào kết nối.'));
      syncProvider();
      modelChoice?.refresh();
    }
    window.mocOfficeRenderAccounts = renderAccounts;
    // Used by the 3D robots ("Chỉ dùng AI này"): tick just this account for the next question.
    window.mocOfficeUseOnlyAccount = id => {
      const accounts = accountsOf(capabilities, executor.value);
      if (!accounts.some(a => a.id === id && a.online && !a.removalPending)) return false;
      accounts.forEach(a => (a.id === id ? unticked.delete(a.id) : unticked.add(a.id)));
      renderAccounts();
      return true;
    };
    const executorField = make('label', '', 'Máy xử lý');
    const executor = make('select');
    executor.id = 'live-executor';
    executor.append(new Option('Worker máy chủ (tùy chọn)', 'vps'));
    localMachines(capabilities).forEach(machine => executor.append(new Option(
      machineLabel(machine), machine.id)));
    const preferred = preferredMachine(capabilities);
    if (preferred) executor.value = preferred.id;
    executorField.append(executor);
    const projectField = make('label', '', 'Dự án / Drive chung (tuỳ chọn)');
    const project = make('select'); project.id = 'live-project';
    const fillProjects = () => {
      const chosen = project.value || '';
      project.replaceChildren(new Option('Không gắn dự án', ''));
      (window.mocOfficeProjects?.list?.() || []).forEach(p => project.append(new Option(p.name, p.id)));
      project.value = [...project.options].some(o => o.value === chosen) ? chosen : '';
    };
    fillProjects(); project.value = '';
    window.addEventListener('office:projects-changed', fillProjects);
    projectField.append(project);
    projectField.hidden = !capabilities.fileAccess;
    const splitField = make('label', '', 'Chia việc');
    const split = make('select'); split.id = 'live-split';
    split.append(new Option('Một AI làm toàn bộ', 'off'), new Option('CLI tối giản — câu hỏi + tệp', 'direct'), new Option('Tự động — việc dễ 1 AI, việc lớn chia nhỏ', 'auto'), new Option('Chia cho nhiều AI làm song song', 'on'));
    split.value = 'off';
    splitField.append(split);
    const splitNote = make('small', '', 'CLI tối giản dùng một phiên CLI, gửi nguyên câu hỏi, ảnh nhỏ và Excel/TXT trực tiếp; chọn đúng model, effort và máy để so với CLI bạn tự dùng.');
    splitNote.hidden = true;
    splitField.append(splitNote);
    const reviewField = make('label', 'live-review-toggle'); reviewField.hidden = true;
    const review = make('input'); review.type = 'checkbox'; review.checked = true; review.id = 'live-review';
    reviewField.append(review, document.createTextNode(' Model khác kiểm tra chéo phần khó / có số liệu (thêm lượt, chính xác hơn)'));
    split.addEventListener('change', () => {
      if (split.value === 'direct' && initialAttachments?.hasPending() && !initialAttachments.canSendDirect()) {
        split.value = 'off';
        notify('CLI tối giản nhận ảnh JPG/PNG/WebP/GIF, Excel .xlsx và TXT đến 20 MB.');
      }
      const direct = split.value === 'direct';
      if (direct) project.value = '';
      projectField.hidden = direct || !capabilities.fileAccess;
      if (attachmentBox) attachmentBox.hidden = false;
      splitNote.hidden = !direct;
      reviewField.hidden = direct || split.value === 'off';
    });
    const workspace=cli.workspaceControl({executor,accountsOf});
    controls.append(executorField, workspace.field, projectField, splitField, reviewField, providerField);
    modelChoice = modelControls(controls, null, provider, () => accountsOf(capabilities, executor.value).filter(account => checkedAccounts().includes(account.id)));
    form.querySelector('.quick-briefs').after(controls);
    executor.addEventListener('change', () => { renderAccounts(); renderMachineUsage(); });
    renderAccounts(); renderMachineUsage();
    form.querySelector('.workflow-preview').hidden = true;
    $('modal-title').textContent = 'Hôm nay làm video nào?';
    $('task-modal').querySelector('.modal > p').textContent = 'Chọn một bước bên dưới rồi điền số video, hoặc tự viết đề bài. Chọn máy Windows và thư mục repo video ở Máy xử lý. Có thể hỏi tiếp trong cùng cuộc hội thoại.';
    form.querySelector(':scope > small').textContent = capabilities.fileAccess
      ? 'AI thực hiện theo đề bài trên máy đã chọn. Bạn có thể yêu cầu tra cứu số liệu, tạo/sửa tệp hoặc xử lý công việc trong phần mềm.'
      : 'Hệ thống chọn AI phù hợp. AI chỉ tạo bản nháp theo quyền tài khoản.';
    const initialAttachments=mountAttachments(form,$('brief'),'new-task',null);
    mountSpeech({form,input:$('brief'),make,scope:$('task-modal')});
    startNewChat=()=>{
      stopSpeech();
      initialAttachments.clear();$('brief').value='';project.value='';
      hideModal('result-modal');$('new-task').click();$('brief').focus();
    };
    mountSlash({form,input:$('brief'),make,api,attachments:initialAttachments,onNew:()=>startNewChat(),onAction:(name,args,show)=>runOfficeSlash(name,args,null,modelChoice,show)});
    const attachmentBox=form.querySelector('.live-attachments');
    form.onsubmit = async event => {
      event.preventDefault();
      const question = $('brief').value.trim() || 'Xem và xử lý tệp đính kèm.';
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const attachedProjectId=await initialAttachments.prepare(question,project.value||undefined);
        const created = await api('/tasks', { method: 'POST', body: JSON.stringify({ question, shop: shop.value, images:initialAttachments.imageNames(), mediaIds:initialAttachments.mediaIds(),
          provider: 'auto', workspace:workspace.value()||undefined, accounts: checkedAccounts(), executor: executor.value, split: split.value, review: review.checked, projectId: attachedProjectId || undefined, model: modelChoice.model.value, effort: modelChoice.effort.value }) });
        workspace.remember();
        initialAttachments.clear();
        $('brief').value = '';
        hideModal('task-modal');
        window.mocOfficeLayout?.showTab('work');
        if (created.teamRole === 'plan') notify('Việc lớn: AI đang lập kế hoạch rồi chia cho nhiều AI (khó → model mạnh, dễ → model nhẹ).'); else
        notify(`Đã giao cho ${providerName(created.provider)} trên ${executorName(created.executor)}.`);
        if (!created.teamRole) openResult(created);
        await refresh();
        $('task-list').scrollTop = 0;
      } catch (error) { initialAttachments.unlock(); if(attachmentBox)attachmentBox.querySelector('[role=status]').textContent=error.message; notify(error.message); }
      finally { submit.disabled = false; }
    };
    window.addEventListener('office:prepare-task', event => {
      stopSpeech();
      $('brief').value = String(event.detail?.question || '');
      if (event.detail?.project) { fillProjects(); project.value = event.detail.project; }
      const machine = event.detail?.machine;
      if ([...executor.options].some(option => option.value === machine)) {executor.value = machine;executor.dispatchEvent(new Event('change'));}
      renderAccounts(); renderMachineUsage();
      $('new-task').click();
      $('brief').focus();
    });
    $('sample-task').onclick = () => {
      stopSpeech();
      $('brief').value = 'Đọc repo video trong thư mục tôi chọn: liệt kê từng video đang làm dở, bước đã xong (kịch bản, soát, giọng, ảnh, dựng, QA, đăng) và bước tiếp theo. Chỉ đọc, không chạy gì tốn credit.';
      $('new-task').click();
    };
  }

  async function refreshMachines() {
    try {
      const latest = await api('/capabilities');
      capabilities = latest;
      renderJobs();
      const executor = $('live-executor');
      if (!executor) return;
      const chosen = executor.value;
      executor.replaceChildren(new Option('Worker máy chủ (tùy chọn)', 'vps'));
      localMachines(latest).forEach(machine => executor.append(new Option(
        machineLabel(machine), machine.id)));
      if ([...executor.options].some(option => option.value === chosen)) executor.value = chosen;
      if(executor.value === 'vps') { const preferred=preferredMachine(latest);if(preferred)executor.value=preferred.id; }
      if(executor.value!==chosen)executor.dispatchEvent(new Event('change'));
      $('live-text').textContent = latest.vpsOnline || localMachines(latest).some(machine=>machine.online) ? 'AI đang online' : 'Chưa có worker AI online';
      window.mocOfficeRenderAccounts?.();
      renderMachineUsage();
    } catch { renderMachineUsage(); }
  }

  try {
    capabilities = await api('/capabilities');
    document.querySelector('.demo-tag').textContent = 'OFFICE AI · ĐỘC LẬP';
    document.querySelector('footer span').textContent = 'OFFICE AI';
    $('live-text').textContent = capabilities.vpsOnline || localMachines(capabilities).some(machine=>machine.online) ? 'AI đang online' : 'Chưa có worker AI online';
    $('pause').hidden = true;
    setupForm();
    setNote('Chọn máy đang online để giao việc. Chạy npm run worker nếu chưa có máy kết nối; tài khoản AI do bạn tự đăng nhập.');
    await refresh();
    setInterval(refresh, 3000);
    setInterval(refreshMachines, 10000);
  } catch (error) {
    document.querySelector('.demo-tag').textContent = 'CẦN ĐĂNG NHẬP';
    setNote(`Văn phòng AI chưa kết nối: ${error.message}. Hãy đăng nhập ứng dụng rồi tải lại trang.`);
    $('new-task').disabled = true;
    $('assign-agent').disabled = true;
    $('sample-task').disabled = true;
  }
}
