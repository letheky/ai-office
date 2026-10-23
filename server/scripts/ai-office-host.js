const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const { driveReady } = require('./ai-office-drive');
const { normalizeTools, normalizeProfile } = require('../src/services/aiOfficeCapabilities');

async function probe(binary, args) {
  try {
    const { stdout } = await exec(binary, args, { timeout: 4000, maxBuffer: 20000 });
    return { available: true, stdout };
  } catch (e) { return { available: e.code !== 'ENOENT', stdout: '' }; }
}
function desktopReady(socketPath) {
  return new Promise(resolve => {
    const connection = net.createConnection(socketPath);
    const finish = ready => { connection.destroy(); resolve(ready); };
    connection.setTimeout(1200, () => finish(false));
    connection.on('error', () => finish(false));
    connection.on('connect', () => connection.end(JSON.stringify({ name: 'desktop_status', arguments: {}, client: 'office-capability-check' }) + '\n'));
    let data = '';
    connection.on('data', chunk => { data += chunk; if (data.length > 20000) finish(false); });
    connection.on('end', () => {
      try { finish(JSON.parse(JSON.parse(data).content[0].text).connected === true); } catch { finish(false); }
    });
  });
}
async function readTools(env = process.env) {
  const bin = name => {
    const local = path.join(os.homedir(), '.local/bin', process.platform === 'win32' ? name + '.exe' : name);
    return fs.existsSync(local) ? local : name;
  };
  const socket = path.join(env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, 'ai-office-computer.sock');
  const [browser, ffmpeg, download, desktop, driveState] = await Promise.all([
    probe(env.AI_OFFICE_BROWSER_BIN || bin('browser-harness'), ['doctor', '--json', '--require-existing-daemon']),
    probe(bin('ffmpeg'), ['-version']), probe(bin('yt-dlp'), ['--version']),
    fs.existsSync(socket) ? desktopReady(socket) : false, driveReady(env),
  ]);
  let health = {};
  try { health = JSON.parse(browser.stdout); } catch {}
  const checkedAt = Date.now();
  const version = output => output.match(/(?:ffmpeg version )?([\w.+-]+)/)?.[1] || null;
  return normalizeTools({
    browser: { available: browser.available, ready: health.healthy === true && process.platform === 'linux' && env.AI_OFFICE_BROWSER_HARNESS === '1',
      enabled: process.platform === 'linux' && env.AI_OFFICE_BROWSER_HARNESS === '1', version: health.version, checkedAt },
    desktop: { available: fs.existsSync(socket), ready: desktop && process.platform === 'linux' && env.AI_OFFICE_COMPUTER_USE === '1',
      enabled: process.platform === 'linux' && env.AI_OFFICE_COMPUTER_USE === '1', checkedAt },
    ffmpeg: { available: ffmpeg.available, ready: !!ffmpeg.stdout, enabled: true, version: version(ffmpeg.stdout), checkedAt },
    drive: { ...driveState, enabled: driveState.available, checkedAt },
    download: { available: download.available, ready: !!download.stdout, enabled: true, version: version(download.stdout), checkedAt },
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
