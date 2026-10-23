# Hướng dẫn bàn giao cho AI — worker Codex và Claude

Đọc `AGENTS.md`, tài liệu này, rồi đối chiếu code trước khi sửa. Đây là Office AI độc lập, không phải worker của ShopWatch. Tài liệu mô tả bản tách ngày 2026-10-23; source thực tế là căn cứ khi triển khai tiếp.

## 1. Mục tiêu và cấu trúc hiện tại

Ứng dụng web nhận đề bài, server lưu hàng chờ vào database mới, worker lấy việc và gọi CLI subscription của tài khoản người dùng tự đăng nhập. Không cần API key AI. Không sao chép tài khoản hoặc dữ liệu của người cung cấp source.

Luồng thực thi:

```text
Trình duyệt /ai-office/
  → Express /api/ai-office (đăng nhập riêng bằng HTTP Basic)
  → server/data/office.db (hàng chờ, lịch sử, tiến trình)
  ← worker HTTP trên cùng máy (npm run worker)
  → Codex app-server hoặc Claude CLI
  → sự kiện, nội dung, trạng thái trả lại server
  → giao diện poll và hiển thị
```

Các file cần đọc theo phần việc:

- `scripts/setup.js`: tạo `.env` mới với mật khẩu ngẫu nhiên; không ghi đè cấu hình đã có.
- `scripts/runtime.js`: lọc cấu hình, xóa biến credential kế thừa, đặt đường dẫn hồ sơ AI riêng và URL server.
- `scripts/run.js`: điểm vào server, worker, đăng nhập Codex/Claude.
- `server/src/index.js`, `server/src/lib/auth.js`: HTTP, xác thực độc lập, bảo vệ giao diện và API.
- `server/src/db/database.js`, `schema.json`, `sqlite.js`: SQLite tích hợp Node, chỉ tạo bảng Office AI và app_settings.
- `server/src/routes/aiOffice.js`: capabilities, tạo việc, heartbeat, nhận việc, tiến trình, kết quả, lệnh điều khiển.
- `local/src/ai-office-worker.js`: worker HTTP thực sự được `npm run worker` gọi.
- `server/scripts/ai-office-cli.js`: môi trường CLI và xác minh đăng nhập subscription.
- `server/scripts/ai-office-session.js`: thư mục làm việc, tiếp tục phiên, gọi CLI, dừng việc.
- `server/scripts/ai-office-codex-server.js`: giao thức app-server JSON-RPC cho Codex.
- `server/scripts/ai-office-prompt.js`: đề bài gửi cho AI, không tự thêm báo cáo shop.
- `server/scripts/ai-office-usage.js`, `ai-office-subscription.js`: đọc hạn mức và thông tin gói.
- `server/src/services/aiOfficeModels.js`: model được worker báo lên, lựa chọn model/effort.
- `server/src/services/aiOfficeLive.js`: sự kiện và trạng thái điều chỉnh đang chờ/đã gửi/không rõ.
- `demos/ai-office/dist/office-live.js`: form giao việc và giao diện theo dõi.

`server/scripts/ai-office-worker.js` là worker dùng database trực tiếp được giữ từ nguồn gốc. Nó **không** phải điểm vào mặc định của bản này. Để cài cho người nhận source, dùng worker HTTP qua `npm run worker`.

## 2. Cài mới an toàn

Cần Node >=22.13, npm và binary CLI tương ứng đã được người dùng cài. Kiểm tra `node --version`, `npm --version`, `codex --version` / `claude --version`. Không tự đoán binary thuộc nhà cung cấp nào chỉ dựa vào tên; đối chiếu CLI đang cài và code tích hợp nếu lệnh không tương thích.

Từ gốc dự án:

```sh
npm ci
npm run setup
```

`.env` mới chứa `OFFICE_USER` và `OFFICE_PASSWORD`. Người dùng xem và giữ riêng; AI không in mật khẩu, credential hoặc nội dung hồ sơ AI vào chat/log. `.env.example` chỉ là mẫu, không đủ để khởi động vì mật khẩu đang để trống.

