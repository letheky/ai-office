import { deletePassword } from './office-delete.mjs?v=1';
// "Tệp dự án": shared Google Drive folders that every AI Office machine reads from
// and publishes to. Files go to Drive; the office keeps only names and links.
const $ = id => document.getElementById(id);
const make = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};
const pane = $('pane-projects');
const kindText = { input: 'Đầu vào', plan: 'Kế hoạch', step: 'Kết quả từng bước', final: 'Bản hoàn thiện', other: 'Khác' };
const folderText = { 'dau-vao': 'Đầu vào (tư liệu gốc)', 'ke-hoach': 'Kế hoạch', 'hoan-thien': 'Bản hoàn thiện' };
let state = { configured: false, projects: [], selected: localStorage.getItem('tb_ai_project') || '', files: [], error: '' };
window.mocOfficeProjects = { list: () => state.projects, selected: () => state.selected };

async function api(path, options = {}) {
  const response = await fetch(`/api/ai-office/projects${path}`, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !/mật khẩu/i.test(data.error || '')) { window.mocOfficeSessionExpired?.(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  if (!response.ok || !data.success) throw new Error(data.error || `Lỗi HTTP ${response.status}`);
  return data.data;
}
const size = bytes => bytes == null ? '' : bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const toast = message => {
  const element = $('toast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 4000);
};

function render() {
  pane.replaceChildren();
  const head = make('div', 'section-top');
  head.append(make('h2', '', 'Tệp dự án'), make('span', 'small-pill', `${state.projects.length} dự án`));
  pane.append(head);
  if (!state.configured) {
    pane.append(make('p', 'project-warning', 'Chưa cấu hình rclone.'));
    return;
  }
  const create = make('form', 'project-create');
  const name = make('input'); name.placeholder = 'Tên dự án mới, ví dụ: Video thảm yoga'; name.maxLength = 80; name.required = true;
  name.setAttribute('aria-label', 'Tên dự án mới');
  const add = make('button', 'soft-button', '＋ Tạo'); add.type = 'submit';
  create.append(name, add);
  create.onsubmit = async event => {
    event.preventDefault(); add.disabled = true;
    try {
      const project = await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value.trim() }) });
      state.projects.unshift(project); select(project.id); toast('Đã tạo dự án và thư mục Drive.');
      window.dispatchEvent(new Event('office:projects-changed'));
    } catch (error) { toast(error.message); }
    finally { add.disabled = false; }
  };
  pane.append(create);
  if (!state.projects.length) { pane.append(make('p', 'project-empty', 'Chưa có dự án. Tạo một dự án để bắt đầu.')); return; }

  const picker = make('label', 'project-picker', 'Dự án đang xem');
  const choose = make('select');
  state.projects.forEach(p => choose.append(new Option(p.name, p.id)));
  choose.value = state.selected; choose.onchange = () => select(choose.value);
  picker.append(choose); pane.append(picker);
  const project = state.projects.find(p => p.id === state.selected);
  if (!project) return;

  const actions = make('div', 'project-actions');
  if (project.link) {
    const open = make('a', 'soft-button', 'Mở thư mục Drive ↗'); open.href = project.link; open.target = '_blank'; open.rel = 'noopener noreferrer';
    actions.append(open);
  }
  const assign = make('button', 'primary', '＋ Giao việc trong dự án'); assign.type = 'button';
  assign.onclick = () => window.dispatchEvent(new CustomEvent('office:prepare-task', { detail: { project: project.id } }));
  actions.append(assign);
  const remove = make('button', 'soft-button office-delete-button', 'Xóa dự án'); remove.type = 'button';
  remove.onclick = async () => {
    const password = await deletePassword('Xóa dự án?', `Xóa “${project.name}” và toàn bộ tệp trong thư mục Drive của dự án. Nếu còn luồng công việc liên quan, hãy xóa luồng đó trước.`);
    if (password === null) return;
    remove.disabled = true;
    try {
      await api(`/${project.id}`, { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ password }) });
      state.projects = state.projects.filter(item => item.id !== project.id);
      state.selected = state.projects[0]?.id || '';
      state.files = [];
      if (state.selected) localStorage.setItem('tb_ai_project', state.selected); else localStorage.removeItem('tb_ai_project');
      window.dispatchEvent(new Event('office:projects-changed'));
      render(); loadFiles(); toast('Đã xóa dự án và thư mục Drive.');
    } catch (error) { toast(error.message); remove.disabled = false; }
  };
  actions.append(remove);
  pane.append(actions);

  const upload = make('form', 'project-upload');
  const target = make('select'); target.setAttribute('aria-label', 'Thư mục tải lên');
  Object.entries(folderText).forEach(([value, label]) => target.append(new Option(label, value)));
  const input = make('input'); input.type = 'file'; input.multiple = true; input.setAttribute('aria-label', 'Chọn tệp tải lên');
  const send = make('button', 'soft-button', '↑ Tải lên Drive'); send.type = 'submit';
  const progress = make('progress'); progress.max = 100; progress.hidden = true;
  upload.append(target, input, send, progress);
  upload.onsubmit = event => {
    event.preventDefault();
    if (!input.files.length) return toast('Chọn ít nhất một tệp.');
    const form = new FormData(); form.append('folder', target.value);
    [...input.files].slice(0, 10).forEach(file => form.append('file', file));
    const request = new XMLHttpRequest();
    request.open('POST', `/api/ai-office/projects/${project.id}/files`);
    request.upload.onprogress = e => { if (e.lengthComputable) progress.value = Math.round(e.loaded / e.total * 95); };
    request.onload = () => {
      send.disabled = false; progress.hidden = true;
      let data = {}; try { data = JSON.parse(request.responseText); } catch {}
      if (request.status >= 300 || !data.success) return toast(data.error || `Tải lên lỗi HTTP ${request.status}`);
      toast(`Đã lưu ${data.data.saved.length} tệp vào Drive.`); input.value = ''; loadFiles(true);
    };
    request.onerror = () => { send.disabled = false; progress.hidden = true; toast('Mất kết nối khi tải lên.'); };
    send.disabled = true; progress.hidden = false; progress.value = 0;
    request.send(form);
  };
  pane.append(upload, make('small', 'project-note', 'Tệp tối đa 2 GB/tệp, 10 tệp/lần. Video lớn có thể tải trực tiếp vào thư mục Drive rồi bấm Làm mới. Trùng tên sẽ tự thêm số, không ghi đè.'));

  const listHead = make('div', 'section-top');
  const refresh = make('button', 'project-refresh', '↻ Làm mới'); refresh.type = 'button'; refresh.onclick = () => loadFiles(true);
  listHead.append(make('h3', '', 'Tệp trên Drive'), refresh);
  pane.append(listHead);
  if (state.error) pane.append(make('p', 'project-warning', state.error));
  if (!state.files.length && !state.error) pane.append(make('p', 'project-empty', 'Chưa có tệp nào.'));
  for (const kind of ['input', 'plan', 'step', 'final', 'other']) {
    const files = state.files.filter(f => f.kind === kind);
    if (!files.length) continue;
    const group = make('section', 'project-group');
    group.append(make('h4', '', `${kindText[kind]} · ${files.length}`));
    for (const file of files.slice(0, 60)) {
      const row = make('div', 'project-file');
      const link = make(file.link ? 'a' : 'span', '', file.path.split('/').slice(1).join('/') || file.name);
      if (file.link) { link.href = file.link; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      row.append(link, make('small', '', [size(file.size), file.modTime && new Date(file.modTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })].filter(Boolean).join(' · ')));
      const removeFile = make('button', 'project-file-delete', 'Xóa'); removeFile.type = 'button';
      removeFile.setAttribute('aria-label', `Xóa ${file.path}`);
      removeFile.onclick = async () => {
        const password = await deletePassword('Xóa tệp khỏi Drive?', `Xóa “${file.path}” khỏi dự án “${project.name}”.`);
        if (password === null) return;
        removeFile.disabled = true;
        try {
          await api(`/${project.id}/files`, { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ path:file.path, password }) });
          state.files = state.files.filter(item => item.path !== file.path); render(); toast('Đã xóa tệp khỏi Drive.');
        } catch (error) { toast(error.message); removeFile.disabled = false; }
      };
      row.append(removeFile);
      group.append(row);
    }
    pane.append(group);
  }
}

async function loadFiles(fresh = false) {
  if (!state.selected) return render();
  try { state.files = await api(`/${state.selected}/files${fresh ? '?fresh=1' : ''}`); state.error = ''; }
  catch (error) { state.files = []; state.error = error.message; }
  render();
}
function select(id) {
  state.selected = id; state.files = [];
  try { localStorage.setItem('tb_ai_project', id); } catch {}
  render(); loadFiles();
}

if (pane && location.protocol !== 'file:') {
  api('').then(data => {
    state.configured = data.configured; state.projects = data.projects;
    if (!state.projects.some(p => p.id === state.selected)) state.selected = state.projects[0]?.id || '';
    window.dispatchEvent(new Event('office:projects-changed'));
    render(); loadFiles();
  }).catch(error => { pane.replaceChildren(make('h2', '', 'Tệp dự án'), make('p', 'project-warning', error.message)); });
}
