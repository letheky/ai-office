const { workspacePath } = require('./ai-office-workspace');
const { runCodexServer } = require('./ai-office-codex-server');
const {nativeActions}=require('./ai-office-native-command');
const {fileActions,fileCommand}=require('./ai-office-file-command');
// Native CLI history stays on the account's machine. Never accept a session ID
// from the browser; a parent must match the owner, scope and configured profile.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const { spawn } = require('child_process');
const { subscriptionEnv, assertSubscription } = require('./ai-office-cli');
const { cliModelArgs } = require('../src/services/aiOfficeModels');
const { claudeExecution, codexExecution } = require('./ai-office-execution');
const {claudeContext}=require('./ai-office-claude-context');
const STOPPED = 'Đã dừng theo yêu cầu của bạn';
const phases = { waiting_tool: 'Đang chờ lượt dùng trình duyệt', starting: 'Đang mở phiên CLI', thinking: 'AI đang xử lý', tool: 'AI đang dùng công cụ', writing: 'AI đang soạn trả lời', saving: 'Đang lưu kết quả' };
const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,100}$/i.test(id);
function withImageReferences(prompt, images = [], previousImages = []) {
  const references = [
    ...(images.length ? [`Ảnh mới đính kèm trong tin nhắn này (ưu tiên ảnh này khi người dùng nói "ảnh này"; mở tệp để xem): ${images.join(', ')}`] : []),
    ...(previousImages.length ? [`Ảnh đã gửi trong cuộc trò chuyện, còn trên máy này: ${previousImages.join(', ')}`] : []),
  ];
  return references.length ? `${prompt}\n\n${references.join('\n')}` : prompt;
}
function sessionStore(root, job, env = process.env) {
  const dir = path.join(root, '.office-sessions');
  const scope = JSON.parse(job.context_json || '{}').session_scope || '';
  const fingerprint = createHash('sha256').update(JSON.stringify([job.created_by, !!job.allow_files, scope, job.provider,
    job.provider === 'codex' ? env.CODEX_HOME || path.join(os.homedir(), '.codex') : env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), ...(job.workspace ? [job.workspace] : [])])).digest('hex');
  const filename = id => { if (!validId(id)) throw new Error('ID công việc không hợp lệ'); return path.join(dir, `${id}.json`); };
  return {
    read(parentId) {
      if (!parentId) return null;
      try {
        const value = JSON.parse(fs.readFileSync(filename(parentId), 'utf8'));
        if (value.fingerprint === fingerprint && /^[a-f0-9-]{36}$/i.test(value.sessionId || '')) return value.sessionId;
      } catch {}
      return null;
    },
    write(sessionId) {
      if (!/^[a-f0-9-]{36}$/i.test(sessionId || '')) throw new Error('CLI chưa trả mã phiên; không thể xác nhận lưu hội thoại');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const target = filename(job.id), temp = `${target}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temp, JSON.stringify({ sessionId, fingerprint }), { mode: 0o600 });
        fs.renameSync(temp, target);
      } finally { try { fs.unlinkSync(temp); } catch {} }
    },
  };
}
function sessionArgs(provider, modelArgs, toolArgs, fileAccess, parentSession, output, cwd, images = []) {
  if (provider === 'codex') return ['exec', ...(parentSession ? ['resume', parentSession] : []), '--json', ...modelArgs,
    '--skip-git-repo-check', ...toolArgs,
    '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"',
    '-c', `sandbox_mode="${fileAccess ? 'danger-full-access' : 'read-only'}"`, '-c', 'approval_policy="never"',
    ...(!parentSession ? ['-C', cwd] : []), '-o', output, ...images.flatMap(image => ['--image', image]), '-'];
  return [...modelArgs, ...toolArgs, ...(parentSession ? ['--resume', parentSession] : []),
    '-p', '--tools', fileAccess ? 'default' : '', ...(fileAccess ? ['--dangerously-skip-permissions'] : []),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
}
function runStream(command, prompt, cwd, provider, { control = async () => ({}), progress = () => {}, session = () => {}, emit = () => {}, action=null,expectedSession=null } = {}) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command.binary, command.args, { cwd, env: command.env, detached: grouped, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let buffer = '', stderr = '', sessionId = null, response = null, cancelled = false, finished = false, polling = false;
    let answer = '', events = '', phase = 'starting', claudeStreamed = false;
    let fatal=null,compacted=false;
    const contextTracker=claudeContext(emit);
    const emitProgress = next => { try { progress(next); } catch {} };
    const report = next => { if (phase !== next) { phase = next; emitProgress(next); } };
    const stop = () => {
      cancelled = true;
      try { grouped ? process.kill(-child.pid, 'SIGKILL') : child.kill('SIGKILL'); } catch {}
    };
    const tick = async () => {
      if (polling || finished) return; polling = true;
      try { const state = await control(); if (!finished && state?.cancelRequested) stop(); } catch { /* transient transport loss is not a reason to kill a turn */ }
      finally { polling = false; }
    };
    const shutdown = () => { stop(); process.exit(0); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    const cleanup = () => { finished = true; clearInterval(timer); process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); };
    const timer = setInterval(tick, 1000);
    tick(); emitProgress(command.binary === '/usr/bin/flock' ? 'waiting_tool' : 'starting');
    if(action==='compact'){emit({kind:'context',context:{state:'compacting',measuredAt:Date.now()}});emit({kind:'activity',type:'compact'})}
    function event(row) {
      if(fatal)return;
      if (provider === 'codex') {
        if (row.type === 'thread.started') { sessionId = row.thread_id; session(sessionId); }
        if (row.type === 'turn.started') report('thinking');
        if (row.type?.startsWith('item.')) {
          const item = row.item || {};
          if (item.type === 'agent_message' && row.type === 'item.completed') { answer = item.text || answer; emit({kind:'text',text:item.text||''}); report('writing'); }
          else if (row.type === 'item.started' && ['command_execution','mcp_tool_call','web_search','file_change'].includes(item.type)) { emit({kind:'activity',type:{command_execution:'command',mcp_tool_call:'tool',web_search:'search',file_change:'file'}[item.type]}); report('tool'); }
        }
        if (row.type === 'turn.completed') events += JSON.stringify(row) + '\n';
        if (row.type === 'turn.failed') response = { is_error: true, result: row.error?.message || 'CLI báo lỗi' };
      } else {
        if(action&&row.session_id&&row.session_id!==expectedSession){fatal=new Error('Claude không tiếp tục đúng phiên cũ; không xác nhận nén');stop();return}
        if (row.session_id && sessionId !== row.session_id) { sessionId = row.session_id; session(sessionId); }
        if(action==='compact'){
          if(!row.parent_tool_use_id&&row.type==='system'&&row.subtype==='compact_boundary'&&row.compact_metadata?.trigger==='manual')compacted=true;
          if(row.type==='result')response=row;
          return;
        }
        contextTracker.observe(row);
        if (row.type === 'system') report('thinking');
        if (row.type === 'stream_event' && !row.parent_tool_use_id) {
          if (row.event?.type === 'message_start') claudeStreamed = false;
          if (row.event?.type === 'content_block_delta' && row.event.delta?.type === 'text_delta') {
            emit({kind:'text',text:row.event.delta.text||''}); claudeStreamed = true; report('writing');
          }
        }
        if (row.type === 'assistant' && !row.parent_tool_use_id) {
          const blocks=row.message?.content||[];
          if (blocks.some(c=>c.type==='tool_use')) {emit({kind:'activity',type:'tool'});report('tool')}
          if (!claudeStreamed) for(const block of blocks)if(block.type==='text')emit({kind:'text',text:block.text||''});
          if(blocks.some(c=>c.type==='text'))report('writing');
        }
        if (row.type === 'result') response = row;
      }
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk; let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try { event(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-60000); });
    child.stdin.on('error', () => {});
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (buffer.trim()) { try { event(JSON.parse(buffer)); } catch {} }
      if(action==='compact'&&(fatal||cancelled||code!==0||response?.subtype!=='success'||response?.is_error||!compacted))emit({kind:'context',context:{state:'unknown',measuredAt:Date.now()}});
      if(fatal)return reject(fatal);
      if (cancelled) return reject(new Error(STOPPED));
      if (code !== 0 || response?.is_error || (provider === 'claude' && response?.subtype !== 'success'))
        return reject(new Error(response?.result || `AI thoát mã ${code}: ${stderr.slice(-500)}`));
      if(action==='compact'){
        if(!compacted||sessionId!==expectedSession)return reject(new Error(/not enough messages/i.test(response?.result||'')?'Phiên Claude chưa đủ tin nhắn để nén':'Claude kết thúc nhưng chưa xác nhận nén; không tự thử lại'));
        emit({kind:'context',context:{state:'awaiting',measuredAt:Date.now()}});
      }
      resolve({ sessionId, response, answer, events, stderr,context:action==='compact'?{state:'awaiting',used:null,limit:null,measuredAt:Date.now()}:contextTracker.read() });
    });
    child.stdin.end(prompt);
  });
}
async function answerSession(job, { root, binary, promptFor, images = [], previousImages = [], toolArgs = [], wrap = (binary, args, env) => ({ binary, args, env }), control, progress, emit = () => {}, acknowledge, codexAppServer = true }) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const selected = JSON.parse(job.selection_json || '{}');
  if (selected.workspace && !job.allow_files) throw new Error('Chỉ admin được chọn thư mục làm việc');
  const cwd = workspacePath(selected.workspace, root);
  const store = sessionStore(root, { ...job, workspace: selected.workspace ? cwd : null });
  emit({kind:'reset'});
  if(job.allow_files)emit({kind:'workspace',path:cwd});
  const context = JSON.parse(job.context_json || '{}');
  const parentSession = context.handoff ? null : store.read(context.parent_job_id);
  const action = context.session_command || null;
  if(action&&fileActions.has(action)){
    if(!job.allow_files)throw new Error('Không có quyền công cụ trên máy xử lý');
    if((await control?.())?.cancelRequested)throw new Error(STOPPED);
    progress?.('tool');emit({kind:'activity',type:action==='diff'?'command':'file'});
    const result=await fileCommand(action,cwd);if(parentSession)store.write(parentSession);
    return {result,execution:{model:null,effort:null,usage:null}};
  }
  const claudeCompact=action==='compact'&&job.provider==='claude';
  if(action && (!parentSession||(!claudeCompact&&(!nativeActions.has(action)||job.provider!=='codex'||!codexAppServer))))
    throw new Error(`Không thể chạy lệnh: cần phiên ${job.provider==='claude'?'Claude':'Codex'} gốc còn lưu trên đúng tài khoản/máy. Không gửi lệnh thành tin nhắn hay mở phiên mới thay thế.`);
  // A native turn already contains the full tool/conversation history. Only send
  // fresh context; legacy/handoff turns retain complete textual history.
  const runContext = { ...context };
  if (parentSession) { delete runContext.conversation; delete runContext.previous_data; }
  const input = { ...job, context_json: JSON.stringify(runContext) };
  const prompt = action ? '' : promptFor(input);
  // Keep a visible file reference as well as the native image item. Some CLI
  // sessions have accepted localImage but then recorded only the text turn.
  const promptWithImages = withImageReferences(prompt, images, previousImages);
  assertSubscription(binary, job.provider);
  if ((await control?.())?.cancelRequested) throw new Error(STOPPED);
  const output = path.join(root, `${job.id}.txt`);
  const models = cliModelArgs(job);
  if (job.provider === 'codex' && codexAppServer) {
    const config=JSON.parse(job.selection_json||'{}');
    const args=['app-server','--listen','stdio://',...toolArgs,'-c','model_provider="openai"','-c','forced_login_method="chatgpt"'];
    const result=await runCodexServer(wrap(binary,args,subscriptionEnv()),{cwd,model:config.model,effort:config.effort,fileAccess:!!job.allow_files,
      parentSession,prompt:promptWithImages,action,actionArgs:context.command_args||'',settings:selected,images:action?[]:images,control,progress,emit,acknowledge,session:id=>store.write(id)});
    if(!result.result)throw new Error('AI trả kết quả trống');
    store.write(result.sessionId);progress?.('saving');return {result:result.result,execution:result.execution};
  }
  const args = sessionArgs(job.provider, models, toolArgs, !!job.allow_files, parentSession, output, cwd, images);
  try {
    const result = await runStream(wrap(binary, args, subscriptionEnv()), claudeCompact?'/compact':promptWithImages, cwd, job.provider, { control, progress, emit,action,expectedSession:parentSession, session: id => store.write(id) });
    const text = claudeCompact?'Đã nén ngữ cảnh bằng lệnh gốc của Claude. Tiếp tục trong cùng phiên; lịch sử hiển thị vẫn được giữ.':job.provider === 'codex' ? (fs.existsSync(output) ? fs.readFileSync(output, 'utf8').trim() : result.answer) : String(result.response?.result || '').trim();
    if (!text) throw new Error('AI trả kết quả trống');
    store.write(result.sessionId);
    progress?.('saving');
    return { result: text, execution: job.provider === 'codex' ? codexExecution(result.stderr, result.events, models) : {...claudeExecution(result.response, cwd),...(result.context?{context:result.context}:{})} };
  } finally { try { fs.unlinkSync(output); } catch {} }
}
module.exports = { answerSession, sessionArgs, sessionStore, runStream, withImageReferences, phases, STOPPED };
