// Public tool metadata is deliberately small: never persist command output,
// environment variables, browser URLs, sockets or credentials from heartbeats.
const toolIds = ['python', 'node', 'ffmpeg', 'git', 'browser'];
function normalizeTools(value) {
  const result = {};
  for (const id of toolIds) {
    const t = value?.[id];
    if (!t || typeof t !== 'object') continue;
    const checkedAt = Number(t.checkedAt);
    result[id] = { available: t.available === true, ready: t.ready === true && t.available === true,
      enabled: t.enabled === true, checkedAt: Number.isFinite(checkedAt) && checkedAt > 0 && checkedAt <= Date.now() + 60000 ? checkedAt : null,
      version: typeof t.version === 'string' && /^[\w.+ -]{1,60}$/.test(t.version) ? t.version : null };
  }
  return result;
}
function toolsOf(row) {
  try { return normalizeTools(JSON.parse(row.tools_json || '{}')); } catch { return {}; }
}
function normalizeProfile(value) {
  if (!value || typeof value !== 'object') return null;
  const text = (v, max = 120) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : '';
  const number = (v, max) => Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : null;
  const platform = ['linux', 'win32', 'darwin', 'freebsd'].includes(value.platform) ? value.platform : 'unknown';
  return { platform, arch: text(value.arch, 20), cpuModel: text(value.cpuModel),
    logicalCpus: Number.isInteger(value.logicalCpus) ? number(value.logicalCpus, 16384) : null,
    memoryGb: number(value.memoryGb, 1000000),
    gpus: Array.isArray(value.gpus) ? value.gpus.slice(0, 4).map(g => ({ name: text(g?.name), memoryGb: number(g?.memoryGb, 10000) })).filter(g => g.name) : [],
    checkedAt: Number.isFinite(value.checkedAt) && value.checkedAt > 0 && value.checkedAt <= Date.now() + 60000 ? value.checkedAt : null,
    source: 'worker' };
}
function profileOf(row) {
  try { return normalizeProfile(JSON.parse(row.profile_json || 'null')); } catch { return null; }
}
function machinePolicy(id, name) {
  if (id === 'vps') return { label: 'VPS · ưu tiên tác vụ nhẹ', declaredPlatform: null,
    detail: 'Ưu tiên tra cứu dữ liệu, lập kế hoạch, nội dung và tác vụ máy chủ. Chỉ dùng công cụ đã báo sẵn sàng; giao dựng media/model local cho máy trạm phù hợp.' };
  return { label: 'Máy trạm · theo công cụ thực có', declaredPlatform: null,
    detail: 'Phù hợp thao tác trình duyệt, tệp và media khi công cụ tương ứng sẵn sàng. Cấu hình phần cứng chỉ là thông tin tham khảo, chưa phải benchmark tác vụ.' };
}

