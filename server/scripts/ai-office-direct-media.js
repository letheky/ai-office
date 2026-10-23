const fs = require('fs');
const path = require('path');

const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const documentExtensions = { 'text/plain': '.txt', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx' };
function mediaDir(job, baseDir) {
  if (!/^[a-f0-9-]{36}$/.test(job.id || '')) throw new Error('Mã công việc không hợp lệ');
  return path.join(baseDir, 'ai-office-direct-media', job.id);
}

async function prepareMedia(job, baseDir, retrieve, key) {
  let context = {};
  try { context = JSON.parse(job.context_json || '{}'); } catch {}
  if (context.session_command) return [];
  const all = Array.isArray(context[key]) ? context[key] : [];
  if (all.some(item => !extensions[item.mime] && !documentExtensions[item.mime])) throw new Error('Loại tệp không hợp lệ');
  const items = all.filter(item => extensions[item.mime]);
  if (!items.length) return [];
  if (items.length > 10 || items.some(item => !/^[a-f0-9-]{36}$/.test(item.id || '') || !extensions[item.mime]))
    throw new Error('Danh sách ảnh trực tiếp không hợp lệ');
  const dir = mediaDir(job, baseDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const images = [];
  for (const item of items) {
    const bytes = await retrieve(item.id);
    if (!Buffer.isBuffer(bytes) || bytes.length > 20 * 1024 * 1024) throw new Error('Ảnh trực tiếp không hợp lệ hoặc quá 20 MB');
    const target = path.join(dir, `${item.id}${extensions[item.mime]}`);
    fs.writeFileSync(target, bytes, { mode: 0o600 });
    images.push(target);
  }
  return images;
}

const prepareDirectMedia = (job, baseDir, retrieve) => prepareMedia(job, baseDir, retrieve, 'direct_media');
const preparePreviousMedia = (job, baseDir, retrieve) => prepareMedia(job, baseDir, retrieve, 'previous_media');

async function prepareDocuments(job, baseDir, retrieve) {
  const context = JSON.parse(job.context_json || '{}');
  if (context.session_command) return [];
  const items = [...(context.direct_media || []), ...(context.previous_documents || [])].filter(item => documentExtensions[item.mime]);
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  if (!unique.length) return [];
  const dir = mediaDir(job, baseDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const documents = [];
  for (const item of unique) {
    if (!/^[a-f0-9-]{36}$/.test(item.id || '')) throw new Error('Mã tệp không hợp lệ');
    const file = path.join(dir, `${item.id}${documentExtensions[item.mime]}`);
    const text = path.join(dir, `${item.id}.content.txt`);
    for (const [target, extracted] of [[file, false], [text, true]]) {
      const bytes = await retrieve(item.id, extracted);
      if (!Buffer.isBuffer(bytes) || bytes.length > 20 * 1024 * 1024) throw new Error('Tệp không hợp lệ hoặc quá 20 MB');
      fs.writeFileSync(target, bytes, { mode: 0o600 });
    }
    documents.push({ name: item.name, file, text });
  }
  return documents;
}

function cleanupDirectMedia(job, baseDir) {
  const dir = mediaDir(job, baseDir);
  const root = path.resolve(baseDir, 'ai-office-direct-media');
  if (path.dirname(dir) !== root) throw new Error('Đường dẫn ảnh tạm không hợp lệ');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { prepareDirectMedia, preparePreviousMedia, prepareDocuments, cleanupDirectMedia };
