// Pure logic for the "Nhịp văn phòng" feed: turns changes between two polls of jobs + capabilities
// into readable events. No network, no DOM, so it can be tested in Node.
import { crewAccounts, crewState } from './office-crew-state.mjs';

const short = (text, n = 70) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const mineOf = (accounts, job) => accounts.find(a => job.executor === (a.workerId || a.id) && (!job.provider || !a.provider || job.provider === a.provider));
const whoOf = (accounts, job) => { const a = mineOf(accounts, job); return a ? `${a.label}${a.host ? ` (${a.host})` : ''}` : 'AI'; };

export function activityState(capabilities = {}, jobs = [], now = Date.now()) {
  const accounts = crewAccounts(capabilities);
  return {
    accounts: Object.fromEntries(accounts.map(a => {
      const s = crewState(a, [], now);
      return [a.id, { who: `${a.label}${a.host ? ` (${a.host})` : ''}`, key: s.state === 'offline' ? 'offline' : s.state === 'exhausted' ? 'exhausted' : 'ok', resetsAt: s.quota.resetsAt }];
    })),
    jobs: Object.fromEntries(jobs.map(j => [j.id, { status: j.status, question: j.question, error: j.error, who: whoOf(accounts, j) }])),
  };
}

const clock = seconds => new Date(seconds * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

export function activityEvents(prev, next, now = Date.now()) {
  const events = [];
  const add = (icon, tone, text, jobId) => events.push({ time: now, icon, tone, text, jobId });
  for (const [id, job] of Object.entries(next.jobs)) {
    const before = prev.jobs[id]?.status;
    if (job.status === before) continue;
    if (job.status === 'running') add('▶', 'info', `${job.who} bắt đầu: ${short(job.question)}`, id);
    else if (job.status === 'done' && before) add('✓', 'ok', `${job.who} xong: ${short(job.question)}`, id);
    else if (job.status === 'error' && before) add('!', 'error', `${job.who} gặp lỗi: ${short(job.error || job.question)}`, id);
  }
  for (const [id, account] of Object.entries(next.accounts)) {
    const before = prev.accounts[id]?.key;
    if (!before || before === account.key) continue;
    if (account.key === 'exhausted') add('⏳', 'warn', `${account.who} hết hạn mức${account.resetsAt ? `, mở lại lúc ${clock(account.resetsAt)}` : ''}`);
    else if (account.key === 'offline') add('○', 'warn', `${account.who} ngoại tuyến`);
    else if (before === 'exhausted') add('↻', 'ok', `${account.who} đã mở lại hạn mức`);
    else add('●', 'ok', `${account.who} đã trở lại`);
  }
  return events;
}

// Recent finished jobs so the feed is not empty right after opening the page.
export function seedEvents(capabilities = {}, jobs = [], limit = 6) {
  const accounts = crewAccounts(capabilities);
  return jobs.filter(j => (j.status === 'done' || j.status === 'error') && j.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit)
    .map(j => j.status === 'done'
      ? { time: j.finishedAt, icon: '✓', tone: 'ok', text: `${whoOf(accounts, j)} xong: ${short(j.question)}`, jobId: j.id }
      : { time: j.finishedAt, icon: '!', tone: 'error', text: `${whoOf(accounts, j)} gặp lỗi: ${short(j.error || j.question)}`, jobId: j.id });
}
