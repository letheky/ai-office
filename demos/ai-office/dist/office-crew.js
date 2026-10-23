// 3D "AI crew": one robot per AI account (Claude / ChatGPT, local + VPS) seated behind the desks the
// human staff used to have; the user is the manager. Pose, face, lights and label come from real data via office-crew-state.mjs:
// working = typing, exhausted = asleep, error = sparks + alert, low = tired, offline = dark.
import { crewSummary, crewLayout, crewCaption, crewBubble, queuedCount } from './office-crew-state.mjs?v=5';

const bridge = window.mocOffice3D;
if (bridge && window.mocOfficeLive?.snapshot) {
  const { THREE, scene, cam, labels, seats } = bridge;
  const STYLE_COLORS = [0xd98b66, 0x6fb39b, 0xa58fd0]; // round / boxy / slim
  const GREY = 0xa9aca6;
  const STATE_LIGHT = { idle: 0x62d27a, working: 0x4cc9f0, low: 0xf2b84b, exhausted: 0xe0524a, error: 0xff2d2d, offline: 0x555a55 };
  // Robots sit on a real chair (same seat height as the manager's chair, top at y=1.055) on the far
  // side of their desk, facing the camera. SCALE keeps them roughly person-sized (head ~2.6 high).
  const SEAT_TOP = 1.055, BEHIND_DESK = 1.2, SCALE = .6;
  // Charging corner (front-left): a spent robot flies up out of its chair, over the desks, and slumps against a
  // charger post; when its quota is back it flies home again. Flying avoids path-finding around the furniture.
  const DOCK_Z = 6.3, DOCK_Y = .44, FLY_Y = 3.6, FLY_SPEED = 3.4;
  const dockX = i => -7.6 + i * 1.2;
  const MANAGER = [0, 1.9, 3.5]; // the user's round desk: tasks flow from here to the robots that are working
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const lambert = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .6, ...extra });
  const glow = (color, intensity = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: .4 });

  const glyphTexture = (text, color) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.font = 'bold 78px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 48, 52);
    return new THREE.CanvasTexture(canvas);
  };
  const glyphs = { z: glyphTexture('z', '#5a7bd8'), alert: glyphTexture('!', '#e0302a'), drop: glyphTexture('💧', '#4a90d9') };
  const sprite = (key, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphs[key], transparent: true, depthWrite: false }));
    s.scale.set(size, size, 1); s.visible = false; return s;
  };

  let crew = null; // { group, ids, robots }
  let lastSummary = [];
  let selectedId = null;
  let openedByCrew = false; // the quota panel was opened by touching a robot, so touching elsewhere closes it

  function buildRobot(summary) {
    const root = new THREE.Group();
    const bodyMat = lambert(STYLE_COLORS[summary.style ?? 0]);
    const headMat = lambert(0xf3f1e8);
    const padMat = lambert(0xe7e2d3);
    const screenMat = lambert(0x232b27, { roughness: .3 });
    const lightMat = glow(STATE_LIGHT.idle, 1.2);
    const eyeMat = glow(0x9bf2c0, 1.4);
    const chestMat = glow(0x62d27a, .9);
    const mesh = (geo, mat, x, y, z, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

    mesh(new THREE.CylinderGeometry(.62, .62, .12, 24), padMat, 0, .06, 0);
    const ring = mesh(new THREE.TorusGeometry(.6, .03, 6, 36), glow(STATE_LIGHT.idle, .8), 0, .13, 0); ring.rotation.x = Math.PI / 2;

    // Three silhouettes (same joints, so every pose and gesture works on all of them):
    // 0 round (Claude), 1 boxy with visor and headphones, 2 slim pill with one big eye and bunny antennas.
    const style = summary.style ?? 0;
    const grey = lambert(0x77807a);
    const body = new THREE.Group(); body.position.y = .15; root.add(body);
    mesh(new THREE.CylinderGeometry(.5, .56, .22, 20), grey, 0, .12, 0, body);
    let torso, chestZ, frameW, fillW, armX;
    if (style === 0) { torso = mesh(new THREE.SphereGeometry(.52, 22, 16), bodyMat, 0, .8, 0, body); torso.scale.set(1.05, 1, .82); chestZ = .45; frameW = .46; fillW = .38; armX = .6; }
    else if (style === 1) { torso = mesh(new THREE.BoxGeometry(1.04, .92, .78), bodyMat, 0, .78, 0, body); chestZ = .4; frameW = .6; fillW = .5; armX = .66; }
    else { torso = mesh(new THREE.CylinderGeometry(.4, .5, 1.12, 18), bodyMat, 0, .84, 0, body); chestZ = .49; frameW = .4; fillW = .32; armX = .52; }
    // Chest battery: frame + fill that shrinks with the remaining 5-hour session.
    mesh(new THREE.BoxGeometry(frameW, .5, .04), screenMat, 0, .85, chestZ, body);
    const fill = mesh(new THREE.BoxGeometry(fillW, .4, .05), chestMat, 0, .85, chestZ + .02, body);
    fill.castShadow = false;

    mesh(new THREE.CylinderGeometry(.14, .14, .16, 10), grey, 0, 1.38, 0, body);
    const head = new THREE.Group(); head.position.set(0, 1.46, 0); body.add(head);
    let eyes, mouth, eyeZ, rodY = 1.03, bulbY = 1.24;
    if (style === 0) {
      mesh(new THREE.SphereGeometry(.55, 22, 16), headMat, 0, .45, 0, head).scale.set(1, .82, .9);
      mesh(new THREE.SphereGeometry(.42, 18, 12), screenMat, 0, .46, .3, head).scale.set(1, .62, .55);
      for (const side of [-1, 1]) mesh(new THREE.SphereGeometry(.12, 10, 8), bodyMat, side * .56, .45, 0, head);
      eyeZ = .5;
      eyes = [-1, 1].map(side => mesh(new THREE.SphereGeometry(.09, 10, 8), eyeMat, side * .2, .52, eyeZ, head));
      mouth = mesh(new THREE.BoxGeometry(.24, .045, .04), eyeMat, 0, .33, .51, head);
    } else if (style === 1) {
      mesh(new THREE.BoxGeometry(1.1, .7, .8), headMat, 0, .45, 0, head);
      mesh(new THREE.BoxGeometry(1, .36, .06), screenMat, 0, .5, .41, head);
      for (const side of [-1, 1]) { const cup = mesh(new THREE.CylinderGeometry(.2, .2, .14, 16), bodyMat, side * .62, .45, 0, head); cup.rotation.z = Math.PI / 2; }
      const band = mesh(new THREE.TorusGeometry(.62, .035, 8, 28, Math.PI), bodyMat, 0, .46, 0, head); band.scale.y = .58;
      eyeZ = .46; rodY = .97; bulbY = 1.18;
      eyes = [-1, 1].map(side => mesh(new THREE.BoxGeometry(.15, .15, .04), eyeMat, side * .2, .52, eyeZ, head));
      mouth = mesh(new THREE.BoxGeometry(.26, .045, .04), eyeMat, 0, .33, .46, head);
    } else {
      const pill = mesh(new THREE.CapsuleGeometry(.34, .5, 6, 14), headMat, 0, .45, 0, head); pill.rotation.z = Math.PI / 2;
      mesh(new THREE.SphereGeometry(.34, 16, 12), screenMat, 0, .46, .2, head).scale.set(1.2, .9, .5);
      eyeZ = .4;
      eyes = [mesh(new THREE.SphereGeometry(.17, 12, 10), eyeMat, 0, .5, eyeZ, head), mesh(new THREE.SphereGeometry(.06, 8, 6), screenMat, 0, .5, .55, head)];
      mouth = mesh(new THREE.BoxGeometry(.18, .04, .04), eyeMat, 0, .33, .37, head);
      for (const side of [-1, 1]) { const ear = mesh(new THREE.CylinderGeometry(.03, .03, .5, 6), grey, side * .17, 1.02, 0, head); ear.rotation.z = -side * .35; mesh(new THREE.SphereGeometry(.05, 8, 6), bodyMat, side * .26, 1.26, 0, head); }
      bulbY = .93;
    }
    // Cross eyes for the error face.
    const crossEyes = [-1, 1].map(side => {
      const g = new THREE.Group(); g.position.set(style === 2 ? side * .14 : side * .2, .52, eyeZ + .02 + (style === 2 ? .2 : 0)); g.visible = false; head.add(g);
      const red = glow(0xff4a40, 1.6);
      for (const a of [Math.PI / 4, -Math.PI / 4]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(.22, .045, .03), red); bar.rotation.z = a; g.add(bar); }
      return g;
    });
    if (style !== 2) mesh(new THREE.CylinderGeometry(.025, .025, .34, 6), grey, 0, rodY, 0, head);
    const bulb = mesh(new THREE.SphereGeometry(.09, 12, 10), lightMat, 0, bulbY, 0, head);
    // Error siren: a red lamp with a rotating beam, only visible while the robot is in the error state.
    const siren = new THREE.Group(); siren.position.set(0, 1.5, 0); siren.visible = false; head.add(siren);
    mesh(new THREE.SphereGeometry(.12, 12, 10), glow(0xff2d2d, 2), 0, 0, 0, siren);
    mesh(new THREE.BoxGeometry(.9, .03, .08), glow(0xff5a4a, 1.6), 0, 0, 0, siren).castShadow = false;

    const arms = [-1, 1].map(side => {
      const pivot = new THREE.Group(); pivot.position.set(side * armX, 1.15, 0); body.add(pivot);
      if (style === 1) mesh(new THREE.BoxGeometry(.22, .78, .22), bodyMat, 0, -.34, 0, pivot);
      else mesh(new THREE.CylinderGeometry(style === 2 ? .07 : .1, style === 2 ? .06 : .09, .78, 12), bodyMat, 0, -.34, 0, pivot);
      mesh(new THREE.SphereGeometry(style === 2 ? .1 : .13, 10, 8), headMat, 0, -.78, 0, pivot);
      return pivot;
    });
    // Holographic keyboard, visible only while a job is running.
    const holo = mesh(new THREE.BoxGeometry(1.1, .03, .5), new THREE.MeshBasicMaterial({ color: 0x66d4ff, transparent: true, opacity: .55 }), 0, 1.0, .95, body);
    holo.visible = false; holo.castShadow = false;
    const orbit = mesh(new THREE.TorusGeometry(.82, .03, 6, 36, Math.PI * 1.35), glow(STATE_LIGHT.working, 1.4), 0, 2.15, 0, body);
    orbit.rotation.x = Math.PI / 2; orbit.visible = false; orbit.castShadow = false;

    const zs = [0, 1, 2].map(() => { const s = sprite('z', .6); root.add(s); return s; });
    const alert = sprite('alert', 1.1); root.add(alert);
    const drop = sprite('drop', .5); root.add(drop);
    const smoke = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0x70736f, transparent: true, opacity: 0 }));
      m.visible = false; root.add(m); return m;
    });

    const confetti = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, .02), new THREE.MeshBasicMaterial({ color: [0xff6b8b, 0xffd166, 0x4cc9f0, 0x62d27a][i % 4], transparent: true }));
      m.visible = false; root.add(m); return m;
    });

    const bubble = make('span', 'crew-bubble'); bubble.hidden = true; labels.append(bubble);

    // Per-robot DOM label: name, state, two mini quota bars.
    const label = make('button', 'crew-label');
    const name = make('span', 'crew-label-name', summary.label);
    const host = make('small', 'crew-label-host', summary.host);
    const stateEl = make('strong', 'crew-label-state');
    const detail = make('span', 'crew-label-detail');
    const bars = make('span', 'crew-bars');
    const barFill = [make('i'), make('i')];
    ['P', 'T'].forEach((tag, i) => {
      const track = make('em'); track.append(barFill[i]);
      const row = make('span', 'crew-bar'); row.append(make('b', '', tag), track); bars.append(row);
    });
    const line = make('span', 'crew-label-line'); const head2 = make('span', 'crew-label-top'); head2.append(name, host);
    line.append(head2, stateEl);
    const use = make('span', 'crew-use', 'Chỉ dùng AI này'); use.setAttribute('role', 'button'); use.tabIndex = 0;
    const useAccount = () => {
      const ok = window.mocOfficeUseOnlyAccount?.(summary.id);
      use.textContent = ok ? 'Đã chọn cho câu hỏi tiếp ✓' : 'Không chọn được (AI offline?)';
      setTimeout(() => { use.textContent = 'Chỉ dùng AI này'; }, 2200);
    };
    use.addEventListener('click', e => { e.stopPropagation(); useAccount(); });
    use.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); useAccount(); } });
    label.append(line, detail, bars, use);
    label.addEventListener('pointerdown', e => e.stopPropagation());
    label.addEventListener('click', () => choose(summary.id));
    labels.append(label);

    return { root, body, head, torso, arms, eyes, crossEyes, mouth, bulb, ring, fill, holo, orbit, zs, alert, drop, smoke, bodyMat,
      eyeMat, lightMat, chestMat, confetti, siren, bubble, label, stateEl, detail, barFill, ringMat: ring.material, phase: Math.random() * 6 };
  }


  // Desk props: tea cup with steam (Claude) or a cactus (ChatGPT), plus a desk lamp that goes dark when the robot is offline.
  const DESK_TOP = 1.59;
  function buildProps(seat, provider) {
    const g = new THREE.Group(); g.position.set(seat[0], DESK_TOP, seat[1]);
    const part = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    const steam = [];
    if (provider === 'claude') {
      part(new THREE.CylinderGeometry(.13, .1, .2, 16), lambert(0xf6f0dd), -1, .1, -.38);
      const handle = part(new THREE.TorusGeometry(.065, .02, 6, 12), lambert(0xf6f0dd), -.87, .11, -.38);
      part(new THREE.CylinderGeometry(.11, .11, .01, 16), lambert(0x9a6b4a), -1, .19, -.38);
      handle.rotation.y = Math.PI / 2;
      for (let i = 0; i < 2; i++) {
        const puff = part(new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }), -1, .3, -.38);
        puff.castShadow = false; steam.push(puff);
      }
    } else {
      part(new THREE.CylinderGeometry(.15, .11, .17, 14), lambert(0xd8a47f), -1, .085, -.38);
      part(new THREE.CylinderGeometry(.075, .085, .42, 10), lambert(0x6fa06b), -1, .38, -.38);
      for (const side of [-1, 1]) {
        part(new THREE.CylinderGeometry(.035, .035, .16, 8), lambert(0x6fa06b), -1 + side * .1, .36, -.38).rotation.z = side * -.5;
        part(new THREE.CylinderGeometry(.03, .03, .13, 8), lambert(0x6fa06b), -1 + side * .16, .46, -.38);
      }
    }
    part(new THREE.CylinderGeometry(.13, .13, .03, 14), lambert(0x9c9f8c), 1.05, .015, -.4);
    part(new THREE.CylinderGeometry(.018, .018, .5, 6), lambert(0x9c9f8c), 1.05, .28, -.4).userData.lamp = true;
    part(new THREE.ConeGeometry(.17, .17, 16, 1, true), lambert(0xf4edce, { side: THREE.DoubleSide }), 1.05, .55, -.4).userData.lamp = true;
    const lampMat = glow(0xffe29a, 1.2);
    { const bulbMesh = part(new THREE.SphereGeometry(.05, 8, 6), lampMat, 1.05, .5, -.4); bulbMesh.castShadow = false; bulbMesh.userData.lamp = true; }
    return { group: g, steam, lampMat };
  }

  // Wall board: live quota overview drawn on a canvas, redrawn only when the data changes.
  const board = (() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 352;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const group = new THREE.Group(); group.position.set(5.2, 2.65, -7.05); group.scale.setScalar(.75); scene.add(group);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.2), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.15, 2.35, .08), lambert(0x3b4a42));
    frame.position.z = -.05; frame.castShadow = true; group.add(frame, screen);
    let signature = '';
    const STATE_COLOR = { idle: '#62d27a', working: '#4cc9f0', low: '#f2b84b', exhausted: '#e0524a', error: '#ff2d2d', offline: '#6b706b' };
    let blinkOn = false, last = { summary: [], queued: 0 };
    function draw(summary, queued = 0) {
      last = { summary, queued };
      const sig = summary.map(s => `${s.id}:${s.state}:${s.quota.session}:${s.quota.week}`).join('|') + `|q${queued}|b${blinkOn}`;
      if (sig === signature) return; signature = sig;
      const c = canvas.getContext('2d');
      c.fillStyle = '#1d2924'; c.fillRect(0, 0, 640, 352);
      c.fillStyle = '#9fb7a6'; c.font = 'bold 24px system-ui,sans-serif'; c.textBaseline = 'middle';
      c.fillText('ĐỘI AI', 24, 28);
      const working = summary.filter(s => s.state === 'working').length;
      c.textAlign = 'right'; c.fillText(summary.length ? `${working}/${summary.length} đang làm` : '', 616, 28); c.textAlign = 'left';
      if (!summary.length) { c.fillStyle = '#7d9184'; c.font = '22px system-ui,sans-serif'; c.fillText('Chưa có tài khoản AI nào kết nối', 24, 120); texture.needsUpdate = true; return; }
      const rowH = Math.min(70, 256 / summary.length);
      summary.slice(0, 7).forEach((s, i) => {
        const y = 62 + i * rowH + rowH / 2;
        if (blinkOn && s.state === 'error') { c.fillStyle = '#5a2320'; c.fillRect(8, y - rowH / 2 + 2, 624, rowH - 4); }
        c.fillStyle = STATE_COLOR[s.state]; c.beginPath(); c.arc(32, y, 9, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#e8f1ea'; c.font = `bold ${Math.min(24, rowH * .5)}px system-ui,sans-serif`; c.fillText(s.label, 52, y - rowH * .12);
        c.fillStyle = STATE_COLOR[s.state]; c.font = `${Math.min(17, rowH * .36)}px system-ui,sans-serif`; c.fillText(crewCaption(s).title, 52, y + rowH * .26);
        [['P', s.quota.session], ['T', s.quota.week]].forEach(([tag, v], k) => {
          const x = 330 + k * 150;
          c.fillStyle = '#7d9184'; c.font = '16px system-ui,sans-serif'; c.fillText(tag, x - 18, y);
          c.fillStyle = '#34443c'; c.fillRect(x, y - 7, 110, 14);
          if (v !== null) { c.fillStyle = v <= 0 ? '#e0524a' : v <= 10 ? '#f2b84b' : '#62d27a'; c.fillRect(x, y - 7, Math.max(2, 110 * Math.min(100, v) / 100), 14); }
        });
      });
      c.textAlign = 'left'; c.font = '18px system-ui,sans-serif'; c.fillStyle = queued ? '#f2b84b' : '#7d9184';
      c.fillText(queued ? `Hàng chờ: ${queued} việc` : 'Không có việc chờ', 24, 334);
      texture.needsUpdate = true;
    }
    // Error rows blink on the wall board; redraw only when the blink phase flips.
    function tick(time) {
      const on = last.summary.some(s => s.state === 'error') && Math.floor(time * 1.6) % 2 === 0;
      if (on !== blinkOn) { blinkOn = on; draw(last.summary, last.queued); }
    }
    return { draw, tick, group };
  })();

  // Paper tray on the manager's desk: one sheet per job waiting for this machine (max 10).
  const tray = (() => {
    const g = new THREE.Group(); g.position.set(-.85, DESK_TOP, 2.75); scene.add(g);
    const base = new THREE.Mesh(new THREE.BoxGeometry(.75, .05, .55), lambert(0x9c7a58)); base.position.y = .025; base.castShadow = true; g.add(base);
    const sheets = Array.from({ length: 10 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(.62, .022, .44), lambert(i % 2 ? 0xfffaed : 0xf3ecd8));
      m.position.set(Math.sin(i * 2.3) * .03, .06 + i * .024, Math.cos(i * 1.7) * .03); m.rotation.y = Math.sin(i * 1.3) * .15; m.visible = false; m.castShadow = true; g.add(m); return m;
    });
    return { group: g, set(n) { sheets.forEach((m, i) => { m.visible = i < n; }); } };
  })();

  // Sound is off by default; browsers only allow it after a click, so the context is made on first use.
  const sound = { on: false, ctx: null, nextKey: 0 };
  try { sound.on = localStorage.getItem('moc-office-sound') === '1'; } catch {}
  function blip(freq, dur, type = 'sine', gain = .05, slide = 1) {
    if (!sound.on) return;
    try {
      sound.ctx = sound.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const c = sound.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
      if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, c.currentTime + dur);
      g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
    } catch { sound.on = false; }
  }
  const soundButton = make('button', '', sound.on ? '🔊' : '🔇'); soundButton.type = 'button';
  soundButton.title = 'Âm thanh văn phòng (đang tắt)'; soundButton.setAttribute('aria-label', 'Bật hoặc tắt âm thanh văn phòng');
  soundButton.addEventListener('click', () => {
    sound.on = !sound.on; soundButton.textContent = sound.on ? '🔊' : '🔇';
    soundButton.title = `Âm thanh văn phòng (đang ${sound.on ? 'bật' : 'tắt'})`;
    try { localStorage.setItem('moc-office-sound', sound.on ? '1' : '0'); } catch {}
    if (sound.on) blip(880, .15, 'sine', .05);
  });
  document.querySelector('.scene-controls')?.prepend(soundButton);

  // Same chair as the manager's, mirrored so its back is behind the robot (local -Z of a robot facing +Z).
  function buildChair(x, z) {
    const g = new THREE.Group(); g.position.set(x, .4, z);
    const part = (geo, color, px, py, pz) => { const m = new THREE.Mesh(geo, lambert(color)); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    part(new THREE.CylinderGeometry(.35, .4, .1, 16), 0x8b8c78, 0, .04, 0);
    part(new THREE.CylinderGeometry(.06, .06, .47, 10), 0x9c9f8c, 0, .32, 0);
    part(new THREE.BoxGeometry(.84, .15, .82), 0xb7bda3, 0, .58, 0);
    part(new THREE.BoxGeometry(.86, .82, .16), 0xb7bda3, 0, 1.02, -.45);
    return g;
  }

  function buildDock(i) {
    const g = new THREE.Group(), x = dockX(i);
    const part = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const ledMat = glow(0x62d27a, .2);
    part(new THREE.BoxGeometry(.95, .04, .95), lambert(0x56655c), x, .42, DOCK_Z);
    const ring = part(new THREE.TorusGeometry(.4, .015, 6, 28), ledMat, x, .45, DOCK_Z); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
    part(new THREE.BoxGeometry(.22, .95, .22), lambert(0x4a544e), x + .65, .875, DOCK_Z);
    part(new THREE.SphereGeometry(.06, 8, 6), ledMat, x + .65, 1.38, DOCK_Z + .12).castShadow = false;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x + .65, 1.1, DOCK_Z), new THREE.Vector3(x + .5, .62, DOCK_Z + .08), new THREE.Vector3(x + .3, .95, DOCK_Z)]);
    const cable = part(new THREE.TubeGeometry(curve, 16, .018, 6), lambert(0x222a26), 0, 0, 0); cable.visible = false;
    return { group: g, ledMat, cable };
  }
  // Fly from wherever the robot is to its seat or dock: straight up, across at FLY_Y, straight down.
  function startRoute(robot, target) {
    const cur = robot.root.position, goal = target === 'dock' ? robot.dockPos : robot.seatPos;
    robot.route = [new THREE.Vector3(cur.x, Math.max(FLY_Y, cur.y), cur.z), new THREE.Vector3(goal.x, FLY_Y, goal.z), goal.clone()];
    robot.routeIndex = 0; robot.mode = target === 'dock' ? 'toDock' : 'returning';
  }

  function rebuild(summary) {
    if (crew) { scene.remove(crew.group); crew.robots.forEach(r => { r.label.remove(); r.bubble.remove(); }); }
    const group = new THREE.Group(); scene.add(group);
    // More accounts than free desks: the extra ones are counted in the summary but not seated.
    // Claude is always the round one; ChatGPT accounts alternate boxy / slim so neighbours look different.
    let codexSeen = 0;
    const robots = summary.slice(0, seats.length).map((s, i) => {
      const style = s.provider === 'claude' ? 0 : 1 + (codexSeen++ % 2);
      const robot = buildRobot({ ...s, style });
      robot.style = style;
      robot.root.position.set(seats[i][0], SEAT_TOP, seats[i][1] - BEHIND_DESK);
      group.add(buildChair(seats[i][0], seats[i][1] - BEHIND_DESK));
      robot.props = buildProps(seats[i], s.provider); group.add(robot.props.group);
      robot.root.rotation.y = .2; robot.root.scale.setScalar(SCALE);
      // Task packet: a small glowing card carried from the manager desk to a working robot.
      robot.packet = new THREE.Mesh(new THREE.BoxGeometry(.5, .06, .36), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4cc9f0, emissiveIntensity: 1.2 }));
      robot.packet.visible = false; group.add(robot.packet);
      robot.id = s.id; robot.index = i;
      robot.seatPos = robot.root.position.clone(); robot.dockPos = new THREE.Vector3(dockX(i), DOCK_Y, DOCK_Z);
      robot.dock = buildDock(i); group.add(robot.dock.group);
      group.add(robot.root);
      return robot;
    });
    crew = { group, ids: null, robots };
  }

  function choose(id) {
    selectedId = id;
    document.getElementById('live-quota-overview')?.setAttribute('open', '');
    openedByCrew = true;
    crew?.robots.forEach(r => r.label.classList.toggle('selected', r.id === id));
  }

  function closeQuota() {
    const panel = document.getElementById('live-quota-overview');
    openedByCrew = false; selectedId = null;
    crew?.robots.forEach(r => r.label.classList.remove('selected'));
    panel?.removeAttribute('open');
  }
  document.addEventListener('pointerdown', e => {
    if (!openedByCrew || e.target.closest?.('#live-quota-overview, .crew-label, [data-crew-id]')) return;
    closeQuota();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openedByCrew) closeQuota(); });

  // The scene follows the "Máy xử lý" selector at the top of the page (#live-executor).
  const executorSelect = () => document.getElementById('live-executor');
  document.addEventListener('change', e => { if (e.target?.id === 'live-executor') poll(); });
  const hud = make('div', 'crew-hud'); hud.append(make('span', 'crew-hud-text')); labels.append(hud);
  function paintHud(summary) {
    const count = state => summary.filter(s => s.state === state).length;
    const parts = [['idle', 'sẵn sàng'], ['working', 'đang làm'], ['low', 'sắp hết'], ['exhausted', 'hết hạn mức'], ['error', 'lỗi'], ['offline', 'offline']]
      .filter(([state]) => count(state)).map(([state, text]) => `${count(state)} ${text}`);
    hud.querySelector('.crew-hud-text').textContent = summary.length ? `AI: ${parts.join(' · ')}` : 'Chưa có tài khoản AI nào kết nối';
    hud.dataset.alert = summary.some(s => s.state === 'error') ? 'error' : summary.some(s => s.state === 'exhausted') ? 'exhausted' : '';
  }

  // Team tab: the manager (the user) plus one button per AI account.
  const roster = document.querySelector('.workspace-roster');
  function paintRoster(summary) {
    if (!roster) return;
    const signature = summary.map(s => `${s.id}:${s.state}`).join('|');
    if (roster.dataset.crew !== signature) {
      roster.dataset.crew = signature;
      [...roster.querySelectorAll('[data-crew-id]')].forEach(b => b.remove());
      for (const s of summary) {
        const button = make('button', '', `${s.label} · ${crewCaption(s).title}`);
        button.type = 'button'; button.dataset.crewId = s.id;
        button.addEventListener('click', () => choose(s.id));
        roster.append(button);
      }
    }
    const size = document.getElementById('team-size');
    if (size) size.textContent = `${summary.length + 1} thành viên`;
  }
  window.mocOfficeCrew = { working: () => lastSummary.filter(s => s.state === 'working').length };

  function poll() {
    const { jobs, capabilities } = window.mocOfficeLive.snapshot();
    if (!capabilities) return;
    const picked = executorSelect()?.value;
    const machineId = picked && (picked === 'vps' || (capabilities.machines || []).some(m => m.id === picked)) ? picked : 'vps';
    const summary = crewLayout(crewSummary(capabilities, jobs, Date.now(), machineId));
    const ids = `${machineId}|${summary.map(s => s.id).join('|')}`;
    if (!crew || crew.ids !== ids) { rebuild(summary); crew.ids = ids; }
    lastSummary = summary;
    paintHud(summary);
    paintRoster(summary);
    const queued = queuedCount(jobs, summary);
    board.draw(summary, queued); tray.set(queued);
    summary.forEach((s, i) => {
      const robot = crew.robots[i];
      if (!robot) return;
      const caption = crewCaption(s);
      robot.summary = s;
      // One-shot reactions: cheer when a job finishes, stretch when a spent account comes back.
      if (robot.state !== undefined && robot.state !== s.state) {
        if (robot.state === 'working' && ['idle', 'low', 'exhausted'].includes(s.state)) { robot.event = { type: 'cheer', start: clock, until: clock + 3 }; blip(1318, .5, 'sine', .06); setTimeout(() => blip(1760, .6, 'sine', .05), 140); }
        else if (robot.state === 'exhausted' && ['idle', 'low', 'working'].includes(s.state)) robot.event = { type: 'stretch', start: clock, until: clock + 2 };
      }
      if (s.state === 'error' && robot.state !== 'error' && robot.state !== undefined) { blip(220, .25, 'sawtooth', .04); setTimeout(() => blip(190, .3, 'sawtooth', .04), 280); }
      robot.state = s.state;
      // Charging: spent accounts go to the dock, recovered ones go back to their desk.
      const spent = s.state === 'exhausted';
      if (robot.mode === undefined) { robot.mode = spent ? 'docked' : 'seated'; if (spent) robot.root.position.copy(robot.dockPos); }
      else if (spent && (robot.mode === 'seated' || robot.mode === 'returning')) startRoute(robot, 'dock');
      else if (!spent && (robot.mode === 'docked' || robot.mode === 'toDock')) startRoute(robot, 'seat');
      const talk = crewBubble(s); robot.bubble.textContent = talk; robot.bubble.hidden = !talk;
      robot.label.dataset.state = s.state;
      robot.stateEl.textContent = caption.title;
      robot.detail.textContent = caption.detail;
      robot.label.title = `${s.label} · ${caption.title}`;
      const bar = (el, v) => { el.style.width = v === null ? '0%' : `${Math.max(0, Math.min(100, v))}%`; el.dataset.level = v === null ? 'unknown' : v <= 0 ? 'out' : v <= 10 ? 'low' : 'ok'; };
      bar(robot.barFill[0], s.quota.session); bar(robot.barFill[1], s.quota.week);
    });
  }

  let clock = 0; // latest animation time (seconds), used to time one-shot events
  const tmp = new THREE.Vector3();
  const lerp = (a, b, t) => a + (b - a) * t;

  // Pets: pure decoration with no data behind them. Each one sleeps, then runs a few laps along a fixed
  // route and goes back to its sleeping spot. Reduced motion keeps them asleep.
  const parts = parent => (geo, mat, x, y, z, to = parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; to.add(m); return m; };
  function makePet(model, waypoints, { sleep, laps, speed, rest, phase = 0, sleepYaw = 0 }) {
    const W = waypoints.map(p => new THREE.Vector3(...p));
    const lens = W.slice(1).map((p, i) => p.distanceTo(W[i])), L = lens.reduce((x, y) => x + y, 0);
    const T = L / speed, lap = 2 * T + 2 * rest, TOTAL = sleep + laps * lap;
    const at = d => { let left = d; for (let i = 0; i < lens.length; i++) { if (left <= lens[i]) return { p: W[i].clone().lerp(W[i + 1], left / lens[i]), dir: W[i + 1].clone().sub(W[i]) }; left -= lens[i]; } return { p: W.at(-1).clone(), dir: W.at(-1).clone().sub(W.at(-2)) }; };
    model.root.position.copy(W[0]);
    let shift = 0, pokeStart = 0, pokeUntil = 0, restY = 0;
    return { root: model.root, active: time => time < pokeUntil,
      // Click: stop where it is, face the camera and hop for 3 seconds; the lap schedule resumes afterwards.
      poke(time) { if (pokeUntil <= time) { pokeStart = time; restY = model.root.position.y; } pokeUntil = time + 3; },
      update(time, still) {
      if (!still && time < pokeUntil) {
        const p = model.root.position; p.y = restY + Math.abs(Math.sin((time - pokeStart) * 9)) * .1;
        model.root.rotation.y = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
        model.pose('idle', time); return;
      }
      if (pokeUntil) { shift += pokeUntil - pokeStart; pokeUntil = 0; }
      const ph = still ? 0 : (time - shift + phase) % TOTAL;
      let mode = 'sleep', d = 0, back = false;
      if (ph >= sleep) {
        const u = (ph - sleep) % lap; mode = 'idle';
        if (u < T) { mode = 'walk'; d = u * speed; }
        else if (u < T + rest) d = L;
        else if (u < 2 * T + rest) { mode = 'walk'; back = true; d = L - (u - T - rest) * speed; }
      }
      const pos = at(Math.max(0, Math.min(L, d)));
      model.root.position.copy(pos.p);
      if (mode === 'sleep') model.root.rotation.y = sleepYaw;
      else if (mode === 'walk' || d > 0) { const dir = back ? pos.dir.clone().negate() : pos.dir; model.root.rotation.y = Math.atan2(dir.x, dir.z); }
      model.pose(mode, time);
    } };
  }

  const catModel = (() => {
    const FUR = lambert(0xe8a96b), CREAM = lambert(0xf6e6cc), DARK = lambert(0x3a2f2a);
    const root = new THREE.Group(); scene.add(root);
    const part = parts(root);
    const body = new THREE.Group(); root.add(body);
    part(new THREE.SphereGeometry(.22, 14, 10), FUR, 0, .24, 0, body).scale.set(1, .85, 1.7);
    part(new THREE.SphereGeometry(.15, 10, 8), CREAM, 0, .15, .08, body).scale.set(.9, .5, 1.2);
    const head = new THREE.Group(); head.position.set(0, .34, .38); body.add(head);
    part(new THREE.SphereGeometry(.16, 12, 10), FUR, 0, 0, 0, head);
    for (const side of [-1, 1]) {
      part(new THREE.ConeGeometry(.06, .12, 4), FUR, side * .09, .15, -.01, head);
      part(new THREE.SphereGeometry(.02, 6, 5), DARK, side * .06, .02, .14, head);
    }
    part(new THREE.SphereGeometry(.022, 6, 5), lambert(0xd98b8b), 0, -.03, .155, head);
    const tail = new THREE.Group(); tail.position.set(0, .3, -.34); body.add(tail);
    part(new THREE.CylinderGeometry(.035, .03, .38, 8), FUR, 0, .1, -.08, tail).rotation.x = -.9;
    const legs = [[-.1, .26], [.1, .26], [-.1, -.24], [.1, -.24]].map(([x, z]) => part(new THREE.BoxGeometry(.07, .2, .07), FUR, x, .1, z, body));
    return { root, pose(mode, time) {
      const sleeping = mode === 'sleep', walking = mode === 'walk';
      body.scale.set(1, sleeping ? .8 : 1, sleeping ? .75 : 1);
      head.rotation.x = sleeping ? .5 : 0; head.position.set(0, sleeping ? .26 : .34, sleeping ? .3 : .38);
      body.position.y = walking ? Math.abs(Math.sin(time * 16)) * .04 : 0;
      legs.forEach((leg, i) => { leg.visible = !sleeping; leg.rotation.x = walking ? Math.sin(time * 16 + (i % 2) * Math.PI) * .7 : 0; });
      tail.rotation.y = Math.sin(time * (walking ? 6 : 1.2)) * (sleeping ? .15 : .5);
      if (sleeping) body.scale.y += Math.sin(time * 1.6) * .03;
    } };
  })();
  // Sofa cushion top is y~1.06; the route hops off the front edge to the floor (y .4) and out beside the manager's desk.
  const cat = makePet(catModel, [[1.1, 1.06, .15], [1.1, 1.06, .75], [2.4, .4, 1.3], [2.7, .4, 3.4]], { sleep: 25, laps: 3, speed: 2.4, rest: .6, sleepYaw: -1.2 });

  const dogModel = (() => {
    const FUR = lambert(0xb98555), WHITE = lambert(0xf3ead8), DARK = lambert(0x6d4a30), NOSE = lambert(0x2a2220);
    const root = new THREE.Group(); scene.add(root);
    const part = parts(root);
    const body = new THREE.Group(); root.add(body);
    part(new THREE.SphereGeometry(.27, 14, 10), FUR, 0, .42, 0, body).scale.set(.9, .85, 1.9);
    part(new THREE.SphereGeometry(.17, 10, 8), WHITE, 0, .34, .2, body).scale.set(.9, .8, 1);
    const head = new THREE.Group(); head.position.set(0, .56, .52); body.add(head);
    part(new THREE.SphereGeometry(.18, 12, 10), FUR, 0, 0, 0, head);
    part(new THREE.BoxGeometry(.14, .11, .16), WHITE, 0, -.05, .17, head);
    part(new THREE.SphereGeometry(.03, 6, 5), NOSE, 0, -.01, .26, head);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(.05, .2, .12), DARK, side * .17, -.03, -.02, head).rotation.z = side * .25;
      part(new THREE.SphereGeometry(.022, 6, 5), NOSE, side * .07, .06, .15, head);
    }
    const tail = new THREE.Group(); tail.position.set(0, .5, -.5); body.add(tail);
    part(new THREE.CylinderGeometry(.04, .025, .36, 8), FUR, 0, .14, -.08, tail).rotation.x = -.7;
    const legs = [[-.12, .3], [.12, .3], [-.12, -.3], [.12, -.3]].map(([x, z]) => part(new THREE.BoxGeometry(.09, .32, .09), FUR, x, .16, z, body));
    return { root, pose(mode, time) {
      const sleeping = mode === 'sleep', walking = mode === 'walk';
      body.scale.set(1, sleeping ? .62 : 1, sleeping ? .8 : 1); body.position.y = sleeping ? -.1 : walking ? Math.abs(Math.sin(time * 12)) * .04 : 0;
      head.rotation.x = sleeping ? .55 : 0; head.position.set(0, sleeping ? .42 : .56, sleeping ? .44 : .52);
      legs.forEach((leg, i) => { leg.visible = !sleeping; leg.rotation.x = walking ? Math.sin(time * 12 + (i % 2) * Math.PI) * .6 : 0; });
      tail.rotation.z = sleeping ? 0 : Math.sin(time * (walking ? 14 : 9)) * .5;
      if (sleeping) body.scale.y += Math.sin(time * 1.3) * .03;
    } };
  })();
  // Dog bed at the front, then laps along the front aisle past the manager's rug.
  const bed = new THREE.Group(); bed.position.set(-3.7, .4, 3.4); scene.add(bed);
  { const rim = new THREE.Mesh(new THREE.TorusGeometry(.62, .12, 8, 24), lambert(0xc9a98a)); rim.rotation.x = Math.PI / 2; rim.position.y = .12; rim.castShadow = true; bed.add(rim);
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, .08, 24), lambert(0xe9d6c0)); cushion.position.y = .06; bed.add(cushion); }
  const dog = makePet(dogModel, [[-3.7, .43, 3.4], [-3.7, .4, 5.7], [4.2, .4, 5.7]], { sleep: 30, laps: 2, speed: 2, rest: 1.2, phase: 11, sleepYaw: .6 });
  const petTalk = [[cat, catModel, 'Meo~', 1.1], [dog, dogModel, 'Gâu gâu!', 1.3]].map(([pet, model, text, lift]) => ({ pet, model, lift, el: make('span', 'crew-bubble', text) }));
  petTalk.forEach(t => { t.el.hidden = true; labels.append(t.el); });

  // A little cleaning bot patrols the front aisle so the office is never completely still.
  const cleaner = new THREE.Group();
  const cleanerBody = new THREE.Mesh(new THREE.CylinderGeometry(.5, .55, .22, 24), new THREE.MeshStandardMaterial({ color: 0xf3f1e8, roughness: .5 }));
  const cleanerEye = new THREE.Mesh(new THREE.BoxGeometry(.5, .05, .08), new THREE.MeshStandardMaterial({ color: 0x62d27a, emissive: 0x62d27a, emissiveIntensity: 1 }));
  cleanerEye.position.set(0, .12, .4); cleaner.add(cleanerBody, cleanerEye); cleaner.position.set(0, .5, 7.2); scene.add(cleaner);
  function animate(time, dt) {
    clock = time;
    board.tick(time);
    cat.update(time, bridge.reduced()); dog.update(time, bridge.reduced());
    petTalk.forEach(t => {
      const on = !bridge.reduced() && t.pet.active(time); t.el.hidden = !on;
      if (!on) return;
      tmp.copy(t.model.root.position); tmp.y += t.lift; tmp.project(cam);
      t.el.style.left = `${(tmp.x * .5 + .5) * bridge.width()}px`; t.el.style.top = `${(-tmp.y * .5 + .5) * bridge.height()}px`;
    });
    if (!bridge.reduced() && sound.on && time >= sound.nextKey && crew?.robots.some(r => r.state === 'working')) { blip(1500 + Math.random() * 1200, .03, 'square', .01); sound.nextKey = time + .09 + Math.random() * .22; }
    if (!bridge.reduced()) {
      cleaner.position.x = Math.sin(time * .22) * 7.5;
      cleaner.rotation.y = Math.cos(time * .22) > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (!crew) return;
    const still = bridge.reduced();
    const k = Math.min(1, dt * 6);
    crew.robots.forEach(r => {
      const s = r.summary; if (!s) return;
      const t = time + r.phase, st = s.state;
      if (r.route) {
        if (still) { r.root.position.copy(r.route.at(-1)); r.routeIndex = r.route.length; }
        else {
          const goal = r.route[r.routeIndex], delta = goal.clone().sub(r.root.position), dist = delta.length(), step = dt * FLY_SPEED;
          if (dist <= step) { r.root.position.copy(goal); r.routeIndex++; } else r.root.position.addScaledVector(delta, step / dist);
        }
        if (r.routeIndex >= r.route.length) { r.route = null; r.mode = r.mode === 'returning' ? 'seated' : 'docked'; }
      }
      const docked = r.mode === 'docked';
      r.dock.cable.visible = docked;
      r.dock.ledMat.emissiveIntensity = docked ? .8 + (still ? 0 : Math.sin(time * 2.5) * .35) : .15;
      r.root.rotation.z = lerp(r.root.rotation.z, docked ? -.12 : 0, k);
      const colour = st === 'offline' ? GREY : STYLE_COLORS[r.style];
      r.bodyMat.color.setHex(colour);
      const light = STATE_LIGHT[st];
      r.lightMat.color.setHex(light); r.lightMat.emissive.setHex(light);
      r.ringMat.color.setHex(light); r.ringMat.emissive.setHex(light);
      const pulse = st === 'error' ? (Math.sin(t * 14) > 0 ? 1.8 : .15) : st === 'working' ? 1 + Math.sin(t * 6) * .6
        : st === 'idle' ? 1 + Math.sin(t * 2) * .25 : st === 'offline' ? 0 : st === 'exhausted' ? .15 : .9;
      r.lightMat.emissiveIntensity = still ? 1 : pulse; r.ringMat.emissiveIntensity = (st === 'offline' ? 0 : .8) * (still ? 1 : .6 + Math.abs(Math.sin(t * 3)) * .6);

      // Chest battery follows the session quota (unknown = half, dim).
      const level = s.quota.session ?? s.quota.lowest;
      const frac = level === null || level === undefined ? .5 : Math.max(.04, Math.min(1, level / 100));
      r.fill.scale.y = frac; r.fill.position.y = .85 - (1 - frac) * .2;
      const batt = st === 'offline' ? 0x444444 : level === null || level === undefined ? 0x8a9a92 : level <= 0 ? STATE_LIGHT.exhausted : level <= 10 ? STATE_LIGHT.low : STATE_LIGHT.idle;
      r.chestMat.color.setHex(batt); r.chestMat.emissive.setHex(batt);
      r.chestMat.emissiveIntensity = st === 'offline' ? 0 : .9;

      // Asleep only once docked; on the way there or back a spent robot shuffles along tired.
      const sleepy = st === 'exhausted' && docked, hurt = st === 'error', dead = st === 'offline', working = st === 'working', low = st === 'low' || (st === 'exhausted' && !docked);
      // Face.
      r.eyes.forEach(e => {
        e.visible = !hurt && !dead;
        const blink = !still && Math.sin(t * .9) > .985 ? .1 : 1;
        e.scale.set(1, sleepy ? .12 : low ? .45 : working ? .6 * blink : blink, 1);
      });
      r.eyeMat.color.setHex(sleepy ? 0x8aa2c8 : low ? 0xf3cf7a : 0x9bf2c0); r.eyeMat.emissive.copy(r.eyeMat.color);
      r.crossEyes.forEach(g => { g.visible = hurt; });
      r.mouth.visible = !dead;
      r.mouth.scale.set(hurt ? 1.1 : sleepy ? .5 : low ? .8 : 1, hurt ? 2 : 1, 1);
      r.mouth.position.y = working ? .33 + Math.sin(t * 10) * .03 : .33;

      // Posture.
      const slump = sleepy ? .55 : dead ? .25 : low ? .2 : 0;
      r.head.rotation.x = lerp(r.head.rotation.x, slump, k);
      r.body.position.y = lerp(r.body.position.y, .15 - (sleepy ? .1 : dead ? .06 : 0), k);
      r.body.rotation.z = hurt && !still ? Math.sin(t * 28) * .035 : 0;
      r.body.rotation.y = !still && !dead && !sleepy ? Math.sin(t * .6) * .06 : 0;
      const ev = r.event && r.event.until > time && !still ? r.event : null;
      const armTarget = side => ev ? (ev.type === 'cheer' ? -2.7 + Math.sin(t * 12 + side * Math.PI) * .25 : ev.type === 'dance' ? -2.6 + Math.sin(t * 10 + side * Math.PI) * .5 : -2.9 + Math.sin(t * 3) * .1)
        : hurt ? -2.45 + Math.sin(t * 8 + side) * .1
        : working ? -1.15 + Math.sin(t * 15 + side * Math.PI) * .13
          : sleepy || dead ? .12 : -.1 + Math.sin(t * 1.4 + side) * .03;
      r.arms.forEach((arm, i) => { arm.rotation.x = lerp(arm.rotation.x, armTarget(i ? 1 : -1), Math.min(1, dt * 10)); });
      r.holo.visible = working; r.holo.material.opacity = .4 + Math.sin(t * 5) * .15;
      r.orbit.visible = working; if (working) r.orbit.rotation.z = t * 3;

      // Floating glyphs.
      r.zs.forEach((z, i) => {
        z.visible = sleepy && !still;
        if (!z.visible) return;
        const u = ((t * .45 + i / 3) % 1);
        z.position.set(.5 + u * .7, 2.7 + u * 1.2, .3); z.material.opacity = 1 - u; z.scale.setScalar(.35 + u * .5);
      });
      // Easter egg spin: three full turns that ease out and land exactly on the resting angle.
      r.root.rotation.y = ev && ev.type === 'dance' ? .2 + 6 * Math.PI * (1 - Math.pow(1 - (time - ev.start) / (ev.until - ev.start), 2)) : .2;
      r.siren.visible = hurt; if (hurt) r.siren.rotation.y = still ? 0 : t * 8;
      r.alert.visible = hurt; if (hurt) r.alert.position.set(0, 3.5 + (still ? 0 : Math.abs(Math.sin(t * 6)) * .35), .2);
      r.drop.visible = low && !still; if (r.drop.visible) r.drop.position.set(.75, 2.5 - ((t * .8) % 1) * .5, .4);
      r.smoke.forEach((puff, i) => {
        puff.visible = hurt && !still;
        if (!puff.visible) return;
        const u = ((t * .7 + i / 3) % 1);
        puff.position.set(Math.sin(i * 2.1 + t) * .18, 2.9 + u * 1.1, -.1); puff.scale.setScalar(.6 + u * 1.1); puff.material.opacity = (1 - u) * .45;
      });

      r.confetti.forEach((piece, i) => {
        piece.visible = !!ev && ev.type !== 'stretch';
        if (!piece.visible) return;
        const u = (time - ev.start) / (ev.until - ev.start), a = i * .52 + 1;
        piece.position.set(Math.cos(a) * u * 1.6, 2.3 + 1.8 * u - 3.2 * u * u, Math.sin(a) * u * .9);
        piece.rotation.z = t * 6 + i; piece.material.opacity = Math.max(0, 1 - u * u);
      });
      r.props.steam.forEach((puff, i) => {
        puff.visible = st !== 'offline' && !still;
        if (!puff.visible) return;
        const u = (time * .45 + i / 2) % 1;
        puff.position.set(-1 + Math.sin(u * 7 + i) * .03, .28 + u * .5, -.38); puff.scale.setScalar(.8 + u); puff.material.opacity = (1 - u) * .45;
      });
      r.props.lampMat.emissiveIntensity = st === 'offline' || r.lampOff || docked ? 0 : 1.2;
      // Packets fly desk -> robot only while that robot has a running job.
      r.packet.visible = working && !still;
      if (r.packet.visible) {
        const u = (t * .35) % 1, p = r.root.position;
        r.packet.position.set(lerp(MANAGER[0], p.x, u), lerp(MANAGER[1], p.y + 1.5, u) + Math.sin(u * Math.PI) * 1.4, lerp(MANAGER[2], p.z, u));
        r.packet.rotation.y = t * 3;
      }
      // Label anchored above the head.
      // One small line above the head; the quota bars and details only open on hover or when selected.
      tmp.copy(r.root.position); tmp.y += (hurt ? 4.2 : 3.6) * SCALE; tmp.project(cam);
      r.label.style.left = `${(tmp.x * .5 + .5) * bridge.width()}px`;
      r.label.style.top = `${(-tmp.y * .5 + .5) * bridge.height()}px`;
      r.label.style.visibility = tmp.z > 1 ? 'hidden' : 'visible';
      tmp.copy(r.root.position); tmp.y += 1.25; tmp.project(cam);
      r.bubble.style.left = `${(tmp.x * .5 + .5) * bridge.width()}px`; r.bubble.style.top = `${(-tmp.y * .5 + .5) * bridge.height()}px`;
      r.bubble.style.visibility = tmp.z > 1 || still ? 'hidden' : 'visible';
    });
  }

  // Click a robot in the scene to open the quota panel, like clicking its label.
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let down = null;
  const canvas = bridge.renderer.domElement;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  const within = (object, root) => { for (let o = object; o; o = o.parent) if (o === root) return true; return false; };
  // One raycast decides what the pointer is over; the nearest of robot / pet / desk lamp / wall board / paper tray wins.
  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(mouse, cam);
    const found = [];
    const robotHit = crew ? ray.intersectObjects(crew.robots.map(r => r.root), true)[0] : null;
    if (robotHit) found.push({ kind: 'robot', hit: robotHit, robot: crew.robots.find(r => within(robotHit.object, r.root)) });
    const petHit = ray.intersectObjects(petTalk.map(t => t.model.root), true)[0];
    if (petHit) found.push({ kind: 'pet', hit: petHit, talk: petTalk.find(t => within(petHit.object, t.model.root)) });
    const lampHit = crew ? ray.intersectObjects(crew.robots.map(r => r.props.group), true).find(h => h.object.userData.lamp) : null;
    if (lampHit) found.push({ kind: 'lamp', hit: lampHit, robot: crew.robots.find(r => within(lampHit.object, r.props.group)) });
    const boardHit = ray.intersectObject(board.group, true)[0];
    if (boardHit) found.push({ kind: 'board', hit: boardHit });
    const trayHit = ray.intersectObject(tray.group, true)[0];
    if (trayHit) found.push({ kind: 'tray', hit: trayHit });
    for (const item of bridge.clickables || []) { const hit = ray.intersectObject(item.group, true)[0]; if (hit) found.push({ kind: 'object', hit, item }); }
    return found.sort((x, y) => x.hit.distance - y.hit.distance)[0] || null;
  }
  let lastMove = 0;
  canvas.addEventListener('pointermove', e => {
    if (e.buttons || e.timeStamp - lastMove < 80) return;
    lastMove = e.timeStamp; canvas.style.cursor = pick(e) ? 'pointer' : '';
  });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const target = pick(e);
    if (!target) return;
    if (target.kind === 'pet') {
      target.talk.pet.poke(clock);
      if (target.talk.model === catModel) blip(700, .4, 'sine', .05, 1.7); else { blip(180, .12, 'sawtooth', .06, .6); setTimeout(() => blip(170, .12, 'sawtooth', .06, .6), 170); }
    } else if (target.kind === 'lamp') {
      target.robot.lampOff = !target.robot.lampOff; blip(target.robot.lampOff ? 500 : 800, .08, 'square', .03);
    } else if (target.kind === 'board') {
      document.getElementById('live-quota-overview')?.setAttribute('open', ''); openedByCrew = true;
    } else if (target.kind === 'object') {
      target.item.onClick();
    } else if (target.kind === 'tray') {
      window.mocOfficeLayout?.showTab('work');
    } else if (target.kind === 'robot') {
      const robot = target.robot;
      choose(robot.id);
      // Easter egg: five quick taps on the same robot make it spin and dance.
      robot.taps = (robot.taps || []).filter(t => clock - t < 3).concat(clock);
      if (robot.taps.length >= 5) { robot.taps = []; robot.event = { type: 'dance', start: clock, until: clock + 4 }; blip(988, .15, 'triangle', .06); setTimeout(() => blip(1318, .2, 'triangle', .06), 160); }
    }
  });

  bridge.frame.push(animate);
  poll();
  setInterval(poll, 2000);
}
