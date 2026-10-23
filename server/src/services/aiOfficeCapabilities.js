// Public tool metadata is deliberately small: never persist command output,
// environment variables, browser URLs, sockets or credentials from heartbeats.
const toolIds = ['browser', 'desktop', 'ffmpeg', 'download', 'drive'];
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
    { agent: 'Nghiên cứu', role: 'Nghiên cứu', detail: 'Tìm nguồn, đối thủ, thị trường và repository; đối chiếu nguồn.' },
    { agent: 'Phân tích', role: 'Phân tích', detail: 'Doanh thu, lợi nhuận, giá vốn, dòng tiền và đối soát số liệu.' },
    { agent: 'Nội dung', role: 'Nội dung', detail: 'Bài viết, hook, mô tả sản phẩm và lời thoại.' },
    { agent: 'Thiết kế', role: 'Thiết kế', detail: 'Bố cục, brief hình ảnh, HTML/SVG; chưa nối model tạo ảnh riêng.' },
    { agent: 'Video', role: 'Video', detail: 'Kịch bản, dựng/cắt/ghép video, âm thanh và phụ đề có sẵn.' },
    { agent: 'Sản phẩm', role: 'Kinh doanh & sản phẩm', detail: 'Sản phẩm, SKU, tồn kho, giá bán và chiến dịch.' },
    { agent: 'Kỹ thuật', role: 'Kỹ thuật & vận hành', detail: 'Đọc/sửa mã, script, tệp, tự động hóa và kiểm tra kết quả.' },
  ],
  features: [
    { id: 'business', title: 'Phân tích dữ liệu bạn cung cấp', admin: false, tools: [],
      detail: 'Phân tích tệp và dữ liệu người dùng cung cấp. Không kết nối dữ liệu ShopWatch.',
      example: 'Phân tích doanh thu và lãi các shop 7 ngày gần nhất, chỉ rõ số liệu thiếu và đề xuất 3 việc ưu tiên.' },
    { id: 'models', title: 'Tự chọn model và tránh tài khoản hết lượt', admin: false, tools: [],
      detail: 'Chọn model/effort theo quy tắc từ khóa; cân nhắc tài khoản online, hạn mức phiên/tuần và số việc. Có thể chọn thủ công.',
      example: 'Đánh giá tồn kho và đề xuất các sản phẩm cần ưu tiên xử lý hôm nay.' },
    { id: 'files', title: 'Làm việc với tệp và mã nguồn trên máy đã chọn', admin: true, tools: [],
      detail: 'Chạy CLI, đọc/sửa tệp và dự án trong quyền user của hệ điều hành. máy trạm và VPS là hai máy khác nhau; không tự có quyền root.',
      example: 'Đọc hướng dẫn và báo cáo tiến độ trong /path/to/your/project, xác định công việc đang dở trước khi thay đổi.' },
    { id: 'browser', title: 'Dùng Chrome thật qua browser-harness', admin: true, tools: ['browser'],
      detail: 'Tìm kiếm, đọc trang, nhập liệu và tải tệp trên phiên Chrome đã được cấp quyền. Dùng chung một khóa giữa các tài khoản.',
      example: 'Dùng browser-harness tìm 3 nguồn video phù hợp cho sản phẩm shop, đưa link và lý do chọn để tôi xem trước.' },
    { id: 'desktop', title: 'Điều khiển màn hình máy', admin: true, tools: ['desktop'],
      detail: 'Chụp ảnh, chuột và bàn phím qua phiên chia sẻ và adapter desktop của máy đã được cho phép. Máy cần mở khóa; không điều khiển điện thoại của bạn.',
      example: 'Dùng computer use kiểm tra màn hình hiện tại trên máy trạm, chỉ báo ứng dụng đang mở, chưa thao tác thay đổi.' },
    { id: 'download', title: 'Tải video và âm thanh bằng yt-dlp', admin: true, tools: ['download'],
      detail: 'Tải từ URL được hỗ trợ; tùy website có thể cần phiên đăng nhập. Không bảo đảm mọi link Douyin đều tải được.',
      example: 'Kiểm tra các định dạng và phụ đề có sẵn của URL video tôi cung cấp trước khi tải.' },
    { id: 'video', title: 'Dựng video, ghép âm thanh và chèn chữ', admin: true, tools: ['ffmpeg'],
      detail: 'FFmpeg cắt/ghép, đổi khung hình, trộn nhạc, chèn chữ/phụ đề từ tệp thật. Tạo giọng đọc AI và nhận dạng lời nói chưa được cấu hình.',
      example: 'Kiểm tra các tệp trong /run/media/pc/17fc3b80-ed6c-48ca-955d-6b26de4e2b4b/video rồi đề xuất cách tiếp tục video đang dở bằng FFmpeg.' },
    { id: 'drive', title: 'Tệp dự án trên Google Drive chung', admin: true, tools: ['drive'],
      detail: 'Mỗi dự án có thư mục Drive: dau-vao, ke-hoach, buoc/<mã việc>, hoan-thien. Máy nhận việc tải tệp cần thiết về, AI ghi ket-qua/, worker tải lên và kiểm tra rồi mới báo xong. Chỉ copy, không xóa tệp ở Drive.',
      example: 'Trong dự án này, đọc tư liệu ở dau-vao/ và lập kế hoạch dựng video 30 giây; lưu kế hoạch thành tệp trong ket-qua/.' },
    { id: 'conversation', title: 'Hỏi tiếp, bàn giao và xem model thực chạy', admin: false, tools: [],
      detail: 'Giữ ngữ cảnh các lượt trao đổi; bàn giao bước mới sang máy/model khác và xem nguồn số liệu, model/effort khi CLI trả được. Tệp chỉ chuyển qua Drive khi công việc thuộc một dự án.',
      example: 'So sánh kết quả vừa có với kỳ trước, giải thích nguyên nhân và nêu nguồn kiểm tra.' },
  ],
  limits: [
    'Việc lớn được chia tối đa 6 phần chạy song song trên các tài khoản của máy đã chọn; VPS chỉ có một worker nên các phần chạy lần lượt. Việc dễ luôn do một model làm.',
    'Hệ thống dùng quy tắc định tuyến, chưa phải một model riêng lập kế hoạch. Danh sách model là danh sách cấu hình, không tự cập nhật.',
    'Admin có công cụ thực thi theo đề bài trong quyền user trên máy đã chọn. Quyền hệ điều hành/Chrome, trạng thái máy, hạn mức và thời gian chạy vẫn giới hạn công việc.',
    'Chưa tích hợp plugin desktop, model tạo ảnh, TTS hay nhận dạng giọng nói. Nút duyệt kết quả ghi nhận bản nháp; không phải hàng rào chặn mọi lệnh ghi của CLI.',
  ],
  collaboration: { title: 'Một ý tưởng nên phối hợp thế nào?',
    detail: 'Chế độ “Chia việc: Tự động”: việc dễ do một model làm, không tốn lượt lập kế hoạch. Việc lớn: Hệ thống dùng model mạnh lập kế hoạch (chỉ đọc đề bài + tên tệp), chia tối đa 6 phần; phần dễ → model nhẹ/effort thấp, phần khó → model mạnh/effort cao, chạy song song trên các tài khoản rảnh. Phần sau chỉ nhận tóm tắt bàn giao của phần trước; số liệu shop chỉ gửi cho phần cần. Cuối cùng một model gộp thành bản cuối (vào hoan-thien/ nếu có dự án). Phần lỗi bấm “Thử lại phần này”.',
    example: 'Từ ý tưởng sau, lập kế hoạch gồm mục tiêu, dữ liệu cần có, đầu ra từng bước, phòng ban phù hợp và tiêu chí kiểm tra. Chưa thực thi hoặc gọi thêm model. Ý tưởng: …' },
  repositories: [
    { name: 'browser-harness', url: 'https://github.com/browser-use/browser-harness', license: 'MIT', tool: 'browser',
      fit: 'Điều khiển Chrome đã đăng nhập bằng CLI; đã tích hợp vào worker.' },
    { name: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp', license: 'Unlicense', tool: 'download',
      fit: 'Tải media bằng CLI; dùng ngay với URL được website hỗ trợ.' },
    { name: 'FFmpeg', url: 'https://github.com/FFmpeg/FFmpeg', license: 'LGPL/GPL tùy bản dựng', tool: 'ffmpeg',
      fit: 'Dựng và ghép âm thanh/video bằng CLI. Local dùng binary từ imageio-ffmpeg, không cần root.' },
    { name: 'VieNeu-TTS', url: 'https://github.com/pnnbao97/VieNeu-TTS', license: 'Apache-2.0 (v3 Turbo)', tool: null,
      fit: 'Ưu tiên tiếp theo: giọng đọc Việt local qua SDK. Chưa cài hoặc tải model; v4 là dịch vụ riêng.' },
    { name: 'faster-whisper', url: 'https://github.com/SYSTRAN/faster-whisper', license: 'MIT', tool: null,
      fit: 'Ưu tiên tiếp theo: chép lời và mốc thời gian để làm phụ đề; cần tải model, đo CPU/GPU. Chưa tích hợp.' },
    { name: 'LangGraph', url: 'https://github.com/langchain-ai/langgraph', license: 'MIT', tool: null,
      fit: 'Tham khảo workflow có trạng thái/checkpoint. Cần adapter cho CLI subscription hiện tại; chưa thay hàng đợi đang chạy.' },
    { name: 'Conductor', url: 'https://github.com/microsoft/conductor', license: 'MIT', tool: null,
      fit: 'Tham khảo chuỗi YAML có điều kiện và giới hạn vòng lặp. Không mặc định tương thích hai Codex CLI; chưa cài.' },
  ],
};
module.exports = { normalizeTools, toolsOf, normalizeProfile, profileOf, machinePolicy, catalog };