`npm run setup` từ chối khi `.env` đã tồn tại. Không xóa `.env` để thử lại; chỉ sửa đúng tùy chọn cần thiết và giữ mật khẩu đang dùng.

## 3. Chạy chỉ Codex / ChatGPT

Trong `.env`:

```dotenv
AI_OFFICE_PROVIDERS=codex
AI_OFFICE_ACCOUNT_LABEL=ChatGPT của tôi
```

Nếu `codex` không có trên PATH, thêm `AI_OFFICE_CODEX_BIN` bằng đường dẫn binary của chính máy người nhận. Launcher chấp nhận biến này từ `.env`.

Người dùng tự chạy đăng nhập tương tác:

```sh
npm run login:codex
```

Sau đó chạy server ở terminal 1:

```sh
npm start
```

Chạy worker ở terminal 2:

```sh
npm run worker
```

Mở http://127.0.0.1:3010/ai-office/, đăng nhập bằng tài khoản ứng dụng trong `.env`. Chọn máy online và tài khoản Codex trong form giao việc; chọn model/effort có trên tài khoản. Đăng nhập ứng dụng và đăng nhập ChatGPT là hai bước riêng.

Hồ sơ Codex của bản này: `.runtime/profiles/codex/`. `npm run login:codex` đặt CODEX_HOME trước khi gọi `codex login`. Không dùng trực tiếp `codex login` từ shell rồi cho rằng worker sẽ nhận phiên đó: shell có thể đang ghi vào hồ sơ toàn cục khác.

Worker xác minh `codex login status` là đăng nhập ChatGPT. Khi thực thi, nó dùng `codex app-server --listen stdio://`, kiểm tra `account/read` có loại `chatgpt`, rồi `thread/start` / `thread/resume` và `turn/start`. Không thay bằng API key hoặc HTTP gọi mô hình trả phí.

## 4. Chạy chỉ Claude

Trong `.env`:

```dotenv
AI_OFFICE_PROVIDERS=claude
AI_OFFICE_ACCOUNT_LABEL=Claude của tôi
```

Nếu cần, thêm `AI_OFFICE_CLAUDE_BIN` bằng đường dẫn CLI Claude trên máy người nhận. Người dùng tự đăng nhập:

```sh
npm run login:claude
```

Giữ `npm start` ở một terminal, chạy `npm run worker` ở terminal khác. Chọn máy online và Claude trong giao diện.

Hồ sơ Claude của bản này: `.runtime/profiles/claude/`. Launcher đặt CLAUDE_CONFIG_DIR rồi gọi `claude auth login`. Đăng nhập Claude Desktop hoặc hồ sơ CLI toàn cục không chứng minh hồ sơ riêng này đã đăng nhập.

Worker kiểm tra `claude auth status`: phải đăng nhập bằng `claude.ai` và có subscriptionType. Thực thi dùng chế độ CLI không tương tác, nhận sự kiện JSON và lưu session ID để hỏi tiếp. Các tham số chính xác nằm ở `sessionArgs()` trong `server/scripts/ai-office-session.js`; đối chiếu CLI đang cài trước khi sửa.

## 5. Dùng cả hai provider trong một worker

Trong `.env`:

```dotenv
AI_OFFICE_PROVIDERS=claude,codex
AI_OFFICE_ACCOUNT_LABEL=AI của tôi
```

Người dùng đăng nhập từng provider:

```sh
npm run login:codex
npm run login:claude
```

Chạy một `npm run worker`. Worker chỉ quảng bá provider đã xác minh đăng nhập thành công. Nếu một provider chưa đăng nhập, provider còn lại vẫn có thể hoạt động; nếu không có provider nào hợp lệ, worker thoát với thông báo lỗi. Khởi động lại worker sau khi đăng nhập thêm hoặc sửa `.env` vì danh sách provider sẵn sàng được tính lúc worker khởi động.

