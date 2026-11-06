# Chế độ mô phỏng học tập

Chạy Academic, PDF, Tutor Chat, Memory và Tutor 3D mà không cần API key hoặc Claude Code/Antigravity. Đây là bản mô phỏng: câu trả lời theo mẫu và trích đoạn PDF, không phải AI thật. Cả OpenAI, Gemini và DeepSeek trong bộ chọn đều dùng mock.

## Chạy bản production trên Windows

Cần Node 22 trở lên và dependencies đã cài. Trong thư mục project, chạy lần lượt:

```cmd
npm run build:student-demo
npm run start:student-demo
```

Mở **http://localhost:4311/?lang=vi** hoặc **http://localhost:4311/student?lang=vi**. Lệnh build dùng `.next-student-demo/`; không ghi đè build `.next/` của server thường. Nếu đổi code, build lại trước khi chạy production.

Để phát triển với hot reload:

```cmd
npm run dev:student-demo
```

Bản dev dùng `.next-student-demo-dev/`. Cổng mặc định là 4311; `OFFICE_PORT` từ môi trường shell có thể chọn cổng khác. Dừng server bằng Ctrl+C ở cửa sổ đã chạy lệnh.

## Dùng thử

1. Nhấn **Tạo dữ liệu mẫu**. App tạo một học kỳ, hai môn, PDF mẫu và ghi nhớ, rồi xử lý PDF bằng mock embeddings. Nhấn lại tái sử dụng các bản ghi đã có. Nội dung PDF mẫu dùng tiếng Anh để trích xuất ổn định; giao diện và câu hỏi hỗ trợ tiếng Việt.
2. Trong Office, nhấn **Tutor học tập**, chọn môn rồi nhấn **Mở chat của môn**. Muốn xem nhân vật hoạt động, giữ Office ở một tab và mở link chat ở tab khác.
3. Với môn Lập trình hướng đối tượng, hỏi: **Giải thích aggregation và composition**. Với Cơ sở dữ liệu, hỏi: **Primary key và foreign key khác nhau thế nào?**
4. Thử đổi provider mô phỏng, tải lại trang xem lịch sử, mở phần memory gửi kèm câu trả lời và thêm/sửa ghi nhớ của bạn.
5. Bạn có thể tự tạo môn và tải PDF tối đa 20 MiB. Ít nhất một PDF phải xử lý thành công trước khi gửi câu hỏi. PDF dùng embeddings khác cần **Reprocess / Xử lý lại**.

Tutor 3D đại diện cho môn, không phải một phiên Claude hoặc một provider riêng. Tối đa bốn Tutor hiển thị cho các môn có hoạt động gần đây. Nhân vật đi tìm tài liệu, chọn memory rồi chuẩn bị phản hồi theo lifecycle thật của backend mô phỏng. Khi mới mở app và chưa hỏi gì, chưa có Tutor là bình thường.

## Dữ liệu và quay lại chế độ thật

- Dữ liệu học tập demo: `data/student-demo/student/`, gồm SQLite và PDF.
- Build production demo: `.next-student-demo/`; build dev: `.next-student-demo-dev/`.
- Dữ liệu và cấu hình được Git ignore; không commit API key hoặc PDF cá nhân.
- Các nút chạy demo buộc `AI_OFFLINE_MODE=1`, xóa key khỏi môi trường process, tắt tích hợp tài khoản/usage Claude và dùng thư mục Claude riêng. Không cần sửa `.env.local` để chạy demo.
- Server demo chỉ lắng nghe loopback. Không chia sẻ cổng demo ra Internet.
- Kiểm thử có thể dùng thư mục con `data/student-demo/qa-*/`; không dùng thư mục này làm dữ liệu thật.

Để chạy bản thường, dùng `npm run dev` hoặc `npm run build` rồi `npm start`. Mặc định bản thường ở cổng 4310, dùng dữ liệu và `.env.local` bình thường. Đặt `AI_OFFLINE_MODE=0` trong cấu hình bản thường khi muốn dùng AI thật. Thiếu key sẽ báo chưa cấu hình; không tự bật mock. Nếu shell đang đặt `OFFICE_STUDENT_DEMO=1`, bỏ biến đó trước khi chạy bản thường.

Global preferences là ghi nhớ cách bạn muốn học dùng chung giữa các môn. Course memory là mục tiêu hoặc khó khăn của riêng môn. Đây là dữ liệu để thử chọn context, không huấn luyện model.

## Kiểm tra

```cmd
npm run lint
npm run typecheck
npm test -- --test-concurrency=2
npx playwright test --config playwright.student-demo.config.ts
```

Test trình duyệt dùng build demo đã tạo, một cổng và thư mục con QA riêng. Kết quả kiểm thử mock xác minh ứng dụng và lifecycle; không xác minh chất lượng model hay kết nối API thật. Mức đồ họa Low giảm bóng/hiệu ứng và giới hạn khung hình; kết quả GPU giả lập của môi trường kiểm thử không đại diện FPS trên máy người dùng.

Đo cùng viewport 1280×800, trình duyệt Chromium/SwiftShader, pixel ratio 0,5, không có Tutor đang hiện: cảnh mặc định cũ (Pro) có 3.080 đối tượng, 2.127 mesh, 752 lượt vẽ và 919.194 tam giác ở frame lấy mẫu. Bản học tập mặc định (Cozy) có 1.919 đối tượng, 1.355 mesh, 413 lượt vẽ và 585.051 tam giác. Đây là số liệu một frame để đối chiếu tải hình học, không phải benchmark FPS trung bình hoặc mức tăng tốc GPU thật. Bản demo cũng bỏ polling hệ thống máy và kiểm tra cập nhật Claude ở phía Office.
