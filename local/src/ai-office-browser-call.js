// Team-only PATH shim: serialize browser commands, not the enclosing AI turn.
// The daemon has a shared attached tab. Restore this job's tab while holding the
// same lock used by ordinary whole-job sessions; save it before releasing it.
const { spawn } = require('child_process');

function isolatedCode(code, state) {
  return `import json as _office_json\nfrom pathlib import Path as _OfficePath
_office_state = _OfficePath(${JSON.stringify(state)})
if _office_state.exists():
    _office_tab = _office_json.loads(_office_state.read_text())
    if any(t['targetId'] == _office_tab['targetId'] for t in list_tabs()):
        switch_tab(_office_tab['targetId'])
    else:
        new_tab()
else:
    new_tab()
try:
    exec(${JSON.stringify(code)}, globals())
finally:
    try:
        _office_state.write_text(_office_json.dumps(current_tab()))
    except Exception:
        # If the job closed its tab, never adopt another job's current tab.
        _office_state.unlink(missing_ok=True)
`;
}

async function main() {
  const env = process.env;
  const args = process.argv.slice(2);
  let input;
  if (!args.length) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = isolatedCode(Buffer.concat(chunks).toString('utf8'), env.AI_OFFICE_TEAM_BROWSER_STATE);
  }
  const child = spawn('/usr/bin/flock', [env.AI_OFFICE_TEAM_BROWSER_LOCK, env.AI_OFFICE_TEAM_BROWSER_BINARY, ...args],
    { env, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'] });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { isolatedCode };