Một worker HTTP hiện xử lý **một job mỗi lần**, dù bật cả hai provider. Không mô tả cấu hình này là hai worker song song. Cũng không chạy hai bản `npm run worker` trong cùng thư mục với hy vọng có hai tài khoản độc lập: chúng đang dùng chung hồ sơ và định danh worker.

## 6. Vòng đời worker và hội thoại

1. Đọc cấu hình do launcher đặt, tạo/đọc định danh tại `.runtime/worker/ai-office-machine.json`; không hardcode ID từ máy cũ.
2. Kiểm tra subscription, đọc model/hạn mức và năng lực máy. Các phép đọc này có thể cần mạng; không gửi prompt suy luận để kiểm tra đăng nhập.
3. Đăng ký bằng `POST /worker/heartbeat`; phục hồi trạng thái bằng `POST /worker/recover`.
4. Heartbeat định kỳ 10 giây; khi rảnh, hỏi `GET /worker/next?machine=<id>`, nghỉ 2,5 giây nếu chưa có việc. Các đường dẫn này đều có tiền tố `/api/ai-office`.
5. Server nhận việc bằng transaction, chuyển `pending` thành `running` để tránh nhận trùng.
6. Worker tải tệp người dùng chọn, xác minh thư mục, tiếp tục đúng phiên CLI nếu còn trên cùng hồ sơ và thư mục làm việc.
7. Báo sự kiện/tiến trình qua `/worker/jobs/:id/progress`, nhận lệnh dừng và điều chỉnh; gửi kết quả qua `/worker/jobs/:id/result`.
8. UI đọc trạng thái từ server. Job đã hoàn thành không nhận kết quả lần hai; không tự chạy lại prompt khi chỉ mất phản hồi mạng.

Phiên và tệp làm việc mặc định nằm dưới `.runtime/worker/`, trong đó `work/` giữ ánh xạ phiên CLI. Khi người dùng chọn thư mục khác, CLI chạy tại thư mục đó. Đổi provider hoặc máy dùng cơ chế bàn giao, không giả vờ cùng một phiên gốc. Worker chạy với quyền user hệ điều hành; đây không phải vùng cách ly để chạy source không tin cậy.

Giữ nguyên trạng thái `uncertain` của thao tác gửi chưa rõ; đọc lại trạng thái trước khi thử tiếp. Không tự gửi lại để "chắc chắn", không biến lệnh điều khiển không được hỗ trợ thành câu chat mới.

## 7. Giới hạn cấu hình và cách phát triển thêm

Launcher hiện chỉ cho các khóa trong danh sách `allowed` của `scripts/runtime.js` đi từ `.env` vào runtime. Nó xóa biến AI/credential kế thừa từ shell rồi cố định các đường dẫn hồ sơ, định danh và URL server.

Vì vậy bản hiện tại:

- Mặc định chạy server và worker trên cùng máy qua localhost, cổng từ `PORT`.
- Worker từ xa: đặt `AI_OFFICE_SERVER_URL` trong `.env` của máy worker (xem mục 7.1). Launcher chỉ nhận giá trị trong `.env`, không nhận từ biến môi trường kế thừa; bắt buộc `https://` (http chỉ cho localhost), không chứa tài khoản, đường dẫn hay query.
- Chưa hỗ trợ hai tài khoản Codex, hai worker độc lập hoặc host ID tùy ý bằng cách chỉ thêm CODEX_HOME / AI_OFFICE_DATA_DIR / AI_OFFICE_HOST_ID.
- Browser-harness và computer use bị tắt trong launcher; thêm cờ vào `.env` hiện chưa bật được.
- Không có tài khoản AI, credential hoặc dữ liệu mẫu sản xuất được đóng gói sẵn.

