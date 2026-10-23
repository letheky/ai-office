# Office AI độc lập

Hướng dẫn cấu hình, vận hành và phát triển worker Codex/Claude: đọc [WORKER-GUIDE.md](WORKER-GUIDE.md) trước khi sửa worker hoặc launcher.

UI tiếng Việt. Node >=22.13, Express, SQLite tích hợp Node, giao diện Three.js tại demos/ai-office/dist.

- Không có kết nối ShopWatch, database hay server cũ.
- Không đưa .env, .runtime, server/data, local/data, output, log, hồ sơ AI hoặc cấu hình rclone vào source chia sẻ.
- CLI chỉ dùng subscription do người dùng tự đăng nhập; không gọi API AI trả phí.
- Cấu hình chạy qua scripts/runtime.js, hồ sơ CLI riêng trong .runtime/profiles. Không tự đọc/sao chép tài khoản AI toàn cục.
- Không tự chạy prompt AI, gửi tin, đăng nhập hay điều khiển trình duyệt/desktop để kiểm thử.
- Tác vụ xóa lịch sử/dự án hoặc gỡ tài khoản phải giữ xác nhận mật khẩu.
- Kiểm tra: npm test. Đóng gói source sạch: npm run share.
- Không chỉnh office-dark.css trực tiếp; chạy node demos/ai-office/gen-dark-css.mjs sau khi đổi CSS gốc.