const catalog = {
  execution: { collaboration: 'auto-team', routing: 'rules', adminScope: 'selected-machine-user', maxJobMinutes: 15 },
  departments: [
    { agent: 'Điều phối', role: 'Điều phối', detail: 'Chọn vai trò, model, effort và tài khoản theo quy tắc + hạn mức; mỗi bước chạy một AI, có thể bàn giao sang máy/model khác.' },
    { agent: 'Nghiên cứu', role: 'Nghiên cứu', detail: 'Tìm và kiểm chứng nguồn, số liệu cho kịch bản; đối chiếu nguồn.' },
    { agent: 'Phân tích', role: 'Phân tích', detail: 'Kiểm phép tính trong kịch bản bằng script kiem_tra (decimal) và đối soát số liệu.' },
    { agent: 'Nội dung', role: 'Nội dung', detail: 'Kịch bản, lời đọc, hook, tiêu đề và mô tả YouTube.' },
    { agent: 'Thiết kế', role: 'Thiết kế', detail: 'Brief ảnh từng shot, bảng nhân vật, thumbnail; tạo ảnh qua Codex image_gen.' },
    { agent: 'Video', role: 'Video', detail: 'Giọng ElevenLabs, timeline, dựng Remotion, loudnorm, phụ đề và QA.' },
    { agent: 'Sản phẩm', role: 'Kênh YouTube', detail: 'Lịch đăng, hẹn giờ, Short, màn hình kết thúc và theo dõi kênh.' },
    { agent: 'Kỹ thuật', role: 'Kỹ thuật & vận hành', detail: 'Script Python/Node, Remotion, lịch tự chạy, kiểm tra và sửa lỗi pipeline.' },
  ],
  features: [
    { id: 'script', title: 'Viết và kiểm kịch bản', admin: true, tools: ['python'],
      detail: 'Kịch bản Markdown theo quy ước repo (## CẢNH N, [ẢNH], [CHỮ], **LỜI ĐỌC:**, [[Út: …]]); mỗi video có scripts/kiem_tra_video_NN.py kiểm phép tính bằng decimal.',
      example: 'Đọc hướng dẫn trong repo video, liệt kê video đang làm dở và kiểm phép tính kịch bản mới nhất bằng script kiem_tra tương ứng. Chưa tạo giọng hay ảnh.' },
    { id: 'voice', title: 'Giọng đọc ElevenLabs', admin: true, tools: ['python', 'ffmpeg'],
      detail: 'tao_giong.py gọi ElevenLabs (eleven_v4, giọng Hung và Ân) lấy mp3 + mốc từng chữ, hậu kỳ atempo 0.9 và khoảng nghỉ. Tốn credit; --chi-hau-ky làm lại không tốn credit. Key nằm trong .env của repo.',
      example: 'Ước tính số ký tự và credit ElevenLabs cho kịch bản video NN, so với credit còn lại. Chưa gọi API.' },
    { id: 'images', title: 'Ảnh theo shot bằng Codex image_gen', admin: true, tools: ['python'],
      detail: 'tao_anh.py tạo ảnh PNG từng shot (~6 giây) qua Codex image_gen trong subscription, bảng nhân vật làm ảnh tham chiếu, ảnh không chứa chữ. Không dùng OpenAI Image API trả phí.',
      example: 'Liệt kê các shot của video NN còn thiếu ảnh hoặc cần làm lại, chưa tạo ảnh.' },
    { id: 'video', title: 'Dựng video bằng Remotion và ffmpeg', admin: true, tools: ['node', 'ffmpeg'],
      detail: 'build-timeline.mjs ra timeline.json + .srt; Remotion render bản dài 1080p, Short 1080×1920 và thumbnail; ffmpeg loudnorm 2 lượt (−16 / −14 LUFS). Remotion nằm trong node_modules của repo.',
      example: 'Kiểm tra repo video đã đủ ảnh và giọng cho video NN chưa, rồi đề xuất lệnh dựng. Chưa render.' },
    { id: 'qa', title: 'QA trước khi đăng', admin: true, tools: ['node', 'ffmpeg'],
      detail: 'audit-shots, verify-shot-frames, test Node/Python, ffmpeg silencedetect; xem still và khung trích từ MP4 cuối.',
      example: 'Chạy QA cho video NN và liệt kê lỗi theo mốc thời gian, chưa sửa.' },
    { id: 'upload', title: 'Đăng YouTube qua Data API', admin: true, tools: ['python'],
      detail: 'upload_youtube.py: OAuth Desktop, hẹn giờ publishAt, thumbnail, phụ đề vi, cờ nội dung tổng hợp, danh mục Giáo dục. Quota 10.000 đơn vị/ngày, đủ khoảng 2 video + 2 Short.',
      example: 'Kiểm tra video NN đã sẵn sàng đăng chưa (MP4, thumbnail, phụ đề, mô tả) và đề xuất giờ hẹn. Chưa đăng.' },
    { id: 'browser', title: 'Brave của kênh qua CDP', admin: true, tools: ['browser'],
      detail: 'browser-harness điều khiển Brave riêng của kênh qua CDP cổng 9333, cho việc API không làm được: màn hình kết thúc, Related video của Short. Brave phải đang mở với cổng debug.',
      example: 'Kiểm tra Brave của kênh đang mở cổng 9333 và đã đăng nhập YouTube Studio, chỉ báo trạng thái, chưa thao tác.' },
    { id: 'files', title: 'Làm việc với tệp và mã nguồn trên máy đã chọn', admin: true, tools: ['git'],
      detail: 'Chạy CLI, đọc/sửa tệp và repo trong quyền user của hệ điều hành. Chọn thư mục repo video ở Máy xử lý; Git quản lý lịch sử.',
      example: 'Đọc hướng dẫn và trạng thái git trong repo video, xác định công việc đang dở trước khi thay đổi.' },
    { id: 'models', title: 'Tự chọn model và tránh tài khoản hết lượt', admin: false, tools: [],
      detail: 'Chọn model/effort theo quy tắc từ khóa; cân nhắc tài khoản online, hạn mức phiên/tuần và số việc. Có thể chọn thủ công. Claude hợp kịch bản và soát; Codex hợp ảnh, dựng, render và QA.',
      example: 'Đề xuất chia việc làm video NN giữa Claude và Codex theo hạn mức hiện tại.' },
    { id: 'conversation', title: 'Hỏi tiếp, bàn giao và xem model thực chạy', admin: false, tools: [],
      detail: 'Giữ ngữ cảnh các lượt trao đổi; bàn giao bước mới sang máy/model khác và xem model/effort khi CLI trả được.',
      example: 'Tóm tắt kết quả bước vừa xong của video NN và nêu bước tiếp theo.' },
  ],
  limits: [
    'Pipeline video chạy trên máy Windows có repo; VPS không có repo, key ElevenLabs hay token YouTube nên chỉ hợp việc nhẹ (soạn thảo, lập kế hoạch).',
    'ElevenLabs tính credit theo ký tự (gói Creator ~131k/tháng); luôn ước tính trước khi tạo giọng. YouTube API giới hạn 10.000 đơn vị quota/ngày.',
    'Việc lớn được chia tối đa 6 phần chạy song song trên các tài khoản của máy đã chọn. Hệ thống dùng quy tắc định tuyến, chưa phải một model riêng lập kế hoạch.',
    'Admin có công cụ thực thi theo đề bài trong quyền user trên máy đã chọn. Nút duyệt kết quả ghi nhận bản nháp; không phải hàng rào chặn mọi lệnh ghi của CLI.',
  ],
  collaboration: { title: 'Một ý tưởng nên phối hợp thế nào?',
    detail: 'Chế độ “Chia việc: Tự động”: việc dễ do một model làm, không tốn lượt lập kế hoạch. Việc lớn: Hệ thống dùng model mạnh lập kế hoạch (chỉ đọc đề bài + tên tệp), chia tối đa 6 phần; phần dễ → model nhẹ/effort thấp, phần khó → model mạnh/effort cao, chạy song song trên các tài khoản rảnh. Phần sau chỉ nhận tóm tắt bàn giao của phần trước; số liệu shop chỉ gửi cho phần cần. Cuối cùng một model gộp thành bản cuối (vào hoan-thien/ nếu có dự án). Phần lỗi bấm “Thử lại phần này”.',
    example: 'Từ ý tưởng sau, lập kế hoạch gồm mục tiêu, dữ liệu cần có, đầu ra từng bước, phòng ban phù hợp và tiêu chí kiểm tra. Chưa thực thi hoặc gọi thêm model. Ý tưởng: …' },
  repositories: [
    { name: 'Remotion', url: 'https://github.com/remotion-dev/remotion', license: 'Remotion License', tool: 'node',
      fit: 'Dựng video bằng React. Miễn phí cho cá nhân và công ty dưới 4 người; nhóm lớn hơn cần mua license công ty.' },
    { name: 'FFmpeg', url: 'https://github.com/FFmpeg/FFmpeg', license: 'LGPL/GPL tùy bản dựng', tool: 'ffmpeg',
      fit: 'Hậu kỳ giọng, loudnorm, silencedetect và trích khung QA.' },
    { name: 'browser-harness', url: 'https://github.com/browser-use/browser-harness', license: 'MIT', tool: 'browser',
      fit: 'Điều khiển Brave của kênh qua CDP cho màn hình kết thúc và Related video của Short.' },
  ],
};
module.exports = { normalizeTools, toolsOf, normalizeProfile, profileOf, machinePolicy, catalog };
