// AI Office model catalogue. The list is no longer hard-coded: workers report the
// models their CLI really offers (Codex models_cache.json; Claude: GET /v1/models of the subscription), the
// admin enables models, caps effort per model and chooses which model serves each
// difficulty tier. Workers only re-validate syntax (they have no DB access).
const { plain } = require('./aiOfficeRouting');

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BUILTIN = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', provider: 'claude', efforts: CLAUDE_EFFORTS },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'claude', efforts: CLAUDE_EFFORTS },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'claude', efforts: CLAUDE_EFFORTS },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'claude', efforts: CLAUDE_EFFORTS },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', provider: 'claude', efforts: CLAUDE_EFFORTS, off: true },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'codex', efforts: EFFORTS.slice(0, 5) },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', provider: 'codex', efforts: EFFORTS },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', provider: 'codex', efforts: EFFORTS },
];
const TIER_NAMES = ['easy', 'medium', 'hard', 'planner'];
const DEFAULT_TIERS = {
  easy: { claude: { model: 'claude-haiku-5-5', effort: 'low' }, codex: { model: 'gpt-6-luna', effort: 'low' } },
  medium: { claude: { model: 'claude-sonnet-5-5', effort: 'medium' }, codex: { model: 'gpt-6.1-sol', effort: 'medium' } },
  hard: { claude: { model: 'claude-opus-5-5', effort: 'high' }, codex: { model: 'gpt-6.1-sol', effort: 'high' } },
  planner: { claude: { model: 'claude-opus-5-5', effort: 'medium' }, codex: { model: 'gpt-6.1-sol', effort: 'medium' } },
};
const SETTING = 'ai_office_model_config';
const validId = id => /^[a-z0-9][a-z0-9.-]{1,60}$/i.test(id || '');
const providerOf = id => /^claude-/.test(id) ? 'claude' : 'codex';
const rank = effort => EFFORTS.indexOf(effort);

function normalizeReported(value) {
  const out = {};
  for (const provider of ['claude', 'codex']) {
    const list = Array.isArray(value?.[provider]) ? value[provider] : [];
    out[provider] = list.slice(0, 40).flatMap(m => validId(m?.id) && providerOf(m.id) === provider ? [{ id: m.id,
      label: String(m.label || m.id).replace(/[\x00-\x1f]/g, '').slice(0, 60),
      efforts: (Array.isArray(m.efforts) ? m.efforts : []).filter(e => EFFORTS.includes(e)) }] : []);
  }
  return out;
}

function readSaved(db) {
  try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get(SETTING)?.value || '{}'); } catch { return {}; }
}
function reportedModels(db) {
  const rows = [];
  try { rows.push(...db.prepare("SELECT models_json FROM ai_office_machines WHERE models_json IS NOT NULL").all()); } catch {}
  try { rows.push(...db.prepare("SELECT models_json FROM ai_office_worker_heartbeat WHERE models_json IS NOT NULL").all()); } catch {}
  const merged = new Map();
  for (const row of rows) {
    let parsed; try { parsed = normalizeReported(JSON.parse(row.models_json)); } catch { continue; }
    for (const m of [...parsed.claude, ...parsed.codex]) {
      const prev = merged.get(m.id);
      merged.set(m.id, prev ? { ...prev, efforts: [...new Set([...prev.efforts, ...m.efforts])] } : m);
    }
  }
  return merged;
}

// Full effective configuration; `db` defaults to the app DB (server side only).
function modelConfig(db = require('../db/database').getDb()) {
  const saved = readSaved(db);
  const byId = new Map(BUILTIN.map(m => [m.id, { ...m, source: 'builtin' }]));
  for (const [id, m] of reportedModels(db)) {
    const base = byId.get(id);
    byId.set(id, { ...(base || { off: true }), id, provider: providerOf(id), label: base?.label || m.label,
      efforts: m.efforts.length ? EFFORTS.filter(e => m.efforts.includes(e)) : base?.efforts || ['low', 'medium', 'high'], source: 'worker' });
  }
  for (const c of Array.isArray(saved.custom) ? saved.custom : []) if (validId(c.id) && !byId.has(c.id))
    byId.set(c.id, { id: c.id, provider: providerOf(c.id), label: String(c.label || c.id).slice(0, 60),
      efforts: (c.efforts || CLAUDE_EFFORTS).filter(e => EFFORTS.includes(e)), source: 'custom' });
  const enabled = saved.enabled || {};
  const maxEffort = saved.maxEffort || {};
  const models = [...byId.values()].map(m => {
    const cap = EFFORTS.includes(maxEffort[m.id]) ? maxEffort[m.id] : m.efforts.at(-1);
    return { id: m.id, label: m.label, provider: m.provider, source: m.source, supported: m.efforts,
      maxEffort: cap, efforts: m.efforts.filter(e => rank(e) <= rank(cap)), enabled: enabled[m.id] ?? !m.off };
  });
  const tiers = {};
  for (const tier of TIER_NAMES) {
    tiers[tier] = {};
    for (const provider of ['claude', 'codex']) tiers[tier][provider] = resolveTier(models, saved.tiers?.[tier]?.[provider] || DEFAULT_TIERS[tier][provider], provider, tier);
  }
  return { models, tiers, efforts: EFFORTS };
}
// A tier always resolves to an enabled model of that provider, with effort clamped to its cap.
function resolveTier(models, wanted, provider, tier) {
  const usable = models.filter(m => m.enabled && m.provider === provider);
  const model = usable.find(m => m.id === wanted?.model) || usable.find(m => m.id === DEFAULT_TIERS[tier][provider].model) || usable[0];
  if (!model) return null;
  const effort = model.efforts.includes(wanted?.effort) ? wanted.effort
    : model.efforts.filter(e => rank(e) <= rank(wanted?.effort || 'medium')).at(-1) || model.efforts[0];
  return { model: model.id, effort };
}

