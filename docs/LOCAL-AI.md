# Học bằng Ollama trên máy

Ứng dụng có hai chế độ chạy riêng. `start:student-demo` dùng phản hồi mô phỏng và dữ liệu riêng. `start:student-local` gọi Ollama thật, dùng dữ liệu học tập thường (`data/student/`, hoặc `OFFICE_DATA_DIR/student/` nếu đã cấu hình). Hai môn mẫu trong demo không tự chuyển sang vùng dữ liệu thật. Không cần Claude Code hoặc Antigravity.

## Cài và chạy

1. Cài [Ollama cho Windows](https://docs.ollama.com/windows). Dịch vụ mặc định ở `http://127.0.0.1:11434`. Bộ cài cần ít nhất khoảng 4 GB, ngoài dung lượng model.
2. Tải đúng hai model, mặc định lưu ở ổ C trong tài khoản Windows:

   ```powershell
   ollama pull qwen3:4b
   ollama pull embeddinggemma:latest
   ollama list
   ```

   [qwen3:4b](https://ollama.com/library/qwen3:4b) khoảng 2,5 GB; [embeddinggemma](https://ollama.com/library/embeddinggemma) khoảng 622 MB. Đây là lựa chọn ban đầu cho máy Ryzen 5 6600H, RAM khoảng 16 GB, RTX 3050 Laptop 4 GB; chưa phải cam kết tốc độ hoặc chất lượng. Model chat có thể phải chạy một phần trên RAM/CPU, nhất là khi Office và ứng dụng khác đang dùng VRAM. Chừa khoảng 8–10 GB cho cài đặt và file tạm. Không tải model vào ổ D nếu ổ này vẫn gần đầy.
3. Trong thư mục repo, dùng Node.js 22 trở lên:

   ```powershell
   npm run build:student-local
   npm run start:student-local
   ```

   Mở `http://localhost:4312/?lang=vi` hoặc vào thẳng `http://localhost:4312/student?lang=vi`. Giữ terminal đang chạy. Khi khởi động lại máy, mở Ollama và chạy lại lệnh start. Bản local và demo dùng chung build `.next-student-demo`; dừng hai server trước khi build lại. Development có lệnh `npm run dev:student-local` và thư mục build riêng.

## Hỏi bài

- Tạo một học kỳ, thêm hai môn **Lập trình hướng đối tượng** và **Cơ sở dữ liệu**. Mã môn là nhãn tùy chọn để nhận diện môn, ví dụ `OOP` và `DB`.
- Chọn môn → Tài liệu → kéo thả **nhiều PDF cùng lúc** từ File Explorer hoặc chọn nhiều file qua nút Thêm PDF. Tối đa 20 MiB **mỗi file**. Các file được lưu lần lượt, rồi xếp hàng xử lý trên server; có thể thêm file tiếp khi đợt tải lên hoàn tất mà không phải đợi lập chỉ mục. File không hợp lệ có lỗi riêng, không chặn các file hợp lệ còn lại.
- Giao diện phân biệt Đang chờ xử lý, Đang đọc chữ từ PDF và Đang lập chỉ mục (số đoạn đã xong/tổng số đoạn). Lập chỉ mục chạy từng PDF trên Ollama để tránh tranh GPU; nhiều trang vẫn cần thời gian. Model embedding được giữ nóng hai phút thay vì buộc thoát sau mỗi file ([Ollama keep_alive](https://docs.ollama.com/api/embed)). Chờ trạng thái Sẵn sàng; PDF scan chưa có OCR có thể không trích xuất được chữ. Nếu server dừng giữa chừng, file vẫn còn và có thể bấm Thử lại/Xử lý lại sau khi mở server.
- Nếu file từng được lập chỉ mục bằng model khác, bấm **Xử lý lại**. Mỗi chỉ mục được phân biệt theo provider, model, kích thước vector và version. Không dùng lẫn vector giữa các hệ. Chỉ mục cũ được giữ khi nội dung chunk không đổi; lượt xử lý lại thất bại không xóa chỉ mục đang có.
- Với Ollama trên Windows, bước xử lý bổ sung OCR cho trang có ảnh và ít hơn 250 ký tự lớp chữ. Dùng [Windows OCR](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine), không gọi AI đám mây, không cần model thị giác. Máy cần có ngôn ngữ OCR; ưu tiên tiếng Anh cho bảng/thuật ngữ, sau đó ngôn ngữ người dùng. Chữ tiếng Việt có thể sai; trang nhiều chữ kèm ảnh nhỏ và ý nghĩa hình/sơ đồ chưa được đọc đầy đủ. File đã sẵn sàng từ trước cần **Xử lý lại** một lần. Nếu OCR thất bại, báo lỗi rõ và giữ PDF/chỉ mục cũ.
- Tên viết tắt như LRU/WSClock được kết hợp với điểm tương đồng khi truy xuất; chỉ lớp OCR có dung sai nhầm I/l/1. Câu hỏi chủ đề mới không tự ghép với câu hỏi trước; câu nối như “Cho ví dụ” vẫn dùng ngữ cảnh gần nhất.
- Mở Trò chuyện, chọn **Ollama · AI local**, kiểm tra kết nối và chọn cách trả lời:
  - **Theo tài liệu**: bám các đoạn truy xuất, thiếu căn cứ thì báo rõ.
  - **Tài liệu + mở rộng**: có thể thêm kiến thức mô hình, ghi rõ phần bổ sung; dùng được khi chưa tải PDF. Khi có PDF đã sẵn sàng nhưng chỉ mục chưa khớp, cần xử lý lại trước.
- Chế độ trả lời được nhớ riêng cho từng môn trong trình duyệt. Khi câu trả lời Theo tài liệu thiếu căn cứ, nút **Hỏi lại bằng Tài liệu + mở rộng** gửi một lượt mới; không sửa câu trả lời hoặc request ID cũ.
- Thử OOP: “Giải thích aggregation và composition theo tài liệu, kèm ví dụ Java.”
- Thử CSDL: “Giải thích khóa chính và khóa ngoại theo tài liệu, kèm ví dụ SQL.”
- Với câu hỏi không có trong file, so sánh hai chế độ. Trích dẫn PDF chỉ trỏ đến file/trang đã truy xuất; nhãn nguồn không chứng minh mô hình hiểu đúng hoặc mọi câu đều có căn cứ. Kiểm tra lại kiến thức và lời giải.
- Với Ollama ở chế độ mở rộng, schema yêu cầu riêng phần trả lời từ tài liệu và phần `additionalKnowledge`; server ghép thành hai mục có nhãn. Phần bổ sung luôn ghi “chưa xác minh”. Cách tách này không tự kiểm chứng đúng/sai về học thuật.
- Trong lượt kiểm tra tài liệu Hệ điều hành, bảng ở trang 36 chỉ nằm trong ảnh: lớp chữ cũ không chứa LRU/WSClock và tìm kiếm từng trả về hardware clocks. OCR cục bộ đã đưa bảng vào chỉ mục; kiểm thử truy xuất ưu tiên đúng trang 36. Đây là sửa khả năng đọc/tìm nguồn, không phải cam kết nội dung giải thích của model 4B luôn đúng hoặc mọi mệnh đề đều được tài liệu chứng minh. Trước OCR, model từng giải thích sai WSClock thành Windows System Clock khi nhận ngữ cảnh không liên quan.
- Kiểm tra thật câu ngắn “Giải thích WSClock” sau OCR vẫn có lượt model báo thiếu căn cứ ở cả hai chế độ; bảng chỉ liệt kê tên/nhận xét, không mô tả đầy đủ các bước. Không ép model tự tạo lời giải để che giới hạn. Khi model chỉ lặp câu hỏi, UI hiển thị rõ giới hạn model, không yêu cầu bật lại chế độ mở rộng đang chọn. Các câu trả lời dài ở lượt thử khác vẫn có so sánh hiệu năng thiếu căn cứ; chất lượng kiến thức chưa được coi là đạt hoàn toàn.
- Dùng **Dừng trả lời** để hủy. Nếu model lỗi, câu hỏi vẫn được lưu và có thể thử lại, giữ provider và chế độ ban đầu.
- Global preferences dùng cho cách học chung; memory của môn dành cho mục tiêu/khó khăn riêng. Chỉ lưu khi bạn chủ động chọn.
- Office chỉ hiển thị tutor theo hoạt động thực tế của môn; provider không phải thành viên chat. Có thể vào thẳng Academic và đóng Office để dành tài nguyên cho model.

## Cấu hình server

Có thể đặt trong `.env.local` (không commit file này):

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen3:4b
OLLAMA_EMBEDDING_MODEL=embeddinggemma:latest
OLLAMA_EMBEDDING_DIMENSIONS=768
OLLAMA_EMBEDDING_VERSION=
OLLAMA_CONTEXT_SIZE=8192
OLLAMA_TIMEOUT_MS=180000
```

Launcher local buộc `AI_OFFLINE_MODE=0`, chọn Ollama cho chat/embedding và bind loopback; không xóa key của provider khác, không sửa `.env.local`. Launcher demo vẫn ép mock và giữ vùng dữ liệu riêng. Lệnh start thường vẫn theo cấu hình provider hiện có.

Backend chỉ nhận base URL Ollama HTTP loopback; không cần key, không tự tải model, không fallback qua provider trả phí. Ollama dùng API native `/api/chat`, `/api/embed`, `/api/tags`. Câu trả lời JSON được nhận trọn vẹn rồi kiểm tra trước khi lưu/hiển thị; chưa stream token ra UI để tránh hiển thị citations chưa kiểm chứng. UI hiển thị bước tìm tài liệu/tạo câu trả lời qua lịch sử đang xử lý. Mỗi registry chỉ cho một inference Ollama đồng thời; yêu cầu khác nhận lỗi bận và có thể thử lại. Embedding xử lý batch nhỏ và giải phóng model trước lượt chat để giảm áp lực VRAM.

Model embedding mặc định trả vector 768 chiều. Khi đổi model hoặc dimensions, bấm xử lý lại từng PDF. Khi cập nhật nội dung của cùng một tag model, tăng `OLLAMA_EMBEDDING_VERSION` rồi lập chỉ mục lại để tránh dùng vector cũ. Version là giá trị do người vận hành quản lý; chưa tự theo digest model. Context được giới hạn theo ký tự và số đoạn, không phải tokenizer chính xác; câu hỏi quá dài có thể cần rút ngắn hoặc chỉnh context theo máy. Lịch sử cũ vẫn lưu trong SQLite dù chỉ một phần được gửi vào model.

## Tìm web

**Chưa triển khai dịch vụ tìm web trong bản này.** Công tắc hiển thị Chưa cấu hình và bị khóa; backend từ chối `webSearch=true`. Kiến thức mô hình không được gọi là tìm kiếm internet.

Phương án đã đánh giá: [SearXNG JSON Search API](https://docs.searxng.org/dev/search_api.html), có thể tự host và không đòi key API trả phí. Máy hiện chưa có dịch vụ này; nhiều instance công cộng không mở JSON, nên chưa chọn một endpoint công cộng thiếu ổn định. Bước sau cần cài/cấu hình một instance cho phép `format=json`, bộ lấy nội dung trang có giới hạn, kiểm tra DNS/địa chỉ IP và mọi redirect để chống SSRF, sau đó lưu trích dẫn web riêng với PDF. Chưa có endpoint fetch URL tùy ý.

## Kiểm thử và giới hạn

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build:student-local`.

`tests/unit/ollama.test.mjs` dùng HTTP fixture để kiểm tra giao thức, lỗi, timeout/hủy, giới hạn đồng thời, RAG theo môn, lưu mode/provider và giữ chỉ mục. HTTP fixture không phải bằng chứng model thật suy luận được. Browser test `student-local.spec.ts` dùng fixture riêng để kiểm tra UI (`npx playwright test --config playwright.student-local.config.ts`). Khi đã tải model, chạy `node scripts/check-local-ai.mjs` để kiểm thử suy luận thật với hai PDF mẫu trong database tạm; script không ghi vào dữ liệu học tập của bạn.

Đã kiểm tra render loop có giới hạn FPS và tự giảm chất lượng. Chế độ học tập dùng Cozy/Low sẵn có; tab ẩn bỏ qua cập nhật cảnh/render khi không ghi hình, giữ SSE cho trạng thái mới. Không suy ra mức tăng FPS từ số object hoặc draw call. Không mount scene 3D trên trang Academic.

Không xóa module legacy còn tham chiếu, dữ liệu, migrations, tests, lockfile hoặc provider API. Những phần Claude được tắt khỏi luồng học tập thay vì xóa thiếu căn cứ.

## Kết quả trên máy này

Đã cài Ollama 0.40.14 và tải đúng hai model vào ổ C. Dịch vụ local được chạy với `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`; không cập nhật driver. Bộ cài tải về đã được kiểm tra chữ ký Ollama Inc. và xóa sau cài đặt để thu hồi dung lượng.

Lượt kiểm tra thật cuối dùng hai PDF tự tạo, xác nhận nội dung trích xuất đầy đủ trước khi hỏi. Bốn yêu cầu qua pipeline PDF → embedding → truy xuất → Ollama → lịch sử SQLite hoàn tất, lần lượt khoảng 19,3 / 22,2 / 21,6 / 30,8 giây. Đây là bốn câu mẫu trên máy đã nạp model, không phải benchmark bảo đảm tốc độ. Lần nạp embedding đầu tiên khoảng 2 phút; câu chat đầu ở lượt khởi tạo trước đó khoảng 98 giây. File kết quả ở `data/tooling/ollama-real-inference.json`; database kiểm thử nằm trong temp và đã xóa, không ghi chat mẫu vào dữ liệu thật.

- OOP: trả lời bám ví dụ Department–Teachers và House–Rooms trong PDF, trích đúng file/trang.
- CSDL: giải thích khóa chính/khóa ngoại, trích đúng PDF và ví dụ Students/Enrollments.
- Câu ngoài PDF ở chế độ Theo tài liệu: báo thiếu căn cứ, không gắn nguồn giả.
- Câu ngoài PDF ở chế độ mở rộng: có mục kiến thức bổ sung riêng nhưng **vẫn phát sinh lỗi kiến thức**. Model đã khẳng định sai rằng Java record không thể tự định nghĩa phương thức/constructor; [tài liệu Oracle](https://docs.oracle.com/en/java/javase/24/language/records.html) mô tả các phương thức và constructor có thể khai báo. Không coi bài kiểm tra kết nối thành công là xác nhận chất lượng học thuật. Ưu tiên tài liệu môn học và đối chiếu phần mở rộng với nguồn đáng tin.

Trong quá trình kiểm tra đã sửa lỗi PDF mẫu tràn dòng khiến PDF.js bỏ phần ngoài trang: generator dùng Courier, bọc dòng 72 ký tự và chặn mẫu vượt một trang. Có test xác nhận trích xuất đủ đến ví dụ cuối. Không thay đổi file PDF của người dùng.

QA cuối: 213 unit pass, 3 skip, 0 fail; lint, typecheck, production build và module map đạt. Bảy kịch bản browser đã đạt qua các lượt chạy, gồm local fixture, demo và hồi quy Academic/Tutor/Memory/provider; đã xem ảnh desktop/mobile. Đo trên trình duyệt kiểm thử cho thấy nhánh tab ẩn không vẽ thêm frame và mobile không tràn ngang; số draw call lấy mẫu 431 trên SwiftShader không phải FPS của RTX 3050.

## Kết quả dọn repo

| Nhóm | Xử lý |
| --- | --- |
| Provider OpenAI/Gemini/DeepSeek, Academic, PDF/RAG, memory, migrations và tests | Giữ, mở rộng qua các luồng hiện có |
| Office/Claude legacy còn import, route hoặc tài liệu tham chiếu | Giữ, tắt khỏi shell học tập local/demo |
| Helper tạo PDF trùng trong `tests/e2e/student.spec.ts` | Xóa hàm trùng, dùng fixture hợp lệ chung |
| File source/assets chưa chứng minh hết tham chiếu | Không xóa |
| Bộ cài Ollama tạm trên ổ C | Đã xóa sau khi cài thành công |
| SQLite, PDF, lịch sử/memory, `.env.local`, lockfile | Giữ; database có backup dưới `data/tooling/local-ai-backup-*` |

Chưa commit, push, merge hoặc deploy.
