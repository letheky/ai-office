const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const root = path.resolve(__dirname, '../data/ai-office-output-images');
const vpsOutputRoot = path.resolve(__dirname, '../../output');
const types = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif' };
const validId = id => /^[a-f0-9-]{36}$/.test(id || '');
const mimeOf = source => types[path.extname(String(source || '')).toLowerCase()] || null;

function imagePaths(result) {
  const paths = [];
  for (const match of String(result || '').matchAll(/!\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g)) {
    const source = match[1].startsWith('<') ? match[1].slice(1, -1) : match[1];
    if (source.length <= 1000 && mimeOf(source) && (path.isAbsolute(source) || path.win32.isAbsolute(source))) paths.push(source);
  }
  return [...new Set(paths)].slice(0, 10);
}

function target(jobId, source) {
  if (!validId(jobId) || !mimeOf(source) || String(source).length > 1000) throw new Error('Đường dẫn ảnh kết quả không hợp lệ');
  const hash = createHash('sha256').update(source).digest('hex');
  return path.join(root, jobId, `${hash}${path.extname(source).toLowerCase()}`);
}

function validImage(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20 * 1024 * 1024) return false;
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/gif') return ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6));
  return bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
}

function save(jobId, source, bytes) {
  const file = target(jobId, source);
  if (!validImage(bytes, mimeOf(source))) throw new Error('Ảnh kết quả không hợp lệ hoặc quá 20 MB');
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 });
  fs.writeFileSync(file, bytes, { mode:0o600 });
  return file;
}

function stored(jobId, source) {
  const file = target(jobId, source);
  return fs.existsSync(file) ? file : null;
}

function vpsSource(source) {
  if (!mimeOf(source) || !path.isAbsolute(source)) return null;
  try {
    const actual = fs.realpathSync(source), safeRoot = fs.realpathSync(vpsOutputRoot);
    if (!actual.startsWith(safeRoot + path.sep)) return null;
    const stat = fs.statSync(actual);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
    if (!validImage(fs.readFileSync(actual), mimeOf(source))) return null;
    return actual;
  } catch { return null; }
}

function removeJob(jobId) {
  if (!validId(jobId)) return;
  fs.rmSync(path.join(root, jobId), { recursive:true, force:true });
}

module.exports = { imagePaths, mimeOf, save, stored, vpsSource, removeJob };
