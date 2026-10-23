const { advanceConversations } = require('./aiOfficeConversation');
const { STOPPED } = require('../../scripts/ai-office-session');
const { REMOVAL_ERROR } = require('./aiOfficeAccountRemoval');
// Team mode: a large brief is planned once, split into small steps that run in
// parallel on different accounts/models, then merged. Token rules:
//  - simple briefs never reach the planner (one model, cheapest fitting tier);
//  - the planner sees only the brief + file names, never business data;
//  - each step gets only its own brief, the data it asked for and the short
//    hand-off summaries of its dependencies (not their full answers);
//  - model tier follows difficulty: easy → light model/low effort, hard → top model.
const { randomUUID } = require('crypto');
const { plain, classify } = require('./aiOfficeRouting');
const { workerRows, chooseWorker } = require('./aiOfficeMachines');
const { usageOf, quotaState } = require('./aiOfficeQuota');
const { modelConfig } = require('./aiOfficeModels');
const { vpsAccounts, eligibleAccounts } = require('./aiOfficeVpsAccounts');

// Tier → model/effort comes from the admin model config (tab Model); defaults in aiOfficeModels.
const tierTable = db => modelConfig(db).tiers;
const MAX_STEPS = 6;
const SUMMARY_HEAD = '## Tóm tắt bàn giao';

// Cheap local heuristic: only clearly multi-part briefs pay for a planning call.
function isComplex(question) {
  const q = plain(question);
  let score = 0;
  if (q.length > 220) score++;
  if (q.length > 450) score++;
  const steps = (q.match(/sau do|roi |tiep theo|dong thoi|buoc \d|(^|\n)\s*(\d+[.)]|-|\*)\s/g) || []).length;
  if (steps >= 2) score++;
  if (/chien dich|ke hoach tong the|du an|hoan chinh|toan bo|nhieu buoc|tu a den z|tron goi|day du|tong hop|ra mat|video .*(dung|ghep)|nghien cuu .* (va|roi) /.test(q)) score++;
  if ((q.match(/ va |, /g) || []).length >= 4) score++;
  return score >= 2;
}

const PLAN_INSTRUCTION = [
  'Bạn là AI lập kế hoạch chia việc. Việc đầu tiên: quyết định có cần chia việc cho nhiều AI không.',
  'Mở đầu câu trả lời bằng MỘT khối JSON (không markdown):',
  '{"split":true|false,"self":true|false,"reason":"≤200 ký tự","steps":[{"id":"s1","title":"≤80 ký tự","brief":"đề bài tự chứa đủ thông tin cần thiết, ≤1200 ký tự","difficulty":"easy|medium|hard","needs_data":true|false,"depends_on":["s1"]}]}',
  `Quy tắc: nếu 1 AI làm tốt trong một lượt → split=false và steps có đúng 1 bước (đề bài gốc). Tối đa ${MAX_STEPS} bước, đa số việc 2–4 bước là đủ.`,
  'Mỗi bước tốn thêm một lượt gọi AI với phí cố định khoảng 17.000 token: chỉ tách khi mỗi phần đủ lớn hoặc cần chuyên môn khác hẳn.',
  'Nếu split=false VÀ việc KHÔNG cần số liệu shop, KHÔNG cần đọc tệp/mã nguồn, trình duyệt hay công cụ: đặt self=true, xuống dòng ghi đúng "===TRẢ LỜI===" rồi viết luôn câu trả lời hoàn chỉnh cho chủ shop (đỡ tốn một lượt). Trường hợp khác self=false và dừng ngay sau JSON.',
  'Chỉ tách khi các phần khác chuyên môn hoặc làm song song được; ưu tiên depends_on rỗng để chạy song song. Không tạo bước "tổng hợp" — hệ thống tự gộp ở cuối.',
  'difficulty: easy = tra cứu, định dạng, liệt kê, viết ngắn; medium = phân tích, nội dung dài, kịch bản; hard = suy luận nhiều bước, đối soát số liệu, code/debug, quyết định quan trọng. Chọn mức THẤP NHẤT vẫn đạt chất lượng.',
  'needs_data=true chỉ khi bước cần số liệu kinh doanh của shop (doanh thu, đơn, lãi, kho, quảng cáo).',
].join('\n');

