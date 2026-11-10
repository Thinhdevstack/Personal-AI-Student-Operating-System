# B5 — Tích hợp Ollama Cloud và Hoàn thiện Trải nghiệm Hỏi đáp Theo Trang / Tài liệu

## 1. Tổng quan triển khai

Giai đoạn B5 tập trung hoàn thiện trải nghiệm hỏi đáp học tập (Course Chat) với hai trọng tâm:
1. **Tích hợp Ollama Cloud thông qua dịch vụ Ollama local**:
   - Sử dụng tiến trình nền Ollama đang chạy trên máy (`http://127.0.0.1:11434`) để ủy quyền kết nối tới các model Ollama Cloud (tag `:cloud`, ví dụ `glm-5.3-flash:cloud`, `qwen2.5:cloud`, `deepseek-r1:cloud`, `llama3.3:cloud`).
   - Tái sử dụng cơ chế xác thực từ lệnh `ollama signin` của người dùng; server không can thiệp, không trích xuất và không lưu trữ token người dùng.
   - Không yêu cầu `OLLAMA_API_KEY` riêng cho đường kết nối này.
   - Thêm nhà cung cấp riêng `ollama-cloud` (Ollama · AI Cloud) trên giao diện tách biệt với `ollama` (Ollama · AI local).
   - Tách biệt embedding PDF trên máy (`embeddinggemma:latest` hoặc model local/cloud hiện tại); không reindex dữ liệu khi chuyển sang model chat cloud.
2. **Hỗ trợ hỏi đáp trúng tài liệu và số trang cụ thể (Targeted Q&A)**:
   - Cho phép người học hỏi tự nhiên (ví dụ: *"giải thích chương 1 trang 5"*, *"slide 2"*, *"trang 37"*) hoặc chọn tài liệu cụ thể trên giao diện.
   - Engine xác định tài liệu & số trang (`server/ai/targeting.mjs`) kiểm tra chặt chẽ số trang trong tài liệu (`pageCount`), chẩn đoán trang từ bảng `document_pages` (trang trống, lỗi OCR).
   - Khi vị trí được chỉ định không hợp lệ (vượt quá số trang, trang trống, OCR lỗi) hoặc tài liệu mơ hồ, hệ thống trả lời trực tiếp với `basis: 'insufficient'` kèm thông tin chẩn đoán trung thực, tuyệt đối không suy diễn / hallucination.
   - Khi hợp lệ, các chunk của trang mục tiêu được ưu tiên đặt đầu ngữ cảnh để model bám sát căn cứ.
3. **Cải thiện trải nghiệm Chat UX**:
   - Xóa sạch ô nhập câu hỏi ngay khi bấm gửi.
   - Hiển thị ngay lượt chat tạm thời (optimistic turn) ở trạng thái `pending`.
   - Khóa gửi tin nhắn trùng lặp trong khi request đang in-flight.
   - Hiển thị nút "Dừng trả lời" (Stop) để hủy request đang xử lý.
   - Hiển thị badge định vị tài liệu và số trang mục tiêu trực quan trên tin nhắn người dùng.
   - Chuyển môn học cô lập hoàn toàn ngữ cảnh chat, tài liệu và trạng thái giữa các môn.

---

## 2. Thay đổi chi tiết theo từng module

### 2.1. Cơ sở dữ liệu và Migration
- **File migration**: `server/student/migrations/008-ollama-cloud.sql`
  - Nâng cấp ràng buộc CHECK trên cột `provider` của bảng `chat_turns` để hỗ trợ `'ollama-cloud'`:
    ```sql
    CHECK (provider IN ('openai', 'gemini', 'deepseek', 'ollama', 'ollama-cloud', 'mock'))
    ```
  - Thêm cột `sourceTarget TEXT` vào `chat_turns` để lưu trữ thông tin định vị tài liệu / trang (dạng JSON: `{"documentId": "...", "documentName": "...", "pageNumber": 5}`).
- **Đăng ký migration**: Cập nhật `server/student/database.mjs` thêm `008-ollama-cloud.sql`.

