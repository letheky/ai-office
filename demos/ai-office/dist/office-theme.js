// Standalone theme control; keep the existing storage key for saved preferences.
(function () {
  var key = 'tb_theme';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var preference = readPreference();
  var button = document.getElementById('toggle-office-theme');
  function readPreference() {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function wantDark() {
    return preference === 'dark' || (preference !== 'light' && media.matches);
  }
  function apply() {
    var dark = wantDark();
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1e2634' : '#f6f7f2');
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối';
      button.querySelector('.office-theme-icon').textContent = dark ? '☾' : '☀';
      button.querySelector('.office-theme-label').textContent = dark ? 'Tối' : 'Sáng';
    }
    window.dispatchEvent(new CustomEvent('office:theme', { detail: { dark: dark } }));
  }
  if (button) button.addEventListener('click', function () {
    preference = wantDark() ? 'light' : 'dark';
    try { localStorage.setItem(key, preference); } catch (e) {}
    apply();
  });
  window.addEventListener('storage', function (event) {
    if (event.key === key || event.key === null) { preference = readPreference(); apply(); }
  });
  media.addEventListener('change', apply);
  apply();
})();