Nếu được giao bổ sung worker từ xa hoặc nhiều tài khoản, AI triển khai cần làm rõ giao diện cấu hình và sửa launcher, không chỉ viết hướng dẫn xuất biến môi trường đang bị xóa. Mỗi worker/tài khoản phải có hồ sơ CLI, dataDir, workDir và ID riêng; các worker cùng máy có thể báo chung host ID qua cơ chế heartbeat hiện có. Khóa nhận việc, session scope, điều khiển dừng và báo kết quả phải tiếp tục gắn đúng worker/tài khoản.

Worker từ xa cần URL được kiểm tra, HTTPS và thông tin đăng nhập ứng dụng do người vận hành tự cấu hình. Không đưa credential vào URL/log/source, không gửi database qua worker, không dùng lại địa chỉ dịch vụ cũ. Thêm kiểm thử cho cấu hình, nhận việc đồng thời, quyền truy cập và đóng gói trước khi tuyên bố hỗ trợ.

Không tự đăng nhập tài khoản, chạy inference thật, bật browser/desktop, cài service hệ thống hoặc deploy chỉ vì đang đọc tài liệu bàn giao này. Khi người dùng yêu cầu các bước đó, thực hiện đúng phạm vi được giao và để họ hoàn thành OAuth/cấp quyền tương tác.

### 7.1 Worker từ xa (ví dụ máy Windows)

Server chạy trên VPS sau HTTPS (nginx + certbot). Trên máy worker:

```sh
git clone <repo> office-ai && cd office-ai
npm ci
```

Tạo `.env` bằng tay (không chạy `npm run setup`, vì setup sinh mật khẩu mới):

```env
OFFICE_USER=<giống server>
OFFICE_PASSWORD=<giống server>
AI_OFFICE_SERVER_URL=https://office-ai.example.org
AI_OFFICE_MACHINE_NAME=PC Windows
AI_OFFICE_PROVIDERS=claude,codex
AI_OFFICE_ACCOUNT_LABEL=AI máy Windows
```

Sau đó `npm run login:codex` / `npm run login:claude` rồi `npm run worker`. Máy xuất hiện trong **Máy xử lý**; khi giao việc, chọn máy này và chọn thư mục làm việc trên máy đó. Worker nhận việc bằng cách gọi ra server (không cần mở cổng trên máy worker). Mật khẩu chỉ nằm trong `.env` của máy worker, không vào URL hay log.

## 8. Chẩn đoán thường gặp

- `Chạy npm run setup trước`: chưa có `.env` hoặc chưa dùng launcher. Chạy từ đúng gốc dự án.
- `OFFICE_PASSWORD phải có ít nhất 16 ký tự`: giữ/tạo mật khẩu ứng dụng đủ dài trong `.env`, không dùng mật khẩu AI.
- `Claude và Codex CLI chưa đăng nhập`: kiểm tra provider trong `.env`, binary và lệnh login tương ứng của dự án; không copy hồ sơ toàn cục vào để chữa lỗi.
- `ENOENT`: đường dẫn binary sai hoặc chưa cài CLI; cấu hình khóa `AI_OFFICE_*_BIN` tương ứng trong `.env` rồi khởi động lại.
- HTTP 401: thông tin đăng nhập Office AI không khớp hoặc trình duyệt chưa đăng nhập; không đổi token AI để chữa 401 ứng dụng.
- `ECONNREFUSED`: server chưa chạy hoặc sai PORT. Cả `npm start` và `npm run worker` phải đọc cùng `.env`.
- Chỉ thấy một provider: provider còn lại chưa được chọn trong `.env`, thiếu đăng nhập subscription hoặc CLI không tương thích. Đăng nhập xong phải khởi động lại worker.
- Chọn nhầm nhóm VPS/worker máy chủ: chọn máy online được worker HTTP báo lên. Nhóm máy chủ chỉ có việc khi đã chủ động vận hành worker database trực tiếp.
- Model không có trên tài khoản: đọc capabilities / tab model, chọn model thật được worker báo. Không hardcode model "mới nhất" theo trí nhớ.
- Tác vụ báo worker khởi động lại: kiểm tra tệp/kết quả đã tạo trước khi giao lại, không tự replay.
- Hỏi tiếp mất phiên: kiểm tra đúng hồ sơ, worker và thư mục; không xóa `.runtime` để thử sửa vì đó là dữ liệu người dùng.
- Dự án Drive báo chưa cấu hình: dùng tệp trực tiếp/thư mục cục bộ hoặc tự cấu hình rclone riêng theo README; không mang rclone.conf của người khác sang.