### 2.2. Provider Ollama Cloud
- **File**: `server/ai/ollama.mjs`
  - Mở rộng regex validation tên model để chấp nhận ký tự `:`, cho phép các model gắn tag `:cloud`.
  - Thêm phương thức `cloudChat`:
    - Nhận động `context.model` theo lựa chọn của người học.
    - Ép định dạng JSON có cấu trúc (`format: json`) và schema câu trả lời Tutor (`TUTOR_FORMAT.schema`).
    - Bắt lỗi HTTP 401 từ daemon Ollama và ánh xạ thành mã lỗi `ollamaAuthRequired` (hướng dẫn người dùng chạy `ollama signin`).
    - Bắt lỗi HTTP 402 / credit từ daemon Ollama và ánh xạ thành mã lỗi `ollamaRateLimit` (hướng dẫn nạp thêm credits tại `ollama.com/plans`).
    - Bắt lỗi HTTP 404 và ánh xạ thành mã lỗi `ollamaModelMissing`.
- **File**: `server/ai/providers.mjs`
  - Đăng ký `ollama-cloud` vào danh sách `ids` và bảng nhãn hiển thị `LABELS`: `'Ollama · AI Cloud'`.
  - Thêm danh sách model cloud mặc định `DEFAULT_CLOUD_MODELS`:
    - `glm-5.3-flash:cloud`
    - `qwen2.5:cloud`
    - `deepseek-r1:cloud`
    - `llama3.3:cloud`
  - Cho phép cấu hình danh sách model cloud qua biến môi trường `OLLAMA_CLOUD_MODELS`.
  - Xuất `cloudModels` trong `registry.settings()` để frontend render dropdown cho người dùng tự do lựa chọn.

### 2.3. Bộ máy định vị Tài liệu & Trang (Targeting Engine)
- **File mới**: `server/ai/targeting.mjs`
  - Hàm `resolveSourceTarget({ db, courseId, message, explicitTarget, lang })`:
    1. Trích xuất số trang từ `explicitTarget.pageNumber` hoặc từ câu hỏi tiếng Việt/Anh (`trang 37`, `slide 12`, `page 4`, `p. 15`).
    2. Trích xuất tài liệu từ `explicitTarget.documentId` hoặc nhận diện theo mẫu chương / bài (`chương 1`, `chuong 2`, `chap 3`) đối chiếu với tên file PDF.
    3. Xử lý trường hợp mơ hồ (`ambiguous`): nếu nhiều file cùng khớp một chương, trả về giải thích yêu cầu chọn file cụ thể.
    4. Kiểm tra biên trang: nếu `targetPage > pageCount`, báo lỗi vượt quá số trang (`pageOutOfRange`).
    5. Kiểm tra chẩn đoán trích xuất từ bảng `document_pages`:
       - Nếu trang bị `ocr_failed`, giải thích trung thực lỗi OCR trang đó (`ocrFailed`).
       - Nếu trang trống (`empty` hoặc `charCount === 0`), giải thích trung thực trang không có chữ (`emptyPage`).
    6. Truy vấn các chunk thuộc đúng trang mục tiêu và trả về `pageChunks` có `score = 1.0`.

### 2.4. Tích hợp Chat Service
- **File**: `server/ai/chat.mjs`
  - Đọc `sourceTarget`, `model`, `documentId`, `pageNumber` từ request gửi lên.
  - Gọi `resolveSourceTarget`:
    - Nếu câu hỏi chỉ định một trang cụ thể nhưng trang đó bị lỗi, trống, hoặc ngoài phạm vi: trả về ngay tin nhắn của Tutor với `basis: 'insufficient'` giải thích lý do cụ thể mà không cần gọi model AI, tránh lãng phí token và tránh sinh câu trả lời bịa đặt.
    - Nếu hợp lệ: các chunk của trang mục tiêu được đưa lên đầu danh sách trích đoạn tài liệu (`retrievedResults`), đảm bảo model trả lời bám sát đúng nội dung trang yêu cầu.
  - Truyền `context.model = claimed.model` vào provider để gọi chính xác model cloud người dùng đã chọn.
  - Lưu trữ `sourceTarget` vào bảng `chat_turns` và trả về trong `history()` để hiển thị lịch sử và hỗ trợ replay/retry.