const ANSWER_MARK = '===TRẢ LỜI===';
function parsePlan(text) {
  const full = String(text || '');
  const at = full.indexOf(ANSWER_MARK);
  const raw = at >= 0 ? full.slice(0, at) : full;
  const answer = at >= 0 ? full.slice(at + ANSWER_MARK.length).trim() : '';
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let plan;
  try { plan = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(plan?.steps) || !plan.steps.length) return null;
  const steps = plan.steps.slice(0, MAX_STEPS).map((s, i) => ({
    id: String(s?.id || `s${i + 1}`).slice(0, 20),
    title: String(s?.title || `Phần ${i + 1}`).slice(0, 80),
    brief: String(s?.brief || '').trim().slice(0, 1500),
    difficulty: ['easy', 'medium', 'hard'].includes(s?.difficulty) ? s.difficulty : 'medium',
    needsData: s?.needs_data === true,
    dependsOn: Array.isArray(s?.depends_on) ? s.depends_on.map(String) : [],
  })).filter(s => s.brief);
  if (!steps.length) return null;
  // Model output may repeat ids (or collide after truncation): make them unique, else the
  // insert hits a duplicate primary key and the plan would retry forever.
  const seen = new Set();
  steps.forEach((s, i) => { if (seen.has(s.id)) s.id = `s${i + 1}__${i}`; seen.add(s.id); });
  const ids = new Set(steps.map(s => s.id));
  // Only allow edges to earlier steps: guarantees no cycles and no dangling ids.
  steps.forEach((s, i) => { s.dependsOn = [...new Set(s.dependsOn)].filter(d => ids.has(d) && steps.findIndex(x => x.id === d) < i); });
  const split = plan.split !== false && steps.length > 1;
  return { split, self: !split && plan.self === true && answer.length > 20, answer, reason: String(plan.reason || '').slice(0, 200), steps };
}

function summaryOf(result, max = 1500) {
  const text = String(result || '');
  const at = text.lastIndexOf(SUMMARY_HEAD);
  return (at >= 0 ? text.slice(at + SUMMARY_HEAD.length) : text).trim().slice(0, max);
}

// Pick provider/model/account for one step on the plan's machine. Returns null
// when nothing usable is online yet (the step simply keeps waiting).
// `avoid` = provider to stay away from (cross-check by another vendor, retry after a failure).
// `accounts` = ticked accounts (worker ids, or 'vps:<provider>'); null = all on the machine.
function assign(db, host, tier, brief, now = Date.now(), avoid = null, accounts = null) {
  const tiers = tierTable(db);
  const preferred = classify(brief).provider;
  const order = (preferred === 'codex' ? ['codex', 'claude'] : ['claude', 'codex']).sort((a, b) => (a === avoid) - (b === avoid));
  const options = [];
  if (host === 'vps') {
    const available = vpsAccounts(db, now).filter(a => !accounts || accounts.includes(a.id));
    const load = db.prepare("SELECT count(*) n FROM ai_office_jobs WHERE executor=? AND status IN ('pending','running')");
    for (const provider of order) {
      if (!tiers[tier]?.[provider]) continue;
      const { model, effort } = tiers[tier][provider];
      for (const account of eligibleAccounts(available, provider, model, now)) {
        const quota = quotaState(account.usage[provider], model, now);
        options.push({ provider, model, effort, executor: account.workerId, accountId: account.id, load: load.get(account.workerId).n, quota });
      }
    }
  } else {
    const rows = workerRows(db, host).filter(row => !accounts || accounts.includes(row.id));
    const load = db.prepare("SELECT count(*) n FROM ai_office_jobs WHERE executor=? AND status IN ('pending','running')");
    for (const provider of order) {
      if (!tiers[tier]?.[provider]) continue;
      const { model, effort } = tiers[tier][provider];
      let executor;
      try { executor = chooseWorker(db, rows, provider, now, model); } catch { continue; }
      const row = rows.find(r => r.id === executor);
      options.push({ provider, model, effort, executor, load: load.get(executor).n, quota: quotaState(usageOf(row)[provider], model, now) });
    }
  }
  if (!options.length) return null;
  // Parallelism first (idle account), then quota health, then the provider that suits the brief.
  const rank = { ready: 0, unknown: 1, low: 2 };
  return options.sort((a, b) => (a.provider === avoid) - (b.provider === avoid) || a.load - b.load || rank[a.quota.status] - rank[b.quota.status] || order.indexOf(a.provider) - order.indexOf(b.provider))[0];
}

