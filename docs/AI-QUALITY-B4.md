# B4 — Báo Cáo Nghiệm Thu Ổn Định Upload, OCR và Lập Chỉ Mục Tài Liệu

> **Tài liệu tham chiếu:** Kế hoạch B4 — Đọc tài liệu ổn định, biết rõ AI đã đọc được gì  
> **Phiên bản Extractor:** `b4-v1`  
> **Môi trường runtime:** Node.js v22.14.0 LTS / Windows.Media.Ocr / Ollama Local  
> **Trạng thái:** Hoàn tất triển khai & đã kiểm thử 100% tự động.

---

## 1. Mục Tiêu & Bối Cảnh

Trước B4, pipeline xử lý tài liệu học tập gặp các vấn đề:
1. **Bỏ sót ảnh trên trang nhiều chữ:** OCR chỉ được kích hoạt nếu trang có ảnh và độ dài text dưới 250 ký tự. Các slide thuyết trình chứa nhiều bullet point text kèm biểu đồ/sơ đồ kiến trúc bị bỏ qua phần hình ảnh.
2. **Lỗi OCR làm sập toàn bộ tài liệu:** Khi 1 trang trong tài liệu 50 trang bị lỗi OCR (timeout hoặc hình ảnh dị dạng), toàn bộ tài liệu bị đánh dấu `failed`, mất toàn bộ chữ của 49 trang còn lại.
3. **Mất trạng thái khi restart:** Các tác vụ đang xử lý trong RAM bị treo hoặc mất dấu vết khi server dừng đột ngột.
4. **Trạng thái "Sẵn sàng" gây hiểu nhầm:** `indexReady` trước đây chỉ kiểm tra sự tồn tại của vector trong cơ sở dữ liệu mà chưa xác minh toàn bộ các chunk đã được nhúng vector đầy đủ.
5. **Thiếu thông tin đọc từng trang:** Người học không biết AI đã đọc được bao nhiêu trang, trang nào dùng OCR, trang nào rỗng hoặc lỗi.

---

## 2. Các Thay Đổi Kiến Trúc & Triển Khai

