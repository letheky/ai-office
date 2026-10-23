// Browser speech recognition only: audio never goes through the app/AI workers.
let active = null;
export function stopSpeech() { active?.(); }

const errors = {
  'not-allowed': 'Chưa được cấp quyền micro. Cho phép micro trong cài đặt trang rồi thử lại.',
  'service-not-allowed': 'Chrome chưa cho phép dịch vụ nhận giọng nói. Bạn vẫn có thể gõ nội dung.',
  'audio-capture': 'Không tìm thấy hoặc không mở được micro.',
  'network': 'Không kết nối được dịch vụ nhận giọng nói. Kiểm tra mạng rồi thử lại.',
  'no-speech': 'Chưa nghe rõ lời nói. Bấm micro để thử lại.',
  'language-not-supported': 'Trình duyệt chưa hỗ trợ nhận giọng nói tiếng Việt.',
};

export function mountSpeech({form, input, make, scope = form, win = window}) {
  const doc = input.ownerDocument;
  const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
  const box = make('div', 'live-speech');
  const button = make('button', 'live-speech-button', '🎤 Nói'); button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  const status = make('span', 'live-speech-status', 'Tiếng Việt · Xem lại rồi bấm Gửi');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const preview = make('span', 'live-speech-preview'); preview.hidden = true;
  box.title = 'Nhận giọng nói bằng Chrome. Âm thanh có thể được gửi tới dịch vụ nhận dạng của trình duyệt; không qua server ứng dụng.';
  box.append(button, status, preview); input.after(box);
  let session = null, destroyed = false, internalInput = false;
  const send = form.querySelector('button[type="submit"]');
  const blocked = () => input.disabled || !!send?.disabled;
  const policy = doc.permissionsPolicy || doc.featurePolicy;
  const permitted = !policy?.allowsFeature || policy.allowsFeature('microphone');
  const supported = !!Recognition && win.isSecureContext !== false && permitted;
  if (!supported) status.textContent = !Recognition
    ? 'Trình duyệt chưa hỗ trợ nhận giọng nói. Bạn vẫn có thể gõ nội dung.'
    : win.isSecureContext === false ? 'Mở trang bằng HTTPS để dùng micro.'
    : 'Trang đang chặn micro. Cần cập nhật quyền micro cho trang Văn phòng AI.';
  function paint() {
    button.textContent = session ? (session.stopping ? 'Đang dừng…' : '■ Dừng nói') : '🎤 Nói';
    button.disabled = !supported || blocked() || !!session?.stopping;
    button.setAttribute('aria-pressed', String(!!session));
    button.setAttribute('aria-label', session ? 'Dừng nhận giọng nói' : 'Nhập bằng giọng nói tiếng Việt');
  }
  function finish(message) {
    const old = session; session = null;
    if (old) {
      win.clearTimeout(old.timer);
      old.rec.onstart = old.rec.onresult = old.rec.onerror = old.rec.onend = null;
    }
    if (active === cancel) active = null;
    preview.hidden = true; preview.textContent = '';
    if (message) status.textContent = message;
    paint(); return old;
  }
  function cancel(message = 'Đã dừng micro. Xem lại nội dung rồi bấm Gửi.') {
    const old = finish(message);
    try { old?.rec.abort(); } catch {}
  }
  function stop() {
    if (!session || session.stopping) return;
    session.stopping = true; status.textContent = 'Đang nhận nốt lời nói…'; paint();
    session.timer = win.setTimeout(() => cancel(), 2500);
    try { session.rec.stop(); } catch { cancel(); }
  }
  function start() {
    if (!supported || destroyed || blocked()) return;
    stopSpeech();
    try {
      const rec = new Recognition(), current = {rec, seen: new Set(), stopping: false};
      session = current; active = cancel;
      rec.lang = 'vi-VN'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      status.textContent = 'Đang mở micro…'; paint();
      rec.onstart = () => { if (session === current) status.textContent = 'Đang nghe tiếng Việt… Bấm Dừng nói khi xong.'; };
      rec.onresult = event => {
        if (session !== current || destroyed) return;
        if (scope.hidden || blocked() || !input.isConnected) return cancel();
        const interim = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i], words = String(result[0]?.transcript || '').trim();
          if (!result.isFinal) { if (words) interim.push(words); continue; }
          if (current.seen.has(i)) continue;
          current.seen.add(i); if (!words) continue;
          const before = input.value.slice(0, input.selectionStart), after = input.value.slice(input.selectionEnd);
          const text = (before && !/\s$/.test(before) && !/^[.,!?;:]/.test(words) ? ' ' : '') + words
            + (after && !/^[\s.,!?;:]/.test(after) ? ' ' : '');
          if (input.maxLength >= 0 && before.length + text.length + after.length > input.maxLength)
            return cancel('Nội dung vượt giới hạn ô nhập. Hãy rút ngắn rồi thử lại.');
          input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
          internalInput = true;
          try { input.dispatchEvent(new win.Event('input', {bubbles:true})); } finally { internalInput = false; }
        }
        preview.textContent = interim.join(' '); preview.hidden = !preview.textContent;
      };
      rec.onerror = event => {
        if (session !== current) return;
        cancel(errors[event.error] || (event.error === 'aborted' ? 'Đã dừng micro.' : 'Không nhận được giọng nói. Bạn vẫn có thể gõ nội dung.'));
      };
      rec.onend = () => { if (session === current) finish('Đã dừng micro. Xem lại nội dung rồi bấm Gửi.'); };
      rec.start();
    } catch { cancel('Không mở được micro. Kiểm tra quyền micro rồi thử lại.'); }
  }
  const toggle = () => session ? stop() : start();
  const edited = () => { if (session && !internalInput) cancel('Đã dừng micro để bạn chỉnh sửa nội dung.'); };
  const pointer = event => {
    const sending = form.contains(event.target) && event.target.closest('button')?.type === 'submit';
    if (session && !button.contains(event.target) && !sending) edited();
  };
  const submit = event => {
    if (!session) return;
    event.preventDefault(); event.stopImmediatePropagation(); stop();
  };
  const key = event => {
    if (session && event.key === 'Enter' && !event.shiftKey && !event.isComposing) submit(event);
  };
  const visibility = () => { if (doc.hidden && session) cancel(); };
  const pagehide = () => { if (session) cancel(); };
  button.addEventListener('click', toggle);
  input.addEventListener('beforeinput', edited); input.addEventListener('input', edited);
  input.addEventListener('keydown', key, true);
  doc.addEventListener('pointerdown', pointer, true); form.addEventListener('submit', submit, true);
  doc.addEventListener('visibilitychange', visibility); win.addEventListener('pagehide', pagehide);
  const observer = new win.MutationObserver(() => {
    if (session && (scope.hidden || blocked())) cancel();
    paint();
  });
  observer.observe(scope, {attributes:true, attributeFilter:['hidden']});
  observer.observe(input, {attributes:true, attributeFilter:['disabled']});
  if (send) observer.observe(send, {attributes:true, attributeFilter:['disabled']});
  paint();
  return {cancel, destroy() {
    if (destroyed) return;
    destroyed = true; cancel(); observer.disconnect();
    button.removeEventListener('click', toggle);
    input.removeEventListener('beforeinput', edited); input.removeEventListener('input', edited);
    input.removeEventListener('keydown', key, true);
    doc.removeEventListener('pointerdown', pointer, true); form.removeEventListener('submit', submit, true);
    doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('pagehide', pagehide);
    box.remove();
  }};
}
