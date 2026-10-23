# Office AI — Văn phòng AI độc lập

Ứng dụng tiếng Việt để giao việc cho Claude / ChatGPT qua CLI subscription của chính người sử dụng. Có văn phòng 3D, hội thoại nhiều lượt, model/effort, hạn mức, nhiều worker và chia việc. Source tách từ sync-app `033cadb0b`, không cần chạy ShopWatch hay kết nối server cũ.

Tài liệu bàn giao cho AI khác: [WORKER-GUIDE.md](WORKER-GUIDE.md) giải thích cài Codex/Claude, chạy từng provider hoặc cả hai, vòng đời worker, giới hạn nhiều tài khoản/từ xa và chẩn đoán lỗi.

## Cài và chạy

Cần Node.js 22.13 trở lên (khuyến nghị Node 22 LTS), npm; cài CLI Codex hoặc Claude theo nhà cung cấp. Chạy trong thư mục này:

```sh
npm ci
npm run setup
npm start
```

Mở http://127.0.0.1:3010/ai-office/ và đăng nhập bằng `OFFICE_USER` / `OFFICE_PASSWORD` trong `.env`. Setup tạo mật khẩu ngẫu nhiên riêng cho mỗi bản cài, không có mật khẩu mặc định. Đổi cổng trong `.env` nếu cần. Server mặc định chỉ nghe localhost.

Trong terminal khác, tự đăng nhập tài khoản của bạn và chạy worker:

```sh
npm run login:codex
npm run worker
```

Nếu dùng Claude, đặt `AI_OFFICE_PROVIDERS=claude` trong `.env`, chạy `npm run login:claude`, rồi `npm run worker`. Dùng cả hai: `AI_OFFICE_PROVIDERS=claude,codex`, tự đăng nhập cả hai CLI. Các lệnh login dùng hồ sơ mới riêng ở `.runtime/profiles/`, không lấy phiên đăng nhập AI sẵn có trên máy. Không sao chép auth.json hoặc credentials của người khác vào đây.

Trong form Giao việc, chọn máy worker vừa xuất hiện ở **Máy xử lý** và chọn AI. Nhãn **VPS** là nhóm worker phía server kế thừa; mặc định không có worker ở nhóm này. Chọn máy đang online để giao việc.

Worker có quyền đọc/sửa tệp và chạy lệnh theo quyền tài khoản hệ điều hành đang chạy nó. Chỉ mở ứng dụng cho người bạn tin cậy. Chưa cấu hình HTTPS/reverse proxy thì giữ `HOST=127.0.0.1`; không dùng Basic Auth qua HTTP công khai.

## Dữ liệu và tính năng tùy chọn

- `.env`: đăng nhập ứng dụng mới và các tùy chọn. Không có API key AI.
- `.runtime/profiles/`: thông tin đăng nhập CLI do bạn tự tạo sau khi đăng nhập; không thuộc source chia sẻ.
- `server/data/office.db`: database mới của ứng dụng; không chứa dữ liệu ShopWatch ban đầu.
- `.runtime/worker/`: định danh worker và tệp công việc; không thuộc source chia sẻ.
- Chọn thư mục cục bộ / đính kèm tệp trực tiếp dùng được không cần Drive. Dự án đồng bộ nhiều máy qua Drive cần tự cài rclone, cấu hình riêng bằng `rclone --config .runtime/rclone.conf config`, rồi đặt `AI_OFFICE_DRIVE_REMOTE` trong `.env`.
- Browser-harness / desktop bridge giữ source để phát triển nhưng mặc định tắt và không kết nối trình duyệt hay màn hình hiện có. Muốn bật cần cấu hình và cấp quyền riêng; không tự mang kết nối máy cũ sang.
- Không có dữ liệu shop, API sàn, chatbot khách hàng hoặc thông tin tài khoản của người tách source.

## Chia sẻ source

```sh
npm test
npm run share
```

Gửi **`release/office-ai-source.tar.gz`**. Lệnh đóng gói chỉ lấy source theo danh sách cho phép, không lấy `.env`, `.runtime`, database, lịch sử chat, tệp người dùng, node_modules hay lịch sử Git. Người nhận giải nén rồi tự cài và đăng nhập như trên. Sau khi đã dùng ứng dụng, luôn tạo lại gói bằng lệnh này; không gửi toàn bộ thư mục đang chạy.

Thư viện Three.js đi kèm giữ giấy phép tại `demos/ai-office/dist/vendor/THREE-LICENSE.txt`. Các dependency npm giữ giấy phép tương ứng của nhà cung cấp.

## Kiểm tra

`npm test` kiểm tra logic AI Office, HTTP API, quyền truy cập, schema độc lập và việc đóng gói không chứa credential/dữ liệu. Kiểm thử không gọi AI thật. Chưa kiểm chứng bằng một lượt suy luận subscription thật trong bản tách này; cần tự đăng nhập tài khoản mới trước khi giao việc.

## Dark mode

Đã có dark mode cho giao diện và cảnh 3D, mặc định theo hệ điều hành. Nút ☀/☾ trên thanh đầu trang cho phép đổi sáng/tối ngay, đồng bộ cảnh 3D và nhớ lựa chọn trong trình duyệt qua khóa `tb_theme`. Xem cách thử và hướng dẫn phát triển trong [WORKER-GUIDE.md](WORKER-GUIDE.md#10-dark-mode-hiện-có).
