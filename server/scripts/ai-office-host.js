const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const { normalizeTools, normalizeProfile } = require('../src/services/aiOfficeCapabilities');

async function probe(binary, args) {
  try {
    const { stdout } = await exec(binary, args, { timeout: 4000, maxBuffer: 20000 });
    return { available: true, stdout };
  } catch (e) { return { available: e.code !== 'ENOENT', stdout: '' }; }
}
// Tools for the YouTube video stack: Python scripts, Node/Remotion, ffmpeg, Git and the channel's Brave over CDP.
function cdpVersion(port) {
  return new Promise(resolve => {
    const request = require('http').get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1500 }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; if (data.length > 20000) request.destroy(); });
      response.on('end', () => { try { resolve(JSON.parse(data).Browser || 'CDP'); } catch { resolve(null); } });
    });
    request.on('timeout', () => request.destroy()); request.on('error', () => resolve(null));
  });
}
async function readTools(env = process.env) {
  const bin = name => {
    const local = path.join(os.homedir(), '.local/bin', process.platform === 'win32' ? name + '.exe' : name);
    return fs.existsSync(local) ? local : name;
  };
  const windows = process.platform === 'win32';
  const pythonProbe = async () => {
    // The Windows Store "python" alias exists but prints nothing, so prefer the py launcher there.
    for (const [binary, args] of windows ? [['py', ['-3', '--version']], ['python', ['--version']]] : [['python3', ['--version']], ['python', ['--version']]]) {
      const result = await probe(binary, args); if (result.stdout) return result;
    }
    return probe(windows ? 'python' : 'python3', ['--version']);
  };
  const cdpPort = Number(env.AI_OFFICE_CDP_PORT || 9333);
  const [ffmpeg, python, git, cdp] = await Promise.all([
    probe(bin('ffmpeg'), ['-version']), pythonProbe(), probe('git', ['--version']), cdpVersion(cdpPort),
  ]);
  const checkedAt = Date.now();
  const version = output => output.match(/(?:ffmpeg version |Python |git version )?([\w.+-]+)/)?.[1] || null;
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  return normalizeTools({
    python: { available: python.available, ready: !!python.stdout, enabled: true, version: version(python.stdout), checkedAt },
    node: { available: true, ready: nodeMajor >= 22, enabled: true, version: process.versions.node, checkedAt },
    ffmpeg: { available: ffmpeg.available, ready: !!ffmpeg.stdout, enabled: true, version: version(ffmpeg.stdout), checkedAt },
    git: { available: git.available, ready: !!git.stdout, enabled: true, version: version(git.stdout), checkedAt },
    browser: { available: !!cdp, ready: !!cdp, enabled: true, version: cdp ? String(cdp).replace(/[^\w.+ -]/g, ' ').slice(0, 60) : null, checkedAt },
  });
}
async function readProfile() {
  let gpus = [];
  try {
    const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, maxBuffer: 12000 });
    gpus = stdout.trim().split('\n').slice(0, 4).map(line => {
      const split = line.lastIndexOf(',');
      return { name: line.slice(0, split).trim(), memoryGb: Number(line.slice(split + 1).trim()) / 1024 };
    });
  } catch {}
  return normalizeProfile({ platform: process.platform, arch: process.arch,
    cpuModel: os.cpus()[0]?.model || '', logicalCpus: os.cpus().length,
    memoryGb: os.totalmem() / (1024 ** 3), gpus, checkedAt: Date.now() });
}
module.exports = { readTools, readProfile };