function saveModelConfig(db, input) {
  const current = modelConfig(db);
  const known = new Map(current.models.map(m => [m.id, m]));
  const custom = (Array.isArray(input?.custom) ? input.custom : []).slice(0, 20).map(c => {
    if (!validId(c?.id)) throw new Error(`Mã model không hợp lệ: ${String(c?.id || '').slice(0, 40)}`);
    const efforts = (Array.isArray(c.efforts) && c.efforts.length ? c.efforts : providerOf(c.id) === 'claude' ? CLAUDE_EFFORTS : EFFORTS.slice(0, 5)).filter(e => EFFORTS.includes(e));
    known.set(c.id, known.get(c.id) || { id: c.id, provider: providerOf(c.id), supported: efforts });
    return { id: c.id, label: String(c.label || c.id).slice(0, 60), efforts };
  });
  const enabled = {}, maxEffort = {};
  for (const [id, on] of Object.entries(input?.enabled || {})) if (known.has(id)) enabled[id] = on === true;
  for (const [id, effort] of Object.entries(input?.maxEffort || {})) {
    if (!known.has(id)) continue;
    if (!known.get(id).supported.includes(effort)) throw new Error(`${id} không hỗ trợ effort ${effort}`);
    maxEffort[id] = effort;
  }
  const tiers = {};
  for (const tier of TIER_NAMES) for (const provider of ['claude', 'codex']) {
    const t = input?.tiers?.[tier]?.[provider];
    if (!t) continue;
    if (!known.has(t.model) || known.get(t.model).provider !== provider) throw new Error(`Model ${t.model} không dùng được cho ${provider}`);
    if (!EFFORTS.includes(t.effort)) throw new Error('Effort không hợp lệ');
    (tiers[tier] ||= {})[provider] = { model: t.model, effort: t.effort };
  }
  const value = JSON.stringify({ custom, enabled, maxEffort, tiers });
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(SETTING, value);
  const result = modelConfig(db);
  if (!['claude', 'codex'].some(p => result.models.some(m => m.enabled && m.provider === p))) throw new Error('Cần bật ít nhất một model');
  return result;
}

function tierChoice(tier, provider, cfg = modelConfig()) { return cfg.tiers[tier]?.[provider] || null; }
function restrictModels(cfg, availableIds) {
  if (!availableIds?.size) return cfg;
  const models = cfg.models.filter(model => availableIds.has(model.id));
  const tiers = {};
  for (const tier of TIER_NAMES) {
    tiers[tier] = {};
    for (const provider of ['claude', 'codex']) tiers[tier][provider] = resolveTier(models, cfg.tiers[tier]?.[provider], provider, tier);
  }
  return { ...cfg, models, tiers };
}

