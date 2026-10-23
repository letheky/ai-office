const pane = document.getElementById('pane-capabilities');
let data = null, selectedMachine = '', loading = false;
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function machine() { return selectedMachine === 'vps' ? data?.vpsMachine : data?.machines.find(m => m.id === selectedMachine); }
function toolState(id) {
  const m = machine(), tool = m?.tools?.[id];
  if (!m?.online) return 'Máy offline';
  if (!tool || !tool.checkedAt || Date.now() - tool.checkedAt > 300000) return 'Chưa có dữ liệu mới';
  if (tool.ready) return 'Sẵn sàng';
  if (!tool.available) return 'Chưa cài / chưa có dịch vụ';
  if (!tool.enabled) return 'Chưa bật cho worker';
  return 'Đã cài · chưa sẵn sàng';
}
function prepare(question) {
  if (!document.getElementById('live-executor') || !machine()?.online) return;
  if (machine()?.name !== 'máy trạm') {
    const windows = (machine()?.profile?.platform || machine()?.policy?.declaredPlatform) === 'win32';
    question = question.replace(/\/run\/media\/pc\/[^ ,]+/g, windows ? '[đường dẫn dự án Windows cần cung cấp]' : '[đường dẫn dự án trên máy đã chọn cần cung cấp]')
      .replace(/trên máy trạm/g, `trên ${machine()?.name || 'máy đã chọn'}`);
  }
  window.dispatchEvent(new CustomEvent('office:prepare-task', { detail: { question, machine: selectedMachine } }));
}
function exampleButton(question) {
  const button = make('button', 'cap-example', 'Điền đề bài mẫu');
  button.type = 'button';
  button.disabled = !document.getElementById('live-executor') || !machine()?.online;
  button.addEventListener('click', () => prepare(question));
  return button;
}
function render() {
  if (!data?.catalog) return;
  const c = data.catalog;
  pane.replaceChildren(make('h2', '', 'Văn phòng làm được gì?'));
  pane.append(make('p', 'cap-intro', data.fileAccess
    ? 'Bạn là admin: AI có thể chạy lệnh và đọc/sửa tệp trong quyền user của hệ điều hành trên máy đã chọn. Máy VPS và máy trạm là hai nơi thực thi khác nhau.'
    : 'Tài khoản hiện tại tra cứu và tạo bản nháp theo quyền được cấp; không được thêm công cụ điều khiển máy.'));
  const machineLabel = make('label', 'cap-machine', 'Xem công cụ trên máy');
  machineLabel.htmlFor = 'cap-machine';
  const select = make('select'); select.id = 'cap-machine';
  select.append(new Option(`VPS · ${data.vpsOnline ? 'online' : 'offline'}`, 'vps'));
  for (const m of data.machines) select.append(new Option(`${m.name} · ${m.online ? 'online' : 'offline'}`, m.id));
  select.value = selectedMachine;
  select.addEventListener('change', () => { selectedMachine = select.value; render(); });
  machineLabel.append(select); pane.append(machineLabel);
  const m = machine(), p = m?.profile;
  const profile = make('section', 'cap-host-profile');
  profile.append(make('h3', '', m?.policy?.label || 'Hồ sơ máy'));
  const platforms = { linux:'Linux', win32:'Windows', darwin:'macOS', freebsd:'FreeBSD', unknown:'Chưa xác định' };
  if (p) {
    profile.append(make('p', '', `${platforms[p.platform] || p.platform} ${p.arch || ''} · ${p.logicalCpus || '?'} luồng CPU · ${p.memoryGb || '?'} GB RAM`));
    if (p.cpuModel) profile.append(make('p', 'cap-muted', p.cpuModel));
    for (const gpu of p.gpus || []) profile.append(make('p', 'cap-muted', `${gpu.name}${gpu.memoryGb ? ` · ${gpu.memoryGb} GB VRAM` : ''}`));
    profile.append(make('small', 'cap-muted', `Cấu hình worker báo lúc ${p.checkedAt ? new Date(p.checkedAt).toLocaleString('vi-VN') : 'chưa rõ'}${!m.online ? ' · thông tin lần cuối, chưa xác nhận hiện tại' : ''}.`));
  } else profile.append(make('p', '', m?.policy?.declaredPlatform ? `${platforms[m.policy.declaredPlatform]} theo chủ máy · chờ worker báo CPU/RAM/GPU.` : 'Chưa nhận cấu hình từ worker.'));
  if (m?.policy?.detail) profile.append(make('p', '', m.policy.detail));
  if (!m?.online) profile.append(make('p', 'cap-error', `Máy đang offline. Chưa thể giao việc; lần liên lạc cuối: ${m?.lastSeen ? new Date(m.lastSeen).toLocaleString('vi-VN') : 'chưa rõ'}.`));
  profile.append(make('small', 'cap-muted', 'Model Claude/ChatGPT chạy trên dịch vụ của nhà cung cấp. CPU/GPU máy này chủ yếu ảnh hưởng công cụ, tệp và dựng media, không quyết định độ thông minh của model.'));
  pane.append(profile);
  const toolList = make('dl', 'cap-tool-list');
  for (const [id, label] of [['python', 'Python (kịch bản, giọng, ảnh, đăng)'], ['node', 'Node 22+ (Remotion)'], ['ffmpeg', 'FFmpeg (âm thanh, QA)'], ['git', 'Git'], ['browser', 'Brave CDP cổng 9333']]) {
    const row = make('div'); row.append(make('dt', '', label));
    const state = toolState(id), value = make('dd', state === 'Sẵn sàng' ? 'cap-ready' : '', state);
    const tool = machine()?.tools?.[id];
    if (tool?.version) value.append(make('small', '', `v${tool.version}`));
    row.append(value); toolList.append(row);
  }
  pane.append(toolList);
  if (!m?.online && Object.keys(m?.lastTools || {}).length) {
    const last = make('details', 'cap-section'); last.append(make('summary', '', 'Công cụ ghi nhận lần cuối · không phải trạng thái sẵn sàng'));
    for (const [id, t] of Object.entries(m.lastTools)) last.append(make('p', '', `${id}: ${t.available ? 'đã có' : 'chưa có'}${t.version ? ` v${t.version}` : ''} · ${t.checkedAt ? new Date(t.checkedAt).toLocaleString('vi-VN') : 'chưa rõ thời điểm'}`));
    pane.append(last);
  }
  const checked = Object.values(machine()?.tools || {}).map(t => t.checkedAt || 0);
  if (checked.length) pane.append(make('small', 'cap-muted', `Máy kiểm tra lúc ${new Date(Math.min(...checked)).toLocaleTimeString('vi-VN')} · làm mới khoảng 2 phút/lần. Trạng thái này không bảo đảm mọi website hoặc tác vụ đều thành công.`));
  const features = make('section', 'cap-features'); features.append(make('h3', '', 'Tính năng hiện có'));
  for (const feature of c.features) {
    const article = make('article');
    const title = make('div', 'cap-feature-title'); title.append(make('h4', '', feature.title));
    const status = !machine()?.online ? 'Máy offline · chưa thể thực hiện' : feature.admin && !data.fileAccess ? 'Cần tài khoản admin'
      : feature.tools.length ? feature.tools.map(toolState).every(s => s === 'Sẵn sàng') ? 'Công cụ sẵn sàng' : 'Xem trạng thái công cụ ở trên' : 'Đã tích hợp';
    title.append(make('span', 'cap-badge', status));
    article.append(title, make('p', '', feature.detail), exampleButton(feature.example)); features.append(article);
  }
  pane.append(features);
  const limits = make('details', 'cap-section'); limits.open = true;
  limits.append(make('summary', '', 'Giới hạn cần biết'));
  const list = make('ul'); for (const line of c.limits) list.append(make('li', '', line)); limits.append(list); pane.append(limits);
  const coordination = make('section', 'cap-section'); coordination.append(make('h3', '', c.collaboration.title), make('p', '', c.collaboration.detail), exampleButton(c.collaboration.example)); pane.append(coordination);
  const departments = make('details', 'cap-section'); departments.append(make('summary', '', 'Phân công 8 vai trò trong văn phòng'));
  for (const d of c.departments) {
    const item = make('p'); item.append(make('strong', '', `${d.agent} · ${d.role}: `), document.createTextNode(d.detail)); departments.append(item);
  }
  pane.append(departments);
  const repos = make('details', 'cap-section'); repos.append(make('summary', '', `${c.repositories.length} công cụ trong stack`));
  repos.append(make('p', 'cap-muted', 'Phần trả tiền chỉ có ElevenLabs (giọng) và subscription Codex (ảnh). YouTube API, Remotion (cá nhân/nhóm dưới 4 người), ffmpeg, Python, Node miễn phí.'));
  for (const repo of c.repositories) {
    const item = make('article'); const link = make('a', '', repo.name); link.href = repo.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    item.append(link, make('small', 'cap-muted', ` · ${repo.license}`), make('p', '', repo.fit));
    if (repo.tool) item.append(make('small', '', `Máy đang chọn: ${toolState(repo.tool)}`));
    repos.append(item);
  }
  pane.append(repos, make('p', 'cap-muted', 'Điền đề bài mẫu chỉ mở form để bạn xem và sửa. AI chỉ chạy khi bạn bấm giao việc.'));
}
async function refresh() {
  if (loading || pane.hidden || document.hidden) return;
  loading = true;
  try {
    const response = await fetch('/api/ai-office/capabilities', { credentials: 'same-origin' });
    if (response.status === 401) { window.mocOfficeSessionExpired?.(); throw new Error('Phiên đăng nhập đã hết hạn — đăng nhập lại để xem năng lực.'); }
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Không đọc được năng lực. Hãy đăng nhập lại.');
    data = json.data;
    if (!selectedMachine || (selectedMachine !== 'vps' && !data.machines.some(m => m.id === selectedMachine))) {
      selectedMachine = data.machines.find(m => m.online && m.profile?.platform === 'win32')?.id || data.machines.find(m => m.online)?.id || 'vps';
    }
    // Avoid resetting focus, dropdowns and expanded sections on every heartbeat.
    const signature = JSON.stringify(data);
    if (pane.dataset.signature !== signature) {
      const opened = [...pane.querySelectorAll('details')].map(d => d.open);
      const scroll = pane.scrollTop;
      render();
      if (opened.length) [...pane.querySelectorAll('details')].forEach((d, i) => { d.open = opened[i]; });
      pane.scrollTop = scroll; pane.dataset.signature = signature;
    }
    pane.querySelector('.cap-error')?.remove();
  } catch (error) {
    let note = pane.querySelector('.cap-error');
    if (!note) { note = make('p', 'cap-error'); note.setAttribute('role', 'status'); pane.prepend(note); }
    note.textContent = error.message;
  } finally { loading = false; }
}
new MutationObserver(refresh).observe(pane, { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('focus', refresh);
setInterval(refresh, 15000);
refresh();