function selectionFor(choice, host, why, accounts = null) {
  return { model: choice.model, effort: choice.effort, provider: choice.provider, requestedModel: 'auto', requestedEffort: 'auto',
    requestedProvider: 'auto', machineId: host, reason: why, ...(choice.accountId ? { accountId: choice.accountId } : {}), ...(accounts ? { accounts } : {}) };
}

function parseJson(value, fallback) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }

const insertJob = db => db.prepare(`INSERT INTO ai_office_jobs (id, created_by, shop, question, kind, provider, selection_reason, context_json,
  executor, assigned_agent, allow_files, selection_json, project_id, status, plan_id, team_role, depends_json, difficulty, title)
  VALUES (@id,@created_by,@shop,@question,@kind,'claude',@reason,'{}','',@agent,@allow_files,NULL,@project_id,'waiting',@plan_id,@role,@depends,@difficulty,@title)`);

function expandPlan(db, plan) {
  const parsed = parsePlan(plan.result);
  const shared = parseJson(plan.shared_context_json, {});
  const goal = parseJson(plan.context_json, {}).goal || plan.question;
  if (parsed?.self) {
    // The planner judged the brief simple and answered it in the same call: no extra job.
    db.prepare('UPDATE ai_office_jobs SET result=?, depends_json=?, team_expanded=1 WHERE id=?')
      .run(parsed.answer.slice(0, 30000), JSON.stringify({ self: true, reason: parsed.reason }), plan.id);
    return;
  }
  const steps = parsed?.steps || [{ id: 's1', title: 'Thực hiện', brief: goal, difficulty: 'medium', needsData: true, dependsOn: [] }];
  const ids = new Map(steps.map(s => [s.id, randomUUID()]));
  const reviewIds = new Map();
  const insert = insertJob(db);
  db.transaction(() => {
    for (const step of steps) {
      const route = classify(step.brief);
      const index = steps.indexOf(step) + 1;
      insert.run({ id: ids.get(step.id), created_by: plan.created_by, shop: plan.shop, question: step.brief.slice(0, 2000), kind: route.kind,
        reason: parsed ? `Phần của kế hoạch · độ khó ${step.difficulty}` : 'Kế hoạch không đọc được — một AI làm cả việc',
        agent: route.agent, allow_files: shared.admin ? 1 : 0, project_id: plan.project_id, plan_id: plan.id, role: 'step',
        depends: JSON.stringify({ deps: step.dependsOn.map(d => ids.get(d)), needsData: step.needsData, index, total: steps.length }),
        difficulty: step.difficulty, title: step.title });
      // Cross-check by another model: hard parts and parts that state shop numbers.
      if (shared.review !== false && (step.difficulty === 'hard' || step.needsData)) {
        const id = randomUUID(); reviewIds.set(step.id, id);
        insert.run({ id, created_by: plan.created_by, shop: plan.shop, question: `Kiểm tra: ${step.title}`.slice(0, 2000), kind: route.kind,
          reason: 'Model khác kiểm tra chéo', agent: route.agent, allow_files: shared.admin ? 1 : 0, project_id: plan.project_id, plan_id: plan.id, role: 'review',
          depends: JSON.stringify({ deps: [ids.get(step.id)], reviewOf: ids.get(step.id), needsData: step.needsData, index: index + 0.5, total: steps.length }),
          difficulty: 'medium', title: `Kiểm tra: ${step.title}`.slice(0, 80) });
      }
    }
    if (steps.length > 1 || reviewIds.size) {
      const route = classify(goal);
      insert.run({ id: randomUUID(), created_by: plan.created_by, shop: plan.shop, question: `Tổng hợp kết quả: ${goal}`.slice(0, 2000), kind: route.kind,
        reason: 'Gộp kết quả các phần thành bản cuối', agent: 'Điều phối', allow_files: shared.admin ? 1 : 0, project_id: plan.project_id,
        plan_id: plan.id, role: 'merge', depends: JSON.stringify({ deps: [...ids.values(), ...reviewIds.values()], steps: [...ids.values()], needsData: false }),
        difficulty: steps.some(s => s.difficulty === 'hard') ? 'medium' : 'easy', title: 'Tổng hợp bản cuối' });
    }
    db.prepare('UPDATE ai_office_jobs SET team_expanded=1 WHERE id=?').run(plan.id);
  })();
}

