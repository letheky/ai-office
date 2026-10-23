// Worker-side project workspace: download shared Drive files before a job and
// publish ket-qua/ afterwards. A job is reported done only after the upload is
// verified, so the next machine never receives a step whose files are missing.
const fs = require('fs');
const path = require('path');
const drive = require('./ai-office-drive');

async function prepareProject(job, baseDir) {
  let context = {};
  try { context = JSON.parse(job.context_json || '{}'); } catch {}
  if (context.session_command) return null;
  if (!job.project || !job.allow_files) return null;
  if (!/^[a-f0-9-]{36}$/.test(job.project.id) || !/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Dự án không hợp lệ');
  const workspace = path.join(baseDir, 'ai-office-projects', job.project.id, job.id);
  const outputDir = path.join(workspace, 'ket-qua');
  fs.mkdirSync(outputDir, { recursive: true });
  const steps = (job.depIds?.length ? job.depIds : [job.parentId]).filter(id => /^[a-f0-9-]{36}$/.test(id || ''));
  const parentStep = steps.length;
  await drive.downloadForJob(job.project, workspace, steps);
  const images = (Array.isArray(context.attached_images) ? context.attached_images : [])
    .filter(name => typeof name === 'string' && path.basename(name) === name && /\.(jpe?g|png|webp|gif)$/i.test(name))
    .map(name => path.join(workspace, 'dau-vao', name))
    .filter(file => fs.existsSync(file) && fs.statSync(file).size <= 20 * 1024 * 1024);
  return { workspace, outputDir, images, instructions: [
    `Dự án "${job.project.name}" dùng Drive chung. Thư mục làm việc trên máy này: ${workspace}`,
    `Đã tải về: dau-vao/ (tư liệu gốc), ke-hoach/, hoan-thien/${parentStep ? `, buoc-truoc/ (kết quả ${parentStep > 1 ? 'các phần trước, mỗi phần một thư mục con' : 'bước trước'})` : ''}. Kiểm tra tệp thật trước khi dùng.`,
    `Ghi MỌI tệp kết quả của bước này vào ${outputDir} (không ghi đè tệp gốc). Worker sẽ tải ket-qua/ lên Drive sau khi bạn xong; nêu tên tệp trong câu trả lời.`,
  ].join('\n') };
}

async function publishProject(job, prepared) {
  if (!prepared) return null;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await drive.uploadJobOutput(job.project, job.id, prepared.outputDir, process.env, { final: job.teamRole === 'merge' }); }
    catch (error) { lastError = error; await new Promise(r => setTimeout(r, attempt * 5000)); }
  }
  throw new Error(`AI đã xong nhưng tải kết quả lên Drive lỗi (${lastError.message}). Tệp vẫn ở ${prepared.outputDir} trên máy xử lý.`);
}

module.exports = { prepareProject, publishProject };
