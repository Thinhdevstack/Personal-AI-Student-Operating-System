# B5 — Tối ưu và Hoàn thiện Hỏi đáp Học tập & Tích hợp Ollama Cloud (Theo lộ trình P0)

## 1. Mục tiêu và Kết quả theo Lộ trình P0

| Thứ tự | Hạng mục | Điều kiện hoàn thành | Trạng thái thực tế |
|---|---|---|---|
| **P0.1** | **Sửa trạng thái provider** | Tách rõ: chưa cấu hình (`not_configured`), chưa kiểm tra (`unverified`), đã kết nối (`connected`), cần đăng nhập (`auth_required`), hết hạn mức (`rate_limited`), mất kết nối (`disconnected`). Không báo "Sẵn sàng" chỉ vì provider có trong danh sách. | **ĐÃ HOÀN THÀNH** |
| **P0.2** | **Hoàn thiện Ollama Cloud** | Xác minh tên model động, kiểm tra đăng nhập bằng test ping không chứa dữ liệu học tập, phân tích JSON phòng thủ (loại bỏ markdown code blocks) và fallback định dạng JSON khi gặp mã 400. | **ĐÃ HOÀN THÀNH** |
| **P0.3** | **Bỏ tự gắn citation đầu tiên** | Bỏ mã gán tự động `sourceIds: [context.sources[0].sourceId]`. Model trả về `basis: 'materials'` nhưng thiếu citation sẽ bị từ chối với lỗi `aiInvalidCitation`, không biến thành câu trả lời có nguồn hợp lệ. | **ĐÃ HOÀN THÀNH** |
| **P0.4** | **Kiểm thử và sửa hỏi theo chương/trang** | “Chương 5 trang 37” trích xuất đúng file và trang; hỗ trợ từ đồng nghĩa (chương, bài, buổi, tuần, lecture, lab, slide) và từ khóa tên file. Thiếu nội dung hoặc lỗi trang thì báo cụ thể với `basis: 'insufficient'`. | **ĐÃ HOÀN THÀNH** |
| **P0.5** | **Hoàn thiện gửi, dừng, retry và khôi phục lịch sử** | Không mất/nhân đôi câu hỏi; lỗi mạng giữ lại turn thất bại để người dùng bấm thử lại; dừng (`cancelChat`) chuyển sang `chatCancelled`; retry bảo toàn `provider`, `model`, `mode` và `sourceTarget`. | **ĐÃ HOÀN THÀNH** |

---

## 2. Chi tiết Kỹ thuật Các Thay đổi

### 2.1. P0.1 & P0.2 — Trạng thái Provider và Giao thức Ollama Cloud
- **Xác thực kết nối bằng Ping tối giản**:
  - Bổ sung phương thức `cloudChat.verify(model, { signal })` trong `server/ai/ollama.mjs`: gửi request kiểm tra tối giản `{"role": "user", "content": "Say OK"}` tới `/api/chat` với `options: { num_predict: 4 }`.
  - Endpoint mới: `POST /api/student/ai/verify` nhận `{ provider: 'ollama-cloud', model: string }` và trả về trạng thái thực tế:
    - `connected`: Kết nối và xác thực thành công.
    - `auth_required` (401): Người dùng chưa chạy `ollama signin`.
    - `rate_limited` (402): Hết lượt dùng/credits trên `ollama.com/plans`.
    - `model_missing` (404): Model không tồn tại trên cloud.
    - `disconnected`: Không kết nối được tới daemon Ollama tại loopback `127.0.0.1:11434`.
  - Cập nhật hàm `status()` của Ollama để trả về đối tượng `cloudStatus: { state, model, error }`.
- **Phân tích phản hồi JSON phòng thủ và Format Fallback**:
  - Trích xuất nội dung JSON từ khối markdown ```json ... ``` nếu model cloud tự động bọc code block.
  - Khi Ollama trả về lỗi 400 (do model cloud không hỗ trợ structured schema phức tạp), tự động fallback gọi lại với `format: 'json'` kết hợp hướng dẫn cấu trúc trong prompt.
- **Giao diện Chat UI (`CourseChat.tsx`, `LocalAIStatus.tsx`)**:
  - Trạng thái sẵn sàng (`ready`) đối với Ollama Cloud yêu cầu: daemon đang chạy VÀ kết nối cloud đã được kiểm tra (`cloudState === 'connected'`).
  - Khi chưa kiểm tra, UI hiển thị badge *"Ollama Cloud: Chưa kiểm tra kết nối"* kèm nút *"Kiểm tra kết nối"*.
  - Trước khi gửi câu hỏi thật kèm trích đoạn tài liệu của người học, nếu cloud chưa được xác minh, client tự động kích hoạt kiểm tra ping trước để bảo vệ dữ liệu.