// Reviewer output: "KẾT LUẬN: ĐẠT" or "KẾT LUẬN: CẦN SỬA" + "## Bản đã sửa" (full corrected answer).
function reviewVerdict(text) {
  const t = String(text || '');
  const fix = /KẾT LUẬN:\s*CẦN SỬA/i.test(t);
  const at = t.indexOf('## Bản đã sửa');
  return { ok: /KẾT LUẬN:\s*ĐẠT/i.test(t) && !fix, fix, notes: (at >= 0 ? t.slice(0, at) : t).trim().slice(0, 1200),
    corrected: fix && at >= 0 ? t.slice(at + '## Bản đã sửa'.length).trim() : '' };
}

function readyContext(db, job, deps, meta) {
  const plan = db.prepare('SELECT * FROM ai_office_jobs WHERE id=?').get(job.plan_id);
  const shared = parseJson(plan.shared_context_json, {});
  const planContext = parseJson(plan.context_json, {});
  const depJobs = deps.map(id => db.prepare('SELECT id,title,result,files_json FROM ai_office_jobs WHERE id=?').get(id)).filter(Boolean);
  const context = { team: { goal: planContext.goal || plan.question, role: job.team_role, title: job.title, part: meta.index, total: meta.total } };
  if (meta.needsData && shared.business) Object.assign(context, shared.business);
  if (planContext.project) { context.project = planContext.project; context.project_files = planContext.project_files; context.project_instruction = planContext.project_instruction; }
  if (job.team_role === 'review') {
    const step = db.prepare('SELECT title, question, result FROM ai_office_jobs WHERE id=?').get(meta.reviewOf);
    context.review_of = { title: step.title, brief: step.question, result: String(step.result || '').slice(0, 12000) };
    context.team_instruction = 'Bạn là người KIỂM TRA CHÉO kết quả của một AI khác. Đối chiếu với đề bài và dữ liệu kèm theo (nếu có): số liệu sai, suy luận sai, bỏ sót ý chính, nội dung bịa. Dòng đầu tiên ghi đúng "KẾT LUẬN: ĐẠT" hoặc "KẾT LUẬN: CẦN SỬA". Sau đó liệt kê ngắn các lỗi (nếu có). Chỉ khi CẦN SỬA: thêm mục "## Bản đã sửa" chứa bản hoàn chỉnh đã sửa (giữ ảnh Markdown). Không làm thêm việc ngoài phần được kiểm tra. Tiết kiệm: đối chiếu với dữ liệu kèm theo là chính; chỉ truy vấn DB cho đúng con số đang nghi ngờ (tối đa 5 truy vấn ngắn), không chạy lại toàn bộ phân tích.';
    return context;
  }
  if (job.team_role === 'merge') {
    let budget = 40000;
    const stepIds = meta.steps || meta.deps;
    const parts = stepIds.map(id => {
      const d = db.prepare('SELECT id,title,result,files_json FROM ai_office_jobs WHERE id=?').get(id);
      const review = db.prepare("SELECT result FROM ai_office_jobs WHERE plan_id=? AND team_role='review' AND status='done' AND json_extract(depends_json,'$.reviewOf')=?").get(job.plan_id, id);
      const verdict = review && reviewVerdict(review.result);
      return { ...d, result: verdict?.corrected || d.result, checked: verdict ? (verdict.fix ? `đã sửa sau kiểm tra: ${verdict.notes}` : verdict.ok ? 'đã kiểm tra, đạt' : `ghi chú kiểm tra: ${verdict.notes}`) : null };
    });
    context.parts = parts.map(d => {
      const full = String(d.result || '');
      const text = full.slice(0, Math.max(2000, Math.min(8000, budget)));
      budget -= text.length;
      // A cut answer loses its ending (usually the conclusion): always pass the hand-off summary too.
      return { title: d.title, result: text, check: d.checked || undefined, truncated: text.length < full.length,
        summary: text.length < full.length ? summaryOf(full) : undefined, files: parseJson(d.files_json, null) };
    });
    context.team_instruction = 'Gộp các phần thành MỘT báo cáo cuối dễ đọc cho chủ shop (không phải lập trình viên), ít chữ, chỉ giữ ý chính: mở đầu bằng 2–3 dòng kết luận, sau đó mỗi phần một mục có tiêu đề rõ; bảng khi có số liệu so sánh. Bỏ trùng lặp, giữ số liệu chính xác, nói ngắn chỗ các phần mâu thuẫn hoặc còn thiếu. GIỮ NGUYÊN mọi ảnh Markdown ![..](..) của các phần, đặt ngay cạnh sản phẩm tương ứng. Không làm lại các phần, không nhắc tên model/máy. Nếu có dự án, lưu bản cuối vào ket-qua/.';
  } else {
    context.previous_parts = depJobs.map(d => ({ title: d.title, summary: summaryOf(d.result), files: parseJson(d.files_json, null) }));
    context.team_instruction = `Bạn làm phần ${meta.index}/${meta.total} của một việc lớn; các AI khác làm phần còn lại song song. CHỈ làm đúng phần này, ngắn gọn, đủ chất lượng. Kết thúc câu trả lời bằng mục "${SUMMARY_HEAD}" (≤150 từ: kết quả chính, số liệu, tên tệp) để phần sau dùng.${meta.needsData ? ' Dùng số liệu đã kèm trong ngữ cảnh (rows) trước; chỉ truy vấn thêm DB khi thiếu đúng thông tin cần. Khi nêu sản phẩm cụ thể, chèn ảnh Markdown theo image_instruction (cả trong tóm tắt bàn giao).' : ''}`;
  }
  return context;
}

