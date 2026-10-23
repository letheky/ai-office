// Generated from server/src/lib/aiOfficeCommands.json; run server/scripts/generate-ai-office-commands.js
export const COMMANDS = [
  {
    "name": "help",
    "description": "Xem toàn bộ lệnh và khả năng hỗ trợ",
    "handler": "local"
  },
  {
    "name": "status",
    "description": "Xem trạng thái, máy, model và token đã đo",
    "handler": "status"
  },
  {
    "name": "compact",
    "description": "Nén ngữ cảnh phiên Codex/Claude gốc",
    "handler": "native"
  },
  {
    "name": "new",
    "description": "Mở chat mới",
    "handler": "local"
  },
  {
    "name": "clear",
    "description": "Mở chat mới, giữ lịch sử cũ",
    "handler": "local"
  },
  {
    "name": "copy",
    "description": "Sao chép câu trả lời hoàn tất gần nhất",
    "handler": "ui"
  },
  {
    "name": "export",
    "description": "Tải hội thoại xuống file Markdown",
    "handler": "ui",
    "args": true
  },
  {
    "name": "rename",
    "description": "Đổi tên cuộc trò chuyện",
    "handler": "ui",
    "args": true
  },
  {
    "name": "resume",
    "description": "Chọn và mở lại hội thoại đã lưu",
    "handler": "ui"
  },
  {
    "name": "agents",
    "description": "Duyệt các hội thoại trong Văn phòng AI",
    "handler": "ui"
  },
  {
    "name": "model",
    "description": "Chọn model/effort cho lượt gửi tiếp theo",
    "handler": "ui",
    "args": true
  },
  {
    "name": "usage",
    "description": "Mở hạn mức các tài khoản AI",
    "handler": "ui"
  },
  {
    "name": "delete",
    "description": "Xóa luồng trong app, cần xác nhận mật khẩu",
    "handler": "ui"
  },
  {
    "name": "logout",
    "description": "Gỡ tài khoản AI đang chọn, cần xác nhận mật khẩu",
    "handler": "ui"
  },
  {
    "name": "exit",
    "description": "Đóng hộp thoại chat; worker vẫn hoạt động",
    "handler": "ui"
  },
  {
    "name": "quit",
    "description": "Đóng hộp thoại chat như /exit",
    "handler": "ui"
  },
  {
    "name": "recap",
    "description": "Điểm lại các lượt và trích đoạn đã lưu, không nén",
    "handler": "ui"
  },
  {
    "name": "theme",
    "description": "Đổi giao diện light / dark / system",
    "handler": "ui",
    "args": true
  },
  {
    "name": "title",
    "description": "Đặt tiêu đề tab trình duyệt",
    "handler": "ui",
    "args": true
  },
  {
    "name": "pwd",
    "description": "Xem thư mục làm việc thực tế trên máy AI",
    "handler": "native"
  },
  {
    "name": "cwd",
    "description": "Xem thư mục làm việc như /pwd",
    "handler": "native"
  },
  {
    "name": "diff",
    "description": "Xem thay đổi Git và danh sách file chưa theo dõi",
    "handler": "native"
  },
  {
    "name": "init",
    "description": "Tạo AGENTS.md mẫu nếu chưa có, không ghi đè",
    "handler": "native"
  },
  {
    "name": "fork",
    "description": "Tách nhánh phiên Codex gốc, giữ lịch sử",
    "handler": "native"
  },
  {
    "name": "review",
    "description": "Chạy trình review code gốc của Codex",
    "handler": "native",
    "args": true,
    "usage": "/review [tên-nhánh]"
  },
  {
    "name": "plan",
    "description": "Đặt chế độ lập kế hoạch gốc cho các lượt tiếp theo",
    "handler": "native",
    "args": true,
    "usage": "/plan [on|off]"
  },
  {
    "name": "fast",
    "description": "Đặt tầng fast khi model/tài khoản hỗ trợ",
    "handler": "native",
    "args": true,
    "usage": "/fast [on|off]"
  },
  {
    "name": "goal",
    "description": "Xem/đặt/tạm dừng/tiếp tục/xóa mục tiêu phiên",
    "handler": "native",
    "args": true,
    "usage": "/goal [mục tiêu|pause|resume|clear]"
  },
  {
    "name": "ps",
    "description": "Liệt kê terminal nền của đúng phiên Codex",
    "handler": "native"
  },
  {
    "name": "stop",
    "description": "Dừng terminal nền của phiên; không phải nút Dừng AI",
    "handler": "native"
  },
  {
    "name": "mcp",
    "description": "Xem máy chủ MCP, trạng thái và tên công cụ",
    "handler": "native"
  },
  {
    "name": "apps",
    "description": "Xem danh sách ứng dụng CLI kết nối",
    "handler": "native"
  },
  {
    "name": "plugins",
    "description": "Xem danh sách plugin CLI; không tự cài/gỡ",
    "handler": "native"
  },
  {
    "name": "skills",
    "description": "Xem các skill CLI đã phát hiện",
    "handler": "native"
  },
  {
    "name": "hooks",
    "description": "Xem tên/trạng thái hook; không lộ lệnh hay biến môi trường",
    "handler": "native"
  },
  {
    "name": "permissions",
    "description": "Xem các hồ sơ quyền CLI; không tự thay đổi quyền",
    "handler": "native"
  },
  {
    "name": "experimental",
    "description": "Xem tính năng thử nghiệm CLI, không tự bật/tắt",
    "handler": "native"
  },
  {
    "name": "memories",
    "description": "Xem trạng thái memory hoặc bật/tắt cho phiên",
    "handler": "native",
    "args": true,
    "usage": "/memories [on|off]"
  },
  {
    "name": "debug-config",
    "description": "Xem cấu hình thực thi đã lọc thông tin nhạy cảm",
    "handler": "native"
  },
  {
    "name": "archive",
    "description": "Lưu trữ phiên",
    "handler": "unsupported",
    "reason": "Chưa có đồng bộ lưu trữ giữa phiên CLI và lịch sử app; dùng danh sách hội thoại để mở lại."
  },
  {
    "name": "approve",
    "description": "Duyệt lại thao tác bị từ chối",
    "handler": "unsupported",
    "reason": "Worker dùng chính sách không hỏi quyền; giao diện chưa có bản ghi từ chối cụ thể để duyệt. Không thể duyệt chung mọi thao tác."
  },
  {
    "name": "mention",
    "description": "Thêm file/thư mục trên máy AI",
    "handler": "unsupported",
    "reason": "Chưa có bộ chọn file từ máy AI có xác nhận đường dẫn; đính kèm file từ máy bạn bằng nút Chọn tệp."
  },
  {
    "name": "side",
    "description": "Hỏi bên lề trong phiên tạm",
    "handler": "unsupported",
    "reason": "Chưa có vòng đời phiên tạm để giữ hỏi bên lề ngoài lịch sử chính; dùng /fork để tạo nhánh thật."
  },
  {
    "name": "btw",
    "description": "Hỏi bên lề như /side",
    "handler": "unsupported",
    "reason": "Chưa hỗ trợ phiên tạm /side; dùng /fork."
  },
  {
    "name": "cd",
    "description": "Đổi thư mục trong cùng phiên",
    "handler": "unsupported",
    "reason": "Chưa đồng bộ thay đổi thư mục với dấu kiểm tra phiên trên mọi worker. Chọn thư mục khi tạo chat mới."
  },
  {
    "name": "worktree",
    "description": "Tạo nhánh làm việc Git riêng",
    "handler": "unsupported",
    "reason": "Chưa có quản lý vòng đời worktree và phiên trên các máy. Không tạo worktree bằng câu chat giả."
  },
  {
    "name": "warnings",
    "description": "Xem cảnh báo CLI lưu lại",
    "handler": "unsupported",
    "reason": "CLI app-server hiện không cung cấp lịch sử cảnh báo TUI cho app. Lỗi từng việc vẫn nằm trong hội thoại."
  },
  {
    "name": "ide",
    "description": "Đọc ngữ cảnh IDE",
    "handler": "unsupported",
    "reason": "Văn phòng AI không có kết nối IDE/selection của bạn."
  },
  {
    "name": "keymap",
    "description": "Đổi phím tắt terminal",
    "handler": "unsupported",
    "reason": "Chỉ áp dụng giao diện terminal Codex, không áp dụng ô chat web."
  },
  {
    "name": "vim",
    "description": "Bật soạn thảo Vim",
    "handler": "unsupported",
    "reason": "Chỉ áp dụng bộ soạn thảo của terminal Codex."
  },
  {
    "name": "raw",
    "description": "Đổi scrollback terminal",
    "handler": "unsupported",
    "reason": "Ô chat web không có scrollback TUI; dùng /copy hoặc /export."
  },
  {
    "name": "statusline",
    "description": "Đổi thanh trạng thái terminal",
    "handler": "unsupported",
    "reason": "Chỉ áp dụng thanh trạng thái của TUI Codex."
  },
  {
    "name": "pets",
    "description": "Chọn thú cưng terminal",
    "handler": "unsupported",
    "reason": "Pet TUI không chạy trong worker không giao diện; không điều khiển thú trang trí 3D."
  },
  {
    "name": "pet",
    "description": "Chọn thú cưng như /pets",
    "handler": "unsupported",
    "reason": "Chỉ có trong terminal Codex có giao diện."
  },
  {
    "name": "tui",
    "description": "Đổi chế độ giao diện terminal",
    "handler": "unsupported",
    "reason": "Worker dùng stdio app-server, không có giao diện TUI."
  },
  {
    "name": "setup-default-sandbox",
    "description": "Thiết lập sandbox Windows",
    "handler": "unsupported",
    "reason": "Cần thao tác trực tiếp trên Windows; không đổi sandbox VPS/Linux bằng lệnh web."
  },
  {
    "name": "daemon",
    "description": "Quản lý daemon Codex",
    "handler": "unsupported",
    "reason": "Văn phòng AI quản lý worker bằng dịch vụ riêng. Không tắt/cập nhật daemon bằng lệnh của hội thoại."
  },
  {
    "name": "app",
    "description": "Mở phiên trong ứng dụng desktop",
    "handler": "unsupported",
    "reason": "VPS không có ứng dụng ChatGPT desktop được ghép nối để chuyển phiên."
  },
  {
    "name": "feedback",
    "description": "Gửi log phản hồi Codex",
    "handler": "unsupported",
    "reason": "Chưa có màn hình xem trước/chọn log và xác nhận gửi cho OpenAI; không tự gửi log."
  },
  {
    "name": "import",
    "description": "Nhập cấu hình/chat từ ứng dụng khác",
    "handler": "unsupported",
    "reason": "Chưa có luồng xem trước và xác nhận nhập dữ liệu/cấu hình giữa các ứng dụng."
  },
  {
    "name": "subagents",
    "description": "Liệt kê subagent thuộc đúng phiên Codex",
    "handler": "native"
  }
];
