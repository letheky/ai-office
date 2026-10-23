// Execution metadata comes from CLI output/session records, never from the AI's prose.
const fs = require('fs');
const path = require('path');
const os = require('os');
const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, 100) : null;
const count = value => Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
// usage: input = every input token the model read (cached included), cached = part served
// from prompt cache (cheaper on quota), output = generated tokens (reasoning included).
function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const usage = { input: count(u.input), cached: count(u.cached), output: count(u.output) };
  return usage.input == null && usage.output == null ? null : usage;
}
function normalizeContext(value) {
  if (!value || !['measured','compacting','awaiting','unknown'].includes(value.state)) return null;
  const measuredAt=count(value.measuredAt);
  if (!measuredAt) return null;
  return {state:value.state,used:value.state==='measured'?count(value.used):null,
    limit:value.state==='measured'&&count(value.limit)>0?count(value.limit):null,measuredAt};
}
function normalizeExecution(value) {
  const result={ model: clean(value?.model), effort: clean(value?.effort), usage: normalizeUsage(value?.usage) };
  const context=normalizeContext(value?.context);if(context)result.context=context;
  if(value?.sessionSettings){
    const settings={};
    if(['plan','default'].includes(value.sessionSettings.collaborationMode))settings.collaborationMode=value.sessionSettings.collaborationMode;
    if(value.sessionSettings.serviceTier===null||value.sessionSettings.serviceTier==='fast')settings.serviceTier=value.sessionSettings.serviceTier;
    if(Object.keys(settings).length)result.sessionSettings=settings;
  }
  return result;
}
function claudeExecution(response, cwd, home = os.homedir()) {
  const models = Object.keys(response.modelUsage || {});
  const u = response.usage || {};
  const metadata = { model: models.join(', ') || null, effort: null,
    usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 } };
  if (!response.usage) metadata.usage = null;
  const id = response.session_id;
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) return normalizeExecution(metadata);
  try {
    const project = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const lines = fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects', project, `${id}.jsonl`), 'utf8').split('\n');
    const turns = lines.flatMap(line => { try { const row = JSON.parse(line); return row.type === 'assistant' ? [row] : []; } catch { return []; } });
    if (turns.length) {
      metadata.model = [...new Set(turns.map(row => row.message?.model).filter(Boolean))].join(', ') || metadata.model;
      const efforts = [...new Set(turns.map(row => row.perTurnEffort || row.effort).filter(Boolean))];
      metadata.effort = efforts.join(', ') || null;
    }
  } catch { /* Older CLI versions may not retain transcripts. Do not guess effort. */ }
  return normalizeExecution(metadata);
}
// `codex exec --json` prints JSONL events; turn.completed carries token usage. The run
// uses the -m / model_reasoning_effort we passed, which the CLI accepted (exit 0).
function codexExecution(stderr, stdout = '', args = []) {
  const usage = { input: 0, cached: 0, output: 0 };
  let turns = 0;
  for (const line of String(stdout).split('\n')) {
    if (!line.includes('turn.completed')) continue;
    try {
      const u = JSON.parse(line).usage || {};
      usage.input += u.input_tokens || 0; usage.cached += u.cached_input_tokens || 0; usage.output += u.output_tokens || 0; turns++;
    } catch {}
  }
  const arg = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const effortArg = args.find(a => /^model_reasoning_effort=/.test(a))?.match(/"?([a-z]+)"?$/)?.[1];
  return normalizeExecution({ model: String(stderr).match(/^model:\s*(\S+)/mi)?.[1] || arg('--model') || arg('-m'),
    effort: String(stderr).match(/^reasoning effort:\s*(\S+)/mi)?.[1] || effortArg || null, usage: turns ? usage : null });
}
module.exports = { normalizeExecution, normalizeContext, claudeExecution, codexExecution };