function tick(db, now = Date.now()) {
  advanceConversations(db);
  for (const plan of db.prepare("SELECT * FROM ai_office_jobs WHERE team_role='plan' AND status='done' AND COALESCE(team_expanded,0)=0 AND cancel_requested=0").all()) {
    try { expandPlan(db, plan); } catch (error) {
      // Never retry a broken plan every tick: mark it and surface the error.
      db.prepare("UPDATE ai_office_jobs SET team_expanded=1, status='error', error=? WHERE id=?")
        .run(`Không chia được kế hoạch: ${String(error.message).slice(0, 300)}`, plan.id);
    }
  }
  autoRetry(db, now);
  for (const job of db.prepare("SELECT * FROM ai_office_jobs WHERE status='waiting' AND plan_id IS NOT NULL ORDER BY created_at").all()) {
    const meta = parseJson(job.depends_json, { deps: [] });
    const deps = meta.deps.map(id => db.prepare('SELECT status, title FROM ai_office_jobs WHERE id=?').get(id) || { status: 'error', title: '?' });
    const failed = deps.find(d => d.status === 'error');
    if (failed) {
      db.prepare("UPDATE ai_office_jobs SET status='error', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(`Phần trước "${failed.title}" bị lỗi — thử lại phần đó để tiếp tục.`, job.id);
      continue;
    }
    if (!deps.every(d => d.status === 'done')) continue;
    const plan = db.prepare('SELECT selection_json FROM ai_office_jobs WHERE id=?').get(job.plan_id);
    const planSelection = parseJson(plan?.selection_json, {});
    const host = planSelection.machineId || 'vps';
    const avoid = job.team_role === 'review' ? db.prepare('SELECT provider FROM ai_office_jobs WHERE id=?').get(meta.reviewOf)?.provider : meta.avoid;
    const choice = assign(db, host, job.difficulty || 'medium', job.question, now, avoid, planSelection.accounts || null);
    if (!choice) continue;
    const context = readyContext(db, job, meta.deps, meta);
    db.prepare(`UPDATE ai_office_jobs SET status='pending', executor=?, provider=?, selection_json=?, context_json=?,
      selection_reason=selection_reason || ' · ' || ? WHERE id=? AND status='waiting'`)
      .run(choice.executor, choice.provider, JSON.stringify({...selectionFor(choice, host, `Độ khó ${job.difficulty}: ${choice.model} · effort ${choice.effort}`, planSelection.accounts || null), ...(planSelection.workspace?{workspace:planSelection.workspace}:{})}),
        JSON.stringify(context), `${choice.model}/${choice.effort}`, job.id);
  }
}

// One automatic retry per failed job, on another provider/account when one is available.
function autoRetry(db, now) {
  const failed = db.prepare(`SELECT * FROM ai_office_jobs WHERE plan_id IS NOT NULL AND status='error'
    AND team_role IN ('plan','step','review','merge') AND COALESCE(error,'') NOT LIKE 'Phần trước %'`).all();
  for (const job of failed) {
    const meta = parseJson(job.depends_json, {}) || {};
    if (meta.autoRetried || /kiểm tra kết quả|chưa xác nhận|uncertain|Worker khởi động lại/i.test(job.error || '') || job.cancel_requested || job.error === STOPPED || job.error === REMOVAL_ERROR) continue;
    const next = { ...meta, autoRetried: true, avoid: job.provider, lastError: String(job.error || '').slice(0, 200) };
    if (job.team_role === 'plan') {
      const planSel = parseJson(job.selection_json, {});
      const host = planSel.machineId || 'vps';
      const choice = assign(db, host, 'planner', job.question, now, job.provider, planSel.accounts || null);
      if (!choice) continue;
      db.prepare(`UPDATE ai_office_jobs SET status='pending', error=NULL, result=NULL, started_at=NULL, finished_at=NULL, team_expanded=0,
        executor=?, provider=?, selection_json=?, depends_json=? WHERE id=? AND status='error'`)
        .run(choice.executor, choice.provider, JSON.stringify(selectionFor(choice, host, `Thử lại lập kế hoạch: ${choice.model} · effort ${choice.effort}`, planSel.accounts || null)), JSON.stringify(next), job.id);
    } else {
      db.prepare("UPDATE ai_office_jobs SET status='waiting', executor='', error=NULL, started_at=NULL, finished_at=NULL, depends_json=? WHERE id=? AND status='error'")
        .run(JSON.stringify(next), job.id);
    }
    db.prepare(`UPDATE ai_office_jobs SET status='waiting', executor='', error=NULL, finished_at=NULL
      WHERE plan_id=? AND status='error' AND error LIKE 'Phần trước %'`).run(job.plan_id);
  }
}

function retry(db, job) {
  if (job.cancel_requested || job.error === STOPPED) throw new Error('Công việc đã dừng; hãy giao yêu cầu mới');
  if (job.error === REMOVAL_ERROR) throw new Error(REMOVAL_ERROR);
  if (job.status !== 'error') throw new Error('Chỉ thử lại phần đang lỗi');
  db.transaction(() => {
    if (job.team_role === 'plan') db.prepare("UPDATE ai_office_jobs SET status='pending', error=NULL, started_at=NULL, finished_at=NULL WHERE id=?").run(job.id);
    else db.prepare("UPDATE ai_office_jobs SET status='waiting', executor='', error=NULL, started_at=NULL, finished_at=NULL WHERE id=?").run(job.id);
    db.prepare(`UPDATE ai_office_jobs SET status='waiting', executor='', error=NULL, finished_at=NULL
      WHERE plan_id=? AND status='error' AND error LIKE 'Phần trước %'`).run(job.plan_id || job.id);
  })();
}

module.exports = { reviewVerdict, PLAN_INSTRUCTION, SUMMARY_HEAD, isComplex, parsePlan, summaryOf, assign, tick, retry, selectionFor };
