const $ = id => document.getElementById(id);
if (window.top !== window.self) document.body.classList.add('is-embedded');

const tabs = [...document.querySelectorAll('.workspace-tabs [role="tab"]')];
function showTab(name, focus = false) {
  for (const tab of tabs) {
    const selected = tab.dataset.pane === name;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    $(`pane-${tab.dataset.pane}`).hidden = !selected;
    if (selected && focus) tab.focus();
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showTab(tab.dataset.pane));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); showTab(tabs[next].dataset.pane, true); }
  });
});
$('tasks-nav').addEventListener('click', () => showTab('work'), true);
$('team-nav').addEventListener('click', () => showTab('team'), true);
window.mocOfficeLayout = { showTab };
// One clear banner when the login cookie has expired, instead of raw "Unauthorized" texts.
window.mocOfficeSessionExpired = () => {
  if (document.getElementById('session-expired')) return;
  const bar = document.createElement('div'); bar.id = 'session-expired'; bar.setAttribute('role', 'alert');
  bar.append(document.createTextNode('Phiên đăng nhập đã hết hạn. '));
  const link = document.createElement('a'); link.href = '/'; link.target = '_top'; link.textContent = 'Đăng nhập lại →';
  bar.append(link); document.body.prepend(bar);
};

const roster = document.querySelector('.workspace-roster');
for (const [index, name] of ['Bạn'].entries()) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
  button.setAttribute('aria-pressed', String(name === $('agent-name').textContent));
  button.addEventListener('click', () => window.mocOfficeSelectAgent?.(index));
  roster.append(button);
}
new MutationObserver(() => {
  showTab('team');
  for (const button of roster.children) button.setAttribute('aria-pressed', String(button.textContent === $('agent-name').textContent));
}).observe($('agent-name'), { childList: true, characterData: true, subtree: true });

function fitPanel() {
  const rect = document.querySelector('.right-panel').getBoundingClientRect();
  for (const [name, value] of Object.entries({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })) {
    document.documentElement.style.setProperty(`--office-panel-${name}`, `${value}px`);
  }
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  document.querySelectorAll('.modal[role="dialog"]').forEach(modal => modal.setAttribute('aria-modal', String(mobile)));
}
const observer = new ResizeObserver(fitPanel);
observer.observe(document.querySelector('.right-panel'));
observer.observe(document.querySelector('.work-area'));
window.addEventListener('resize', fitPanel);
document.querySelector('.app-layout main').addEventListener('scroll', fitPanel, { passive: true });
document.addEventListener('toggle', event => {
  if (event.target.id === 'live-quota-overview') requestAnimationFrame(fitPanel);
}, true);
fitPanel();


// Keep the control outside the result panel so the 3D view can be restored
// while a conversation is open. Storage may be unavailable in embedded mode.
const sceneToggle=$('toggle-office-3d');
function setSceneHidden(hidden) {
  document.body.classList.toggle('is-chat-expanded',hidden);
  sceneToggle.textContent=hidden?'Hiện văn phòng 3D':'Ẩn văn phòng 3D';
  sceneToggle.setAttribute('aria-pressed',String(hidden));
  fitPanel();
}
let sceneHidden=false;
// Phones default to the task list; an explicit choice in this browser wins.
let savedScene=null;
try { savedScene=localStorage.getItem('moc-office-hide-3d'); } catch {}
sceneHidden=savedScene===null ? matchMedia('(max-width: 600px)').matches : savedScene==='1';
setSceneHidden(sceneHidden);
sceneToggle.onclick=()=>{
  sceneHidden=!document.body.classList.contains('is-chat-expanded');
  setSceneHidden(sceneHidden);
  try { localStorage.setItem('moc-office-hide-3d',sceneHidden?'1':'0'); } catch {}
};
