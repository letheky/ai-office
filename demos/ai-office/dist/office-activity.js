// "Nhịp văn phòng": a live log built from changes in the data the office already polls
// (jobs + AI account state). It adds no API calls; a row opens the matching conversation.
import { activityState, activityEvents, seedEvents } from './office-activity-state.mjs?v=1';

const feed = document.getElementById('activity-feed');
const count = document.getElementById('activity-count');
if (feed && window.mocOfficeLive?.snapshot) {
  const MAX = 30;
  let events = [], prev = null;
  const time = ms => new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
  function render() {
    feed.replaceChildren();
    count.textContent = events.length ? `${events.length} hoạt động` : 'Chưa có hoạt động';
    if (!events.length) {
      const empty = document.createElement('div'); empty.className = 'feed-item';
      const text = document.createElement('p'); text.textContent = 'Chưa có việc nào chạy. Khi AI bắt đầu, xong việc, lỗi hoặc hết hạn mức, mọi thứ sẽ hiện ở đây.';
      empty.append(text); feed.append(empty); return;
    }
    for (const event of events) {
      const row = document.createElement(event.jobId ? 'button' : 'div'); row.className = `feed-item feed-${event.tone}`;
      if (event.jobId) { row.type = 'button'; row.title = 'Mở cuộc trò chuyện'; row.addEventListener('click', () => window.mocOfficeLive.openJob?.(event.jobId)); }
      const icon = document.createElement('span'); icon.className = 'feed-icon'; icon.textContent = event.icon;
      const info = document.createElement('div'); const title = document.createElement('p'); title.textContent = event.text;
      const small = document.createElement('small'); small.textContent = time(event.time);
      info.append(title, small); row.append(icon, info); feed.append(row);
    }
  }
  function poll() {
    const { jobs, capabilities } = window.mocOfficeLive.snapshot();
    if (!capabilities) return;
    const next = activityState(capabilities, jobs, Date.now());
    if (!prev) events = seedEvents(capabilities, jobs);
    else events = [...activityEvents(prev, next, Date.now()).reverse(), ...events].slice(0, MAX);
    prev = next; render();
  }
  poll(); setInterval(poll, 2000);
}