### 2.5. Giao diện người dùng (Frontend)
- **Files**:
  - `src/features/ai/types.ts`: Bổ sung `'ollama-cloud'` vào `ChatProviderId`, bổ sung `cloudModels?: string[]` vào `AISettings`, bổ sung interface `SourceTarget` và trường `sourceTarget` vào `ChatTurn`.
  - `src/features/ai/api.ts`: Bổ sung `model`, `documentId`, `pageNumber`, `sourceTarget` vào `ChatRequest`.
  - `src/features/academic/StudentWorkspace.tsx`: Truyền danh sách `courseMaterials` vào `<CourseChat />`.
  - `src/features/ai/CourseChat.tsx`:
    - Xóa `input` ngay khi submit form.
    - Thêm `optimisticTurn` để hiển thị ngay lập tức câu hỏi của người dùng và trạng thái `Đang tìm và đọc tài liệu…`.
    - Thêm dropdown chọn Cloud Model khi provider là `ollama-cloud` (người dùng chọn `glm-5.3-flash:cloud`, `qwen2.5:cloud`, v.v.).
    - Thêm dropdown chọn tài liệu mục tiêu (`Tài liệu mục tiêu`: Tất cả tài liệu hoặc từng file PDF cụ thể).
    - Hiển thị badge `🎯 Tài liệu mục tiêu: [Tên file] · Trang [X]` trên tin nhắn của người dùng.
    - Hiển thị nút "Dừng trả lời" (Stop) khi câu hỏi đang xử lý.
  - `src/i18n/locales/vi/student.js` & `src/i18n/locales/en/student.js`: Bổ sung đầy đủ nhãn ngôn ngữ và thông báo lỗi liên quan đến Ollama Cloud và targeting.

---

## 3. Kết quả Kiểm thử (Unit & Regression Tests)

Hệ thống đã chạy và vượt qua 100% các bài test liên quan:

1. **Test B5 mới (`tests/unit/student-b5.test.mjs`)**:
   - `B5: Ollama Cloud provider is registered separately from Ollama Local`: **PASS**
   - `B5: Ollama Cloud chat passes dynamic model and parses responses`: **PASS**
   - `B5: Ollama Cloud maps authentication, credit/rate limits and missing model errors`: **PASS**
   - `B5: resolveSourceTarget extracts page and chapter patterns and validates against documents`: **PASS**
   - `B5: CourseChat end-to-end persists sourceTarget and model, and handles targeted questions`: **PASS**
   - Tổng kết: **5/5 PASS** (0 FAIL).

2. **Test hồi quy (Regression Tests)**:
   - `tests/unit/ai-providers.test.mjs`: **12/12 PASS**
   - `tests/unit/student-demo.test.mjs`: **5/5 PASS**
   - `tests/unit/student.test.mjs`: **6/6 PASS**
   - `tests/unit/student-b4.test.mjs`: **8/8 PASS**
   - `tests/unit/student-m2.test.mjs` đến `student-m5.test.mjs` và `pdf-ocr.test.mjs`: **39/39 PASS** (1 skip test Windows OCR thực tế)

3. **Kiểm tra mã nguồn**:
   - TypeScript compilation (`tsc --noEmit`): **0 errors**
   - Linter (`eslint src/`): **0 warnings / 0 errors**

---

## 4. Hạn chế và Lưu ý Vận hành

1. **Xác thực Ollama Cloud**:
   - Nếu máy chưa đăng nhập Ollama, khi gọi `ollama-cloud` hệ thống sẽ báo lỗi `ollamaAuthRequired`. Người dùng cần mở terminal và chạy:
     ```bash
     ollama signin
     ```
   - Nếu tài khoản hết credits hoặc chưa đăng ký gói sử dụng cloud của Ollama, dịch vụ sẽ báo lỗi `ollamaRateLimit` và hướng dẫn kiểm tra tại `https://ollama.com/plans`.
2. **Cô lập Local vs Cloud**:
   - Việc gọi model Ollama Cloud chỉ gửi câu hỏi, memory liên quan, lịch sử ngắn và các đoạn trích PDF tìm thấy; không gửi toàn bộ file PDF lên cloud.
   - Quá trình chunking và tạo vector embeddings của tài liệu hoàn toàn diễn ra trên máy local thông qua model embedding đã cấu hình (ví dụ `embeddinggemma:latest`).
3. **Phạm vi Claude API**:
   - Theo quyết định Phương án A, không tích hợp Claude API hoặc tái sử dụng token Claude Code trong giai đoạn B5, giữ danh sách provider tối giản và an toàn.