### 2.1. Cơ Sở Dữ Liệu & Migration 007
Đã bổ sung migration [`server/student/migrations/007-document-coverage.sql`](file:///server/student/migrations/007-document-coverage.sql):
- **Bảng mới `document_pages`:**
  - `documentId`, `pageNumber`: Khóa chính kết hợp.
  - `method`: Phương thức trích xuất (`native`, `ocr`, `combined`, `none`).
  - `status`: Trạng thái trang (`extracted`, `ocr_applied`, `ocr_failed`, `empty`).
  - `charCount`: Số lượng ký tự trích xuất được trên trang.
  - `warningCode`: Mã cảnh báo (`ocrPageFailed`, `emptyPage`).
  - `ocrLanguage`, `ocrEngine`: Thông tin provenance của bộ nhận diện OCR.
  - `extractedAt`: Dấu thời gian trích xuất.
- **Bảng `documents` được mở rộng:**
  - `coverageStatus`: Mức độ bao phủ (`full`, `partial`, `ocr_fallback`, `empty`, `unknown`).
  - `extractorVersion`: Ghi nhận phiên bản engine trích xuất (`b4-v1`).
  - `pagesWithText`: Số trang có văn bản sử dụng được.
  - `pagesOcr`: Số trang đã chạy OCR.
  - `pagesWarning`: Số trang phát sinh cảnh báo cần kiểm tra.

### 2.2. Trích Xuất PDF & OCR An Toàn (Resilient Pipeline)
- **OCR Engine Metadata:** Bổ sung `recognizePdfPageWithMeta` trong [`server/documents/ocr.mjs`](file:///server/documents/ocr.mjs) trả về cấu trúc `{ text, language, engine }`, tương thích ngược với API cũ.
- **Cách ly lỗi từng trang:** Trong [`server/documents/pdf.mjs`](file:///server/documents/pdf.mjs), nếu OCR ở trang $i$ ném lỗi hoặc timeout:
  - Giữ lại nguyên vẹn lớp chữ PDF gốc (nếu có).
  - Đánh dấu trang $i$ là `ocr_failed`, mã cảnh báo `ocrPageFailed`.
  - Tiếp tục xử lý bình thường cho các trang còn lại.
  - Nếu tài liệu còn ít nhất 1 trang có nội dung, tài liệu vẫn được lập chỉ mục và gán trạng thái `coverageStatus = 'partial'`. Chỉ khi toàn bộ tài liệu có 0 ký tự thì mới báo lỗi và giữ lại PDF để thử lại.
- **Đọc lại OCR chọn lọc (`forceOcrPages`):** Cho phép cưỡng bức chạy OCR trên danh sách trang cụ thể dù trang có nhiều hơn 250 ký tự text gốc.

### 2.3. Kiểm Tra Tính Đầy Đủ Của Chỉ Mục (`indexReady`)
Cập nhật logic `publicDocument` trong [`server/student/service.mjs`](file:///server/student/service.mjs):
```javascript
const totalChunks = doc.chunkCount ?? ...;
const embeddedChunks = ...; // Count chunk embeddings matching current provider, model, dimensions, modelVersion
const isIndexReady = totalChunks > 0 && embeddedChunks === totalChunks;
```
`indexReady` chỉ báo `true` khi và chỉ khi **100% chunk** của tài liệu đã được vector hóa đầy đủ với đúng provider/model hiện tại.

### 2.4. Phục Hồi Khi Server Khởi Động Lại
Khi khởi động lại server:
```sql
UPDATE documents
SET status = CASE WHEN EXISTS(SELECT 1 FROM document_chunks c WHERE c.documentId=documents.id) THEN 'ready' ELSE 'failed' END,
    processingError = 'processingInterrupted'
WHERE status = 'processing';
```
Các tác vụ dở dang được đánh dấu `processingInterrupted` mà không làm mất file gốc hay chỉ mục hợp lệ trước đó, cho phép bấm **Thử lại** mà không tạo duplicate chunk/vector.

### 2.5. Hàng Đợi Upload & Giao Diện Người Dùng
- **Hàng đợi không chặn:** Sửa [`src/features/academic/StudentWorkspace.tsx`](file:///src/features/academic/StudentWorkspace.tsx) sử dụng cơ chế hàng đợi bất đồng bộ `pendingUploads`. Người dùng có thể kéo thả 4 PDF, rồi thả tiếp 2 PDF nữa trong lúc hệ thống đang upload/xử lý.
- **Cách ly lỗi từng file:** Một file sai định dạng hoặc vượt quá 20 MiB sẽ hiển thị lỗi riêng, không làm dừng hay ảnh hưởng đến các file hợp lệ khác trong cùng đợt.
- **Tách biệt trạng thái:** Phân biệt rõ "Độ phủ chữ của tài liệu" (vd: `45/50 trang có chữ`, `3 trang OCR`, `2 trang cần kiểm tra`) với "Trạng thái chỉ mục hỏi đáp" (`Sẵn sàng` / `Chưa lập đủ chỉ mục`).
- **Modal "Chi tiết từng trang":**
  - Xem bảng danh sách toàn bộ trang: số trang, cách đọc, số ký tự, trạng thái, cảnh báo.
  - Checkbox chọn từng trang hoặc chọn tất cả.
  - Nút **"Đọc lại trang chọn bằng OCR"** gửi yêu cầu `POST /api/student/documents/:id/process` với body `{ pages: [...], forceOcr: true }`.
- **Hỗ trợ đa ngôn ngữ:** Hoàn thiện 100% bản dịch tiếng Việt (`vi`) và tiếng Anh (`en`).

---

## 3. Kết Quả Kiểm Thử

### 3.1. Bộ Kiểm Thử B4 Chuyên Sâu (`tests/unit/student-b4.test.mjs`)
Đã thiết kế 8 test case tự động bao phủ toàn diện các yêu cầu B4:
1. `B4: Per-page coverage and diagnostics are recorded accurately`: Kiểm tra bảng `document_pages` và `documents` lưu chính xác provenance từng trang. -> **PASS**
2. `B4: Single-page OCR failure does not crash whole document extraction`: OCR lỗi ở trang 2 không làm crash tài liệu, trang 1 & 3 vẫn được nhúng vector. -> **PASS**
3. `B4: Selective OCR reprocessing on chosen pages`: Đọc lại OCR trang đã chọn cập nhật đúng `combined` và tái cấu trúc vector. -> **PASS**
4. `B4: Strict indexReady checks complete chunk embedding count`: `indexReady` lập tức chuyển thành `false` nếu đổi model embedding hoặc số chiều vector. -> **PASS**
5. `B4: Interrupted processing recovery on service restart`: Server dừng giữa chừng ghi nhận `processingInterrupted`, retry thành công. -> **PASS**
6. `B4: Reprocess failure preserves previous index and chunks`: Lần reprocess sau thất bại vẫn giữ nguyên chỉ mục tốt trước đó. -> **PASS**
7. `B4: Course isolation in retrieval and document management`: Tìm kiếm môn A không rò rỉ tài liệu sang môn B. -> **PASS**
8. `B4: HTTP API GET pages and POST process with selective pages`: Endpoint API RESTful xử lý đúng payload JSON và tham số chọn trang. -> **PASS**

### 3.2. Toàn Bộ Test Suite Hệ Thống
- Chạy toàn bộ 53 bài kiểm thử unit tests (`student-m2`, `student-m3`, `student-m4`, `student-m5`, `student-demo`, `pdf-ocr`, `student-b4`):
  - **52 Passed, 0 Failed, 1 Skipped** (bài test gọi OCR thật của Windows được skip khi môi trường CI không có phần cứng hiển thị).
- **TypeScript (`tsc --noEmit`):** 0 lỗi.
- **ESLint:** 0 lỗi, 0 cảnh báo.

---

## 4. Hướng Dẫn Sử Dụng Tính Năng B4

### 4.1. Tải Lên Nhiều PDF
- Người học mở tab **Tài liệu** của môn học đang hoạt động.
- Kéo thả đồng thời nhiều file PDF (hoặc bấm nút **Thêm PDF**). Dung lượng tối đa 20 MiB/file.
- Có thể tiếp tục kéo thả thêm PDF mới ngay cả khi các file trước đang được lưu hoặc đang xếp hàng xử lý.

### 4.2. Xem Mức Độ Đọc Được Của Tài Liệu
- Mỗi tài liệu sau khi xử lý sẽ hiển thị:
  - Huy hiệu độ phủ: **Đầy đủ**, **Một phần**, hoặc **OCR ảnh**.
  - Tỉ lệ số trang có chữ: `X/Y trang`.
  - Số trang đã chạy OCR và số trang cảnh báo (⚠) nếu có.
  - Huy hiệu chỉ mục: **Chỉ mục hỏi đáp: Sẵn sàng**.

### 4.3. Xem Chi Tiết & Đọc Lại Bằng OCR Cho Từng Trang
- Bấm nút **Chi tiết từng trang** cạnh tài liệu.
- Trong hộp thoại xuất hiện:
  - Xem danh sách từng trang và phát hiện các trang có cảnh báo (ví dụ `ocrPageFailed` hoặc `emptyPage`).
  - Đánh dấu tích vào các trang có chứa hình ảnh/sơ đồ mà lớp chữ PDF chưa phản ánh hết.
  - Bấm nút **Đọc lại trang chọn bằng OCR**. Hệ thống sẽ chạy lại OCR riêng cho các trang này và tự động cập nhật chỉ mục tìm kiếm mà không làm gián đoạn các trang khác.

---

## 5. Giới Hạn Còn Tồn Tại & Định Hướng B5

1. **Khả năng nhận diện của OCR cục bộ:** Hệ thống sử dụng engine `Windows.Media.Ocr` của hệ điều hành. Khả năng nhận diện tiếng Việt phụ thuộc vào gói Language Pack đã cài đặt trên Windows của máy người dùng.
2. **Cấu trúc bảng biểu & sơ đồ phức tạp:** OCR hiện tại trích xuất văn bản phẳng theo dòng và cột dựa trên tọa độ bounding box; chưa phân tích ngữ nghĩa các mũi tên quan hệ hoặc cây phân cấp trong sơ đồ phức tạp.
3. **Chưa áp dụng reindex tự động lên dữ liệu thật:** Mọi kiểm thử được thực hiện trên database cô lập. Dữ liệu học tập cũ của người dùng được giữ nguyên trạng thái `unknown` cho đến khi người dùng chủ động bấm **Xử lý lại**.

---

## 6. Lệnh Git Gợi Ý

Theo đúng quy định an toàn, hệ thống **không tự ý commit hay push**. Dưới đây là các lệnh gợi ý để người dùng lưu lại thành quả B4:

```powershell
# 1. Kiểm tra các file đã thay đổi
git status

# 2. Thêm các thay đổi vào staging
git add server/student/migrations/007-document-coverage.sql
git add server/student/database.mjs
git add server/student/service.mjs
git add server/student/routes.mjs
git add server/documents/ocr.mjs
git add server/documents/pdf.mjs
git add src/features/academic/types.ts
git add src/features/academic/api.ts
git add src/features/academic/StudentWorkspace.tsx
git add src/i18n/locales/vi/student.js
git add src/i18n/locales/en/student.js
git add tests/unit/student-b4.test.mjs
git add tests/unit/student-m4.test.mjs
git add docs/AI-QUALITY-B4.md

# 3. Commit
git commit -m "feat(student): implement B4 resilient document upload, selective OCR and per-page coverage tracking"
```