## 9. Kiểm tra và chia sẻ

```sh
npm test
npm run share
```

Kiểm thử dùng database trong bộ nhớ, worker HTTP giả lập và tệp tạm, không gọi AI thật. Muốn kiểm thử đầu cuối với subscription thật cần người dùng tự đăng nhập và chủ động giao một đề bài. Không tuyên bố đã kiểm chứng suy luận chỉ vì test HTTP chạy đạt.

Gửi `release/office-ai-source.tar.gz`, trong đó có tài liệu này. Không gửi `.env`, `.runtime`, server/data, local/data, output, log, auth.json, .credentials.json hoặc rclone.conf. Không sửa bộ đóng gói theo hướng lấy cả thư mục đang chạy.

## 10. Dark mode hiện có

Có sẵn CSS tối (`demos/ai-office/dist/office-dark.css`) và đổi màu cảnh 3D (`office-decor.js`). `office-theme.js` đọc khóa `tb_theme` trong localStorage: `dark` / `light`; nếu chưa lưu thì theo `prefers-color-scheme` của hệ điều hành. Khóa này là dữ liệu trình duyệt, không phải biến `.env`.

Nút ☀/☾ ở thanh đầu trang chuyển sáng/tối ngay và lưu lựa chọn qua khóa `tb_theme`. Nút hỗ trợ bàn phím, trạng thái `aria-pressed` và đồng bộ các tab cùng origin; khi storage bị chặn vẫn đổi được trong phiên hiện tại. Khi chưa chọn thủ công, theme theo hệ điều hành. Người phát triển cũng có thể thử trong Console của chính trang:

```js
localStorage.setItem('tb_theme', 'dark');
location.reload();
```

Đổi `'dark'` thành `'light'` để thử sáng; `localStorage.removeItem('tb_theme')` rồi tải lại để trở về theo hệ thống. Không đưa credential vào Console. Sự kiện storage chỉ đến các trang khác cùng origin; nếu viết nút theme trong cùng trang thì phải gọi áp dụng theme hoặc phát sự kiện phù hợp, không chỉ ghi storage rồi chờ trang tự đổi.

Nếu sửa CSS nguồn, chạy `node demos/ai-office/gen-dark-css.mjs`, không sửa tay CSS tối sinh ra. Khi sửa nút đổi theme, giữ nhãn, aria và sự kiện `office:theme` để đồng bộ màu cảnh 3D. Khi storage bị chặn, trang vẫn dùng lựa chọn theo hệ điều hành; không cần đăng nhập AI để thử theme.

## 11. Đề bài mẫu để đưa cho AI nhận source

> Đọc AGENTS.md và WORKER-GUIDE.md trong dự án này. Kiểm tra code launcher và môi trường, cài dependency bằng npm ci nếu cần. Hướng dẫn tôi tạo .env riêng, tự đăng nhập Codex/Claude bằng các lệnh login của dự án và chạy server + worker trên cùng máy. Không copy tài khoản toàn cục, không in key/token/mật khẩu, không gọi API AI trả phí, không chạy prompt suy luận khi tôi chưa yêu cầu. Kiểm tra npm test và báo đúng những gì đã xác minh. Nếu tôi yêu cầu nhiều tài khoản hoặc worker từ xa, hãy triển khai cấu hình và kiểm thử cần thiết vì launcher hiện chưa hỗ trợ chúng chỉ bằng biến môi trường.
