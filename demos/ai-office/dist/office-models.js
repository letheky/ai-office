// Tab "Model" (admin): enable models the CLIs offer, cap their effort, and pick
// which model + effort serves each difficulty tier used by automatic routing and team mode.
const pane = document.getElementById('pane-models');
const tab = document.getElementById('tab-models');
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const tierText = { easy: 'Dễ — tra cứu, viết ngắn', medium: 'Vừa — phân tích, nội dung dài', hard: 'Khó — đối soát, code, suy luận nhiều bước', planner: 'Lập kế hoạch chia việc' };
const providerText = { claude: 'Claude', codex: 'ChatGPT (Codex)' };
const sourceText = { builtin: 'có sẵn', worker: 'CLI báo', custom: 'tự thêm' };
let draft = null;

const toast = message => {
  const element = document.getElementById('toast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 4000);
};
async function api(options, suffix = '') {
  const response = await fetch(`/api/ai-office/models${suffix}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.mocOfficeSessionExpired?.(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  if (!response.ok || !data.success) throw new Error(data.error || `Lỗi HTTP ${response.status}`);
  return data.data;
}
const capOf = model => draft.maxEffort[model.id] || model.maxEffort;
const allowed = model => model.supported.slice(0, model.supported.indexOf(capOf(model)) + 1);

function load(cfg) {
  draft = { models: cfg.models, efforts: cfg.efforts,
    enabled: Object.fromEntries(cfg.models.map(m => [m.id, m.enabled])),
    maxEffort: Object.fromEntries(cfg.models.map(m => [m.id, m.maxEffort])),
    tiers: JSON.parse(JSON.stringify(cfg.tiers)),
    custom: cfg.models.filter(m => m.source === 'custom').map(m => ({ id: m.id, label: m.label, efforts: m.supported })) };
  render();
}

function render() {
  pane.replaceChildren(make('h2', '', 'Model & effort'));
  const refresh = make('button', 'soft-button', '↻ Làm mới danh sách từ Claude/ChatGPT'); refresh.type = 'button';
  refresh.onclick = async () => {
    refresh.disabled = true; refresh.textContent = 'Đang đọc danh sách…';
    try { const data = await api({ method: 'POST' }, '/refresh'); load(data); toast(`Đã cập nhật: ${data.found} model từ tài khoản. Model mới để TẮT, bật rồi Lưu để dùng.`); }
    catch (error) { toast(error.message); refresh.disabled = false; refresh.textContent = '↻ Làm mới danh sách từ Claude/ChatGPT'; }
  };
  pane.append(refresh);

  const tiers = make('section', 'model-section');
  tiers.append(make('h3', '', 'Model theo mức độ việc'));
  for (const tier of ['easy', 'medium', 'hard', 'planner']) {
    const row = make('div', 'model-tier');
    row.append(make('strong', '', tierText[tier]));
    for (const provider of ['claude', 'codex']) {
      const usable = draft.models.filter(m => m.provider === provider && draft.enabled[m.id]);
      const cell = make('div', 'model-tier-cell', providerText[provider]);
      if (!usable.length) { cell.append(make('small', '', 'Chưa bật model nào')); row.append(cell); continue; }
      const current = draft.tiers[tier]?.[provider] || { model: usable[0].id, effort: 'low' };
      if (!usable.some(m => m.id === current.model)) current.model = usable[0].id;
      const model = make('select'); model.setAttribute('aria-label', `${tierText[tier]} · ${providerText[provider]} · model`);
      usable.forEach(m => model.append(new Option(m.label, m.id)));
      model.value = current.model;
      const effort = make('select'); effort.setAttribute('aria-label', `${tierText[tier]} · ${providerText[provider]} · effort`);
      const levels = allowed(usable.find(m => m.id === current.model));
      levels.forEach(e => effort.append(new Option(e, e)));
      if (!levels.includes(current.effort)) current.effort = levels.at(-1);
      effort.value = current.effort;
      model.onchange = () => { (draft.tiers[tier] ||= {})[provider] = { model: model.value, effort: current.effort }; render(); };
      effort.onchange = () => { (draft.tiers[tier] ||= {})[provider] = { model: model.value, effort: effort.value }; };
      (draft.tiers[tier] ||= {})[provider] = current;
      const pair = make('div', 'model-pair'); pair.append(model, effort);
      cell.append(pair); row.append(cell);
    }
    tiers.append(row);
  }
  pane.append(tiers);

  const list = make('section', 'model-section');
  list.append(make('h3', '', 'Danh sách model'));
  for (const provider of ['claude', 'codex']) {
    list.append(make('h4', '', providerText[provider]));
    for (const m of draft.models.filter(x => x.provider === provider)) {
      const row = make('div', 'model-row');
      const toggle = make('label', 'model-toggle');
      const box = make('input'); box.type = 'checkbox'; box.checked = !!draft.enabled[m.id];
      box.onchange = () => { draft.enabled[m.id] = box.checked; render(); };
      toggle.append(box, make('span', '', m.label), make('small', '', ` ${m.id} · ${sourceText[m.source] || m.source}${m.source !== 'custom' && !m.enabled ? ' · chưa bật' : ''}`));
      const cap = make('select'); cap.setAttribute('aria-label', `Effort tối đa ${m.label}`);
      m.supported.forEach(e => cap.append(new Option(`tối đa ${e}`, e)));
      cap.value = capOf(m); cap.disabled = !draft.enabled[m.id];
      cap.onchange = () => { draft.maxEffort[m.id] = cap.value; render(); };
      row.append(toggle, cap);
      list.append(row);
    }
  }
  const add = make('form', 'model-add');
  const id = make('input'); id.placeholder = 'Mã model, ví dụ claude-sonnet-5-5'; id.required = true; id.setAttribute('aria-label', 'Mã model mới');
  const label = make('input'); label.placeholder = 'Tên hiển thị'; label.setAttribute('aria-label', 'Tên hiển thị');
  const button = make('button', 'soft-button', '＋ Thêm model'); button.type = 'submit';
  add.append(id, label, button);
  add.onsubmit = event => {
    event.preventDefault();
    const value = id.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{1,60}$/.test(value)) return toast('Mã model chỉ gồm chữ thường, số, dấu chấm và gạch ngang.');
    if (draft.models.some(m => m.id === value)) return toast('Model này đã có trong danh sách.');
    const provider = value.startsWith('claude-') ? 'claude' : 'codex';
    const supported = provider === 'claude' ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high', 'xhigh', 'max'];
    draft.custom.push({ id: value, label: label.value.trim() || value, efforts: supported });
    draft.models.push({ id: value, label: label.value.trim() || value, provider, source: 'custom', supported, maxEffort: supported.at(-1) });
    draft.enabled[value] = true; draft.maxEffort[value] = supported.at(-1);
    render();
  };
  list.append(add);
  pane.append(list);

  const save = make('button', 'primary full', 'Lưu cấu hình model'); save.type = 'button';
  save.onclick = async () => {
    save.disabled = true;
    try {
      load(await api({ method: 'PUT', body: JSON.stringify({ custom: draft.custom, enabled: draft.enabled, maxEffort: draft.maxEffort, tiers: draft.tiers }) }));
      toast('Đã lưu. Việc giao từ giờ dùng cấu hình mới.');
      window.dispatchEvent(new Event('office:models-changed'));
    } catch (error) { toast(error.message); save.disabled = false; }
  };
  pane.append(save);
}

if (pane && location.protocol !== 'file:') {
  api({ method: 'GET' }).then(load).catch(() => { tab.hidden = true; });
}
