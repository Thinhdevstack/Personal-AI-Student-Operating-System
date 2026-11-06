# CI: Office 3D và khôi phục chat

Đã đối chiếu [job GitHub bị lỗi](https://github.com/Thinhdevstack/Personal-AI-Student-Operating-System/actions/runs/41856908041/job/126668994911), log người dùng gửi và artifact của run `41856908041` trên commit `c1f24ef` của `main`. Đây là bản trước phần Ollama/mô phỏng hiện chưa commit ở local.

## Phát hiện

- Lint, typecheck, unit test và build của run đó thành công. E2E có hai bài lỗi: Office Pro và Student Tutor Office đều không thấy `#stage canvas` trong 30 giây. Không có trace của hai bài này trong artifact cũ nên chưa xác định chính xác lỗi bên trong Chromium/WebGL.
- Bài Course Tutor bị flaky: trình duyệt chỉ có ba câu trả lời sau khi cố ý làm mất phản hồi HTTP thứ tư. Snapshot cho thấy lỗi mạng và nút thử lại bị khóa; database trong artifact đã lưu đủ bốn turn completed. Đây là lỗi khôi phục trạng thái ở client, không phải model chưa trả lời.
- `corruptedPdf` được ghi khi bài test tải một PDF tối giản không xử lý được; bài upload/download/archive đó vẫn qua. Cảnh báo metadataBase và Node action deprecation không phải bước gây exit code 1.
- Bản local có thêm hai spec cần launcher riêng nhưng cấu hình mặc định đang gom cả hai vào server Office thường. Nếu push nguyên trạng, chúng sẽ kiểm tra sai chế độ server dù các lỗi cũ đã sửa.

## Thay đổi

- CI chạy một worker; trình duyệt test chọn trực tiếp ANGLE + SwiftShader theo [hướng dẫn Chromium](https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/docs/gpu/swiftshader.md). Không thay đổi cài đặt trình duyệt người dùng. Riêng bước chờ canvas dùng 60 giây khi CI; các assertion nghiệp vụ vẫn giữ 30 giây. Không bỏ qua bài 3D hoặc vô hiệu hóa kiểm tra canvas.
- Bật trace khi thất bại và ảnh khi lỗi. Artifact giữ cả kết quả của hai chế độ mới, loại thư mục runtime `office-data`/`home` khỏi upload.
- Course Chat tiếp tục tải lịch sử khi kết quả gửi chưa rõ. Mỗi GET có deadline 5 giây, khoảng cách poll 6 giây, tối đa năm lượt khôi phục sau lỗi. Khi tìm thấy turn completed, tự hiển thị câu trả lời và gỡ lỗi/khóa thử lại; không gửi lại một câu hỏi mới hoặc đổi request ID.
- Bài test chat hiện làm mất phản hồi POST sau khi backend hoàn tất, đồng thời làm thất bại hai GET lịch sử đầu tiên, rồi kiểm tra tự khôi phục đủ bốn câu mà không trùng câu hỏi.
- `playwright.config.ts` bỏ hai spec riêng khỏi bộ Office thường. CI có bước riêng cho `test:e2e:student-demo` và `test:e2e:student-local`. Hai config nhận `OFFICE_DIST_DIR` từ env nên CI dùng lại build `.next`, không cần thêm build hoặc tải model Ollama. Test Ollama trong CI dùng HTTP fixture.

## Kiểm tra

- Collection: 11 bài trong bộ smoke mặc định, một bài mô phỏng và một bài Ollama riêng.
- 11/11 smoke đã qua với `CI=true`, một worker và software renderer, gồm cả hai bài 3D từng lỗi. Bộ mô phỏng và Ollama fixture cũng qua; hai bài chat/provider được chạy lại sau chỉnh sửa cuối của cơ chế khôi phục.
- Lint, typecheck, build production riêng `.next-ci-fix`, kiểm tra module map, YAML workflow và `git diff --check` được kiểm tra tại local.
- Các lượt này chạy trên Windows với Node 22/Chromium của Playwright. Chưa xác minh một run GitHub mới trên Ubuntu vì chưa commit/push. Run cũ vẫn giữ trạng thái đỏ; workflow mới chạy khi thay đổi được đưa lên PR hoặc `main`.

Lệnh CI tương ứng:

```sh
npm run build
npm run test:e2e:smoke -- --workers=1
OFFICE_DIST_DIR=.next npm run test:e2e:student-demo
OFFICE_DIST_DIR=.next npm run test:e2e:student-local
```

Hai dòng gán env trên dùng cú pháp bash của GitHub Actions. Trên PowerShell, đặt `$env:OFFICE_DIST_DIR='.next'` trước khi chạy lệnh. Không dùng thư mục build đang phục vụ ứng dụng khi build lại; kiểm tra local đợt này dùng `.next-ci-fix`, không thay thư mục build mặc định của bản demo/local.
