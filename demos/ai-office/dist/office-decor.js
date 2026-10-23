// Cosy details for the single-room office: windows that follow the real Vietnam time of day, string lights,
// a bookshelf, wall frames and a coffee island. Decoration only; it reads no app data.
const bridge = window.mocOffice3D;
if (bridge) {
  const { THREE, scene } = bridge;
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .7, ...extra });
  let dark = false; // Office AI dark theme (class "dark" on <html>): a darker, night-lit room
  let raining = false; // random rain: drops on the windows, greyer sky
  const RAIN_GREY = new THREE.Color(0x8d9aa5);
  const add = (geo, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const block = (w, h, d, color, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), std(color), x, y, z, parent);

  // Two windows on the west wall (wall surface x = -9.73), with sills and curtains.
  const glass = new THREE.MeshBasicMaterial({ color: 0xbfe3f2, toneMapped: false });
  const stars = [];
  for (const z0 of [-3, 2.4]) {
    block(.08, 1.95, 2.6, 0xf5f0e2, -9.69, 2.6, z0);
    const pane = add(new THREE.PlaneGeometry(2.3, 1.7), glass, -9.64, 2.6, z0); pane.rotation.y = Math.PI / 2; pane.castShadow = false;
    block(.05, .06, 2.3, 0xf5f0e2, -9.62, 2.6, z0); block(.05, 1.7, .06, 0xf5f0e2, -9.62, 2.6, z0);
    block(.34, .08, 2.8, 0xe6dccb, -9.58, 1.6, z0);
    for (const dz of [-1.5, 1.5]) block(.14, 2.05, .5, 0xe9c9b0, -9.55, 2.6, z0 + dz);
    block(.1, .06, 3.5, 0xb59a7c, -9.58, 3.68 - .03, z0);
    for (let i = 0; i < 7; i++) {
      const star = add(new THREE.SphereGeometry(.035, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), -9.62, 2.2 + (i * 37 % 13) / 13 * 1.1, z0 - 1 + (i * 53 % 11) / 11 * 2);
      star.castShadow = false; stars.push(star);
    }
  }

  // Warm string lights along the back and west walls.
  const bulbs = [0, 1, 2].map(k => new THREE.MeshStandardMaterial({ color: 0xffe3a3, emissive: 0xffd27a, emissiveIntensity: 1, roughness: .4 }));
  const bulbGeo = new THREE.SphereGeometry(.07, 8, 6);
  const strand = (from, to, sag, n, k0) => {
    for (let i = 0; i <= n; i++) {
      const u = i / n, drop = Math.sin(u * Math.PI) * sag;
      const m = add(bulbGeo, bulbs[(i + k0) % 3], from[0] + (to[0] - from[0]) * u, 3.4 - drop, from[1] + (to[1] - from[1]) * u);
      m.castShadow = false;
    }
  };
  for (let s = 0; s < 3; s++) strand([-9.6 + s * 6.4, -7.05], [-3.2 + s * 6.4, -7.05], .35, 10, s);
  for (let s = 0; s < 2; s++) strand([-9.55, -7 + s * 7], [-9.55, 0 + s * 7], .35, 10, s + 1);

  // Bookshelf in the back-right corner.
  const shelf = new THREE.Group(); shelf.position.set(8.7, .35, -6.7); scene.add(shelf);
  block(2.2, 2.7, .08, 0xb98f66, 0, 1.35, -.2, shelf);
  for (const x of [-1.05, 1.05]) block(.1, 2.7, .5, 0xc9a074, x, 1.35, 0, shelf);
  const palette = [0xd98b8b, 0x8fb8a0, 0xe5c06b, 0x86a3c9, 0xb69ad0, 0xe8a96b];
  for (let row = 0; row < 4; row++) {
    block(2.2, .08, .5, 0xc9a074, 0, row * .68 + .04, 0, shelf);
    let x = -.95;
    for (let i = 0; x < .95; i++) {
      const w = .09 + (i * 7 % 5) * .02, h = .38 + (i * 3 % 4) * .06;
      if (!((row + i) % 7 === 3)) block(w, h, .3, palette[(i + row * 2) % palette.length], x + w / 2, row * .68 + .08 + h / 2, 0, shelf);
      x += w + .01;
    }
  }
  block(2.2, .08, .5, 0xc9a074, 0, 2.72, 0, shelf);

  // Clicking the bookshelf opens the history of conversations (the task list).
  (bridge.clickables ||= []).push({ group: shelf, onClick: () => window.mocOfficeLayout?.showTab('work') });

  // Framed pictures on the back wall (wall surface z = -7.13).
  [[-8.3, 2.7, .9, .7, 0xe5c5b3], [-7.1, 2.45, .6, .8, 0xc9d8b7], [-3.4, 2.65, .8, .6, 0xd5cbe4], [3.2, 2.7, .55, .7, 0xf2d9a8]].forEach(([x, y, w, h, c]) => {
    block(w + .1, h + .1, .05, 0x8a6c4f, x, y, -7.1); block(w, h, .03, c, x, y, -7.07);
  });

  // Coffee island on the east side with a steaming machine and two stools.
  const island = new THREE.Group(); island.position.set(8.9, .35, 2.4); scene.add(island);
  block(1, 1.05, 2.4, 0xd8c3a5, 0, .52, 0, island); block(1.1, .08, 2.5, 0xf1e8d6, 0, 1.09, 0, island);
  block(.45, .55, .42, 0x5f6a66, 0, 1.4, -.5, island); block(.3, .06, .3, 0x9aa5a0, 0, 1.7, -.5, island);
  add(new THREE.CylinderGeometry(.09, .07, .13, 12), std(0xf6f0dd), 0, 1.17, .1, island);
  add(new THREE.CylinderGeometry(.09, .07, .13, 12), std(0xe8a96b), 0, 1.17, .6, island);
  for (const z of [-.5, .5]) { add(new THREE.CylinderGeometry(.22, .22, .06, 14), std(0xa8855f), 1, .78, z, island); add(new THREE.CylinderGeometry(.04, .04, .7, 8), std(0x9c9f8c), 1, .4, z, island); }
  const steam = [0, 1, 2].map(() => { const m = add(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }), 0, 1.3, .1, island); m.castShadow = false; return m; });

  // Random rain: no weather service involved. Starts and stops by chance; ?rain=1 / ?rain=0 forces it for previews.
  const rainDrops = [];
  for (const z0 of [-3, 2.4]) for (let i = 0; i < 16; i++) {
    const drop = add(new THREE.BoxGeometry(.025, .16, .025), new THREE.MeshBasicMaterial({ color: 0x9ccbe8, transparent: true, opacity: .75, toneMapped: false }), -9.62, 3, z0 + (Math.random() - .5) * 2.1);
    drop.castShadow = false; drop.visible = false; rainDrops.push({ drop, speed: .6 + Math.random() * .9, offset: Math.random() * 1.6, sway: Math.random() * 6 });
  }
  const forcedRain = new URLSearchParams(location.search).get('rain');
  raining = forcedRain === '1' || (forcedRain !== '0' && Math.random() < .25);
  if (forcedRain === null) setInterval(() => {
    const next = raining ? Math.random() > .25 : Math.random() < .08; // ~2 minute showers, ~6 minutes apart
    if (next !== raining) { raining = next; paintSky(); }
  }, 30000);

  // Time of day (Vietnam time) drives the window, stars, lights and the strength of sun and sky light.
  const hemi = scene.children.find(o => o.isHemisphereLight), sun = scene.children.find(o => o.isDirectionalLight);
  const base = { hemi: hemi?.intensity ?? 2.4, sun: sun?.intensity ?? 3.5 };
  let night = 0;
  function paintSky() {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).formatToParts(new Date());
    const h = Number(parts.find(p => p.type === 'hour').value) % 24 + Number(parts.find(p => p.type === 'minute').value) / 60;
    const [sky, k, tint] = h >= 6.5 && h < 16.5 ? [0xbfe3f2, 1, 0xfff2da] : h >= 16.5 && h < 18.5 ? [0xf1b98a, .8, 0xffc08a]
      : h >= 5 && h < 6.5 ? [0xf5cfa8, .8, 0xffd9b0] : [0x1b2742, .5, 0x9fb4ff];
    const level = (raining ? k * .85 : k) * (dark ? .7 : 1);
    glass.color.setHex(sky); if (raining) glass.color.lerp(RAIN_GREY, .55); night = k === .5 ? 1 : 0;
    stars.forEach(star => { star.visible = night === 1 && !raining; });
    if (hemi) hemi.intensity = base.hemi * (.55 + .45 * level);
    if (sun) { sun.intensity = base.sun * level * level; sun.color.setHex(tint); }
  }
  paintSky(); setInterval(paintSky, 60000);

  // Theme: darker surroundings and light, following the same switch as the page.
  const ground = scene.children.find(o => o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.width === 200);
  if (ground) ground.material = ground.material.clone(); // the ground colour is shared with other meshes
  function applyTheme(isDark) {
    dark = isDark;
    scene.background = new THREE.Color(dark ? '#111723' : '#edf1e8');
    if (ground) ground.material.color.set(dark ? '#141b27' : '#edf1e8');
    paintSky();
  }
  window.addEventListener('office:theme', event => applyTheme(!!event.detail?.dark));
  applyTheme(document.documentElement.classList.contains('dark'));

  bridge.frame.push(time => {
    rainDrops.forEach(({ drop, speed, offset, sway }) => {
      drop.visible = raining && !bridge.reduced();
      if (drop.visible) drop.position.y = 3.4 - ((time * speed + offset) % 1.6) - Math.sin(time + sway) * .01;
    });
    bulbs.forEach((mat, k) => { mat.emissiveIntensity = (night || dark ? 1.7 : .6) * (.8 + .2 * Math.sin(time * 2.2 + k * 2.1)); });
    if (!bridge.reduced()) steam.forEach((puff, i) => {
      const u = (time * .4 + i / 3) % 1;
      puff.position.set(Math.sin(u * 6 + i) * .03, 1.3 + u * .5, .1); puff.scale.setScalar(.8 + u); puff.material.opacity = (1 - u) * .4;
    });
  });

  // Occasions (Vietnam date): Tết, Trung thu, Giáng sinh. Open the page with ?season=tet|trungthu|noel to preview.
  const TET = { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3] };
  const TRUNG_THU = { 2026: [9, 25], 2027: [9, 15], 2028: [10, 3], 2029: [9, 22], 2030: [9, 12] };
  const DAY = 86400000;
  function seasonNow() {
    const forced = new URLSearchParams(location.search).get('season');
    if (['tet', 'trungthu', 'noel'].includes(forced)) return forced;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })
      .formatToParts(new Date()).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    const today = Date.UTC(p.year, p.month - 1, p.day);
    const near = (table, before, after) => { const d = table[p.year]; if (!d) return false; const t = Date.UTC(p.year, d[0] - 1, d[1]); return today >= t - before * DAY && today <= t + after * DAY; };
    if (near(TET, 21, 10)) return 'tet';
    if (near(TRUNG_THU, 10, 1)) return 'trungthu';
    if (p.month === 12 && p.day >= 10 && p.day <= 26) return 'noel';
    return null;
  }
  let seasonGroup = null, seasonName = undefined;
  const emissive = (color, intensity = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: .5 });
  function hanging(g, x, y, make) { // a lantern on a thread from the top of the back wall
    add(new THREE.CylinderGeometry(.012, .012, 3.5 - y, 4), std(0xb59a7c), x, (3.5 + y) / 2, -6.95, g).castShadow = false;
    const lantern = make(); lantern.position.set(x, y, -6.95); g.add(lantern);
  }
  function buildSeason(name) {
    const g = new THREE.Group(); scene.add(g);
    if (name === 'tet') {
      // Peach blossom tree between the windows, red lanterns and a greeting banner.
      const tree = new THREE.Group(); tree.position.set(-8.5, .35, -.3); g.add(tree);
      add(new THREE.CylinderGeometry(.14, .2, 1.5, 8), std(0x6b4a33), 0, .75, 0, tree);
      for (const [x, y, z] of [[-.5, 1.6, 0], [.5, 1.8, .1], [0, 2.2, -.2], [.3, 1.4, .4], [-.3, 2.0, .3]]) {
        add(new THREE.CylinderGeometry(.04, .07, 1, 6), std(0x6b4a33), x * .5, y - .4, z * .5, tree).rotation.z = -x * .8;
        for (let i = 0; i < 9; i++) add(new THREE.SphereGeometry(.1, 8, 6), std([0xf7b6c8, 0xf2a0b8, 0xfad0dc][i % 3]), x + Math.sin(i * 2.1) * .35, y + Math.cos(i * 1.7) * .3, z + Math.sin(i * 1.3) * .3, tree).castShadow = false;
      }
      add(new THREE.CylinderGeometry(.35, .27, .4, 12), std(0xc0503a), 0, .2, 0, tree);
      for (const x of [-6.4, -4.8, 2.5]) hanging(g, x, 2.7, () => {
        const l = new THREE.Group();
        add(new THREE.SphereGeometry(.22, 12, 10), emissive(0xd7261e, .7), 0, 0, 0, l).scale.set(1, 1.2, 1);
        add(new THREE.CylinderGeometry(.1, .1, .05, 8), std(0xe5b94a), 0, .28, 0, l); add(new THREE.CylinderGeometry(.1, .1, .05, 8), std(0xe5b94a), 0, -.28, 0, l);
        add(new THREE.CylinderGeometry(.015, .015, .25, 4), std(0xe5b94a), 0, -.42, 0, l); return l;
      });
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
      const c = canvas.getContext('2d'); c.fillStyle = '#c4221c'; c.fillRect(0, 0, 512, 80); c.strokeStyle = '#e5b94a'; c.lineWidth = 4; c.strokeRect(5, 5, 502, 70);
      c.fillStyle = '#ffd966'; c.font = 'bold 40px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Chúc Mừng Năm Mới', 256, 42);
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .41), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); plane.position.set(.3, 3.3, -7.08); g.add(plane);
    } else if (name === 'trungthu') {
      [[-6.4, 2.8, 0xd7261e], [-4.8, 3, 0xf2c14e], [2.5, 2.8, 0xe8743b], [3.3, 3.05, 0xd7261e], [-2.8, 3, 0xf2c14e]].forEach(([x, y, color]) =>
        hanging(g, x, y, () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(.3), emissive(color, .8)); m.scale.set(1, 1.1, 1); m.rotation.y = .6; return m; }));
    } else if (name === 'noel') {
      const tree = new THREE.Group(); tree.position.set(-8.5, .35, -.3); g.add(tree);
      add(new THREE.CylinderGeometry(.12, .15, .4, 8), std(0x6b4a33), 0, .2, 0, tree);
      [[1.1, .9, .5], [.85, .75, 1.2], [.6, .6, 1.8]].forEach(([r, h, y], i) => add(new THREE.ConeGeometry(r, h * 1.3, 12), std([0x2f6b3a, 0x3a7d44, 0x4b8f55][i]), 0, y + .2, 0, tree));
      add(new THREE.OctahedronGeometry(.16), emissive(0xffd24a, 1.4), 0, 2.55, 0, tree);
      for (let i = 0; i < 14; i++) { const a = i * 2.4, level = i % 3, r = [.85, .6, .35][level];
        add(new THREE.SphereGeometry(.07, 8, 6), emissive([0xe0524a, 0xf2c14e, 0x6fb3d9][i % 3], .6), Math.cos(a) * r, .8 + level * .6 + (i % 2) * .15, Math.sin(a) * r, tree).castShadow = false; }
      [[.9, 0x9c3d3d, .5, .35], [1.2, 0x3d6f9c, .42, .6], [.4, 0xe0b24a, .4, .8]].forEach(([x, color, size, z]) => { add(new THREE.BoxGeometry(size, size, size), std(color), x - .2, size / 2, z, tree); });
    }
    return g;
  }
  function applySeason() {
    const next = seasonNow();
    if (next === seasonName) return;
    seasonName = next;
    if (seasonGroup) { scene.remove(seasonGroup); seasonGroup = null; }
    if (next) seasonGroup = buildSeason(next);
  }
  applySeason(); setInterval(applySeason, 3600000);

  // Adaptive quality: if the scene runs below ~30 fps for 3 seconds on this device, drop the pixel ratio first,
  // then the shadows. The level is remembered in this browser (clear "moc-office-quality" to reset).
  const renderer = bridge.renderer;
  let quality = 0;
  try { quality = Number(localStorage.getItem('moc-office-quality')) || 0; } catch {}
  function applyQuality(level) {
    if (level >= 1) { renderer.setPixelRatio(1); renderer.setSize(bridge.width(), bridge.height(), false); }
    if (level >= 2 && renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false;
      scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
    }
  }
  applyQuality(quality);
  let lastStamp = performance.now(), accum = 0, frames = 0;
  bridge.frame.push(() => {
    const now = performance.now(), delta = now - lastStamp; lastStamp = now;
    if (delta > 250 || document.hidden) { accum = 0; frames = 0; return; } // tab switch or a stall, not a slow GPU
    accum += delta; frames++;
    if (accum < 3000) return;
    const fps = frames * 1000 / accum; accum = 0; frames = 0;
    if (fps < 30 && quality < 2) {
      quality++; applyQuality(quality);
      try { localStorage.setItem('moc-office-quality', String(quality)); } catch {}
    }
  });
}