### 2.2. P0.3 — Loại bỏ Citation Tự gắn và Kiểm tra Nguồn Nghiêm ngặt
- **Vấn đề trước đây**: Tại `server/ai/chat.mjs`, khi model trả về `basis: 'materials'` nhưng danh sách `sourceIds` rỗng, code cũ tự động gán `response.sourceIds = [context.sources[0].sourceId]`.
- **Khắc phục**: Đã loại bỏ hoàn toàn dòng gán nguồn nhân tạo này.
- **Hành vi mới**:
  - Khi model trả về `basis: 'materials'` mà không có trích dẫn nguồn thực tế, `validateTutorAnswer` trong `server/ai/context.mjs` sẽ bắt lỗi nghiêm ngặt và ném ngoại lệ `aiInvalidCitation`.
  - Turn chat chuyển sang trạng thái `failed` với mã lỗi `aiInvalidCitation` ("Model chưa trả về nguồn hợp lệ của môn học. Hãy thử lại câu hỏi.").
  - Tuyệt đối không lưu nguồn giả mạo vào cơ sở dữ liệu.

### 2.3. P0.4 — Tối ưu hóa Bộ máy Định vị Tài liệu & Trang (`targeting.mjs`)
- **Mở rộng nhận diện chương / bài**:
  - Bổ sung các tiền tố phổ biến: `(?:chương|chuong|chapter|chap|bài|bai|buổi|buoi|tuần|tuan|lecture|lab|part|section|sec)`.
- **Nhận diện tài liệu qua từ khóa tên file**:
  - Khi người dùng không nhắc đến số chương mà nhắc đến tên file (ví dụ: *"xem tài liệu Database trang 37"*), engine tách từ khóa phân biệt để tìm đúng file `Chuong_5_Database.pdf`.
  - Nếu có nhiều file cùng chứa từ khóa, engine báo `ambiguous: true` và liệt kê các file trùng để người dùng chọn cụ thể.
- **Chẩn đoán trang chi tiết**:
  - `pageOutOfRange`: Trang yêu cầu vượt quá số trang thực tế của tài liệu.
  - `ocrFailed`: Trang bị lỗi khi xử lý OCR ảnh.
  - `emptyPage`: Trang không có chữ nào (trang trống hoặc chỉ có hình chưa OCR).
  - `noChunks`: Trang chưa có đoạn văn bản nào được index.
  - Khi rơi vào các trường hợp trên, Tutor trả lời ngay với `basis: 'insufficient'` kèm giải thích rõ ràng, không gọi model AI.

### 2.4. P0.5 — Ổn định Quá trình Gửi, Dừng, Thử lại và Lịch sử Chat
- **Bảo toàn câu hỏi**:
  - Khi bấm Gửi, câu hỏi được hiển thị lạc quan (`optimisticTurn`) ở trạng thái `pending`.
  - Nếu gặp lỗi mạng hoặc dừng request, lượt chat được lưu giữ lại trong lịch sử dưới trạng thái `failed` kèm nút `Thử lại câu hỏi`, ngăn chặn việc mất câu hỏi của người học.
- **Nút Dừng trả lời (Stop)**:
  - Gọi API `POST /api/student/courses/:id/cancel` để hủy tiến trình xử lý trên server và abort controller ở client, cập nhật mã trạng thái thành `chatCancelled`.
- **Bảo toàn ngữ cảnh khi Retry**:
  - Lượt retry giữ nguyên `provider`, `model`, `mode` và `sourceTarget` (documentId và pageNumber) ban đầu.

---

## 3. Bằng chứng Kiểm thử (Unit Tests)

Bộ kiểm thử hoàn thiện tại `tests/unit/student-b5.test.mjs` bao phủ đầy đủ 5 tiêu chí P0:

1. `B5 P0.1: Provider status differentiates unverified, connected, auth_required and disconnected`: **PASS**
2. `B5 P0.2: Ollama Cloud verify and chat protocols with markdown parsing and format fallback`: **PASS**
3. `B5 P0.2: Ollama Cloud maps authentication, credit/rate limits and missing model errors`: **PASS**
4. `B5 P0.3: Model with missing citations is strictly rejected without synthetic citation injection`: **PASS**
5. `B5 P0.4: resolveSourceTarget handles chapter synonyms, filename keywords and diagnostics`: **PASS**
6. `B5 P0.5: CourseChat end-to-end retry preserves provider/model/target, and cancel marks chatCancelled`: **PASS**

### Kiểm tra Hồi quy Toàn bộ Project
- **76 tests passed, 0 failed, 1 skipped** (bài test Windows OCR phần cứng).
- TypeScript Typecheck (`tsc --noEmit`): **0 errors**.
- ESLint Check (`eslint src/`): **0 errors, 0 warnings**.

---

## 4. Hướng dẫn Vận hành Kiểm chứng

1. **Kiểm tra Ollama Local**:
   - Chạy `ollama serve` (hoặc mở ứng dụng Ollama trên máy).
   - Kiểm tra model local: `ollama list` có `qwen3:4b` và `embeddinggemma:latest`.
2. **Kiểm tra Ollama Cloud**:
   - Chạy `ollama signin` trên terminal để đăng nhập tài khoản Ollama.
   - Mở không gian môn học, vào tab Trò chuyện, chọn provider **Ollama · AI Cloud**.
   - Bấm nút **Kiểm tra kết nối** cạnh model được chọn (ví dụ `glm-5.3-flash:cloud`): hệ thống gửi test ping và chuyển sang trạng thái **Đã kết nối**.
   - Thử hỏi câu hỏi chỉ định trang: *"giải thích chương 1 trang 2"*: hệ thống định vị đúng trang 2 và trả lời có căn cứ trích dẫn cụ thể.