function selectModel(question, provider, requestedModel = 'auto', requestedEffort = 'auto', cfg = modelConfig()) {
  const manual = requestedModel !== 'auto' ? cfg.models.find(m => m.id === requestedModel && m.enabled) : null;
  if (requestedModel !== 'auto' && !manual) throw new Error('Model không hợp lệ hoặc đang tắt');
  if (requestedEffort !== 'auto' && !EFFORTS.includes(requestedEffort)) throw new Error('Effort không hợp lệ');
  const q = plain(question);
  const hard = /doi soat|tru trung|lech ton|tim loi|sua loi|debug|refactor|bao mat|phuc tap|nguyen nhan|loi code/.test(q) || (/kho|ton/.test(q) && /lech|tru trung|that bai/.test(q));
  const analytical = hard || /loi nhuan|lai du kien|tinh lai|tien ve vi|so sanh|phan tich|gia von|nhieu shop|cac shop|tong cac|doanh thu va lai|lap ke hoach|len ke hoach|danh gia|kien truc|y tuong|phoi hop|chon loc.*(repo|ma nguon)/.test(q);
  const tier = hard ? 'hard' : analytical ? 'medium' : 'easy';
  const actualProvider = manual?.provider || provider;
  let chosen = manual ? { model: manual.id, effort: manual.efforts.includes('medium') ? 'medium' : manual.efforts.at(-1) } : tierChoice(tier, actualProvider, cfg);
  if (!chosen) throw new Error(`Chưa bật model nào cho ${actualProvider === 'codex' ? 'ChatGPT' : 'Claude'}`);
  const model = cfg.models.find(m => m.id === chosen.model);
  let effort = requestedEffort === 'auto' ? (manual ? chosen.effort : chosen.effort) : requestedEffort;
  if (!model.efforts.includes(effort)) {
    if (requestedEffort !== 'auto' && manual) throw new Error(`Effort ${effort} vượt mức cho phép của ${model.label} (tối đa ${model.maxEffort})`);
    // Auto model: the tier may land on a model with a lower cap than the carried effort; clamp instead of failing.
    const rank = EFFORTS.indexOf(effort);
    effort = model.efforts.filter(level => EFFORTS.indexOf(level) <= rank).at(-1) || model.efforts[0];
  }
  return { model: model.id, effort, provider: actualProvider, requestedModel, requestedEffort, tier,
    reason: `${manual ? 'Bạn chọn model' : hard ? 'Hệ thống chọn mức Khó (đối soát / xử lý lỗi)' : analytical ? 'Hệ thống chọn mức Vừa (phân tích / lập kế hoạch)' : 'Hệ thống chọn mức Dễ (tra cứu / nội dung ngắn)'}; ${requestedEffort === 'auto' ? 'Hệ thống chọn effort' : 'bạn chọn effort'} ${effort}` };
}
function selectionOf(job) {
  try {
    const selected=JSON.parse(job.selection_json || 'null');
    if(!selected)return null;
    if(job.status==='done'){
      const settings=JSON.parse(job.execution_json||'null')?.sessionSettings;
      if(['plan','default'].includes(settings?.collaborationMode))selected.collaborationMode=settings.collaborationMode;
      if(settings&&(settings.serviceTier==='fast'||settings.serviceTier===null))selected.serviceTier=settings.serviceTier;
    }
    return selected;
  } catch { return null; }
}
// Worker-side: validated syntactically, the server already checked it against the admin config.
function cliModelArgs(job) {
  const s = selectionOf(job);
  if (!s) return [];
  if (!validId(s.model) || !EFFORTS.includes(s.effort)) throw new Error('Model/effort không hợp lệ');
  if (providerOf(s.model) !== job.provider) throw new Error('Model không thuộc AI đã chọn');
  return job.provider === 'codex' ? ['--model', s.model, '-c', `model_reasoning_effort="${s.effort}"`]
    : ['--model', s.model, '--effort', s.effort];
}
// Claude: the subscription's own model list (GET /v1/models with the CLI OAuth
// token — a metadata call, no tokens consumed). Keeps the 2 newest models per line.
async function discoverClaude(env = process.env) {
  const fs = require('fs'), path = require('path'), os = require('os');
  const file = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
  const token = JSON.parse(fs.readFileSync(file, 'utf8')).claudeAiOauth?.accessToken;
  if (!token) throw new Error('no token');
  const response = await fetch('https://api.anthropic.com/v1/models?limit=100', { signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', 'User-Agent': 'claude-code' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const perLine = {};
  return ((await response.json()).data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .filter(m => m.capabilities?.effort?.supported && (perLine[m.line] = (perLine[m.line] || 0) + 1) <= 2)
    .map(m => ({ id: m.id, label: m.display_name, efforts: EFFORTS.filter(e => m.capabilities.effort[e]?.supported) }));
}
// Worker-side discovery of the models the local CLIs offer.
async function discoverModels(env = process.env, providers = ['claude', 'codex']) {
  const fs = require('fs'), path = require('path'), os = require('os');
  const result = { claude: BUILTIN.filter(m => m.provider === 'claude').map(({ id, label, efforts }) => ({ id, label, efforts })), codex: [] };
  if (providers.includes('claude')) {
    try { const live = await discoverClaude(env); if (live.length) result.claude = live; } catch {}
  }
  if (providers.includes('codex')) try {
    const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const cache = JSON.parse(fs.readFileSync(path.join(home, 'models_cache.json'), 'utf8'));
    result.codex = (cache.models || []).filter(m => m.visibility === 'list' && validId(m.slug)).map(m => ({ id: m.slug,
      label: m.display_name || m.slug, efforts: (m.supported_reasoning_levels || []).map(e => e?.effort || e).filter(e => EFFORTS.includes(e)) }));
  } catch {}
  const normalized = normalizeReported(result);
  return Object.fromEntries(providers.map(provider => [provider, normalized[provider] || []]));
}
module.exports = { EFFORTS, TIER_NAMES, modelConfig, restrictModels, saveModelConfig, tierChoice, selectModel, selectionOf, cliModelArgs, discoverModels, normalizeReported };
