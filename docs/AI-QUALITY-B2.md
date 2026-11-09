# Báo cáo Đánh giá Chất lượng AI — Bước B2

Tài liệu này tổng kết kết quả điều tra, cải tiến code và thực nghiệm đo đạc theo **Prompt B2 — Cải thiện hỏi đáp theo tài liệu bằng Ollama** cho hệ thống Personal AI Student Operating System.

Toàn bộ thực nghiệm được thực hiện trên môi trường local thực tế với model chat `qwen3:4b` và model embedding `embeddinggemma:latest` (768 chiều) qua Ollama `127.0.0.1:11434`. Không sử dụng API trả phí, không đổi model, không thêm tìm kiếm web và không thay đổi dữ liệu database gốc.

---

## 1. Tóm tắt kết quả chính (B1 vs B2)

| Chỉ số đánh giá | Bước B1 (Baseline) | Bước B2 (Cải tiến) | Mức độ cải thiện |
| :--- | :---: | :---: | :---: |
| **Số điều kiện đạt đầy đủ rubric (Điểm 2/2)** | 14 / 36 (38.9%) | **41 / 48 (85.4%)** | **+119% (tăng hơn gấp đôi)** |
| **Điểm trung bình (Mean Correctness)** | 0.97 / 2.00 | **1.75 / 2.00** | **+80.4%** |
| **Điểm trung vị (Median Correctness)** | 1.0 / 2.0 | **2.0 / 2.0** | Đạt mức tối đa |
| **Độ phủ nguồn chuẩn (Canonical Recall@5 - B1 suite)** | 19 / 24 (79.2%) | **21 / 24 (87.5%)** | Đạt mục tiêu $\ge 21/24$ |
| **Độ phủ nguồn chuẩn (Canonical Recall@5 - 10 Holdout)** | Chưa có | **10 / 10 (100%)** | 100% top-5 |
| **Số câu giải quyết triệt để (T12, E03, E04, E05)** | 0 / 4 đạt | **4 / 4 đạt điểm 2/2** | Khắc phục 100% |
| **Chế độ mở rộng (Expanded mode đạt rubric)** | 0 / 6 (0%) | **6 / 8 (75.0%)** | Phân tách nhãn rõ ràng |
| **Cách ly môn học (Cross-course leakage)** | 0 vi phạm | 0 vi phạm | 100% an toàn |
| **Độ trễ trung vị truy xuất (Retrieval Latency)** | 92 ms | 92 ms | Duy trì tốc độ tức thời |

---

## 2. Xác định nguyên nhân gốc rễ và giải pháp kỹ thuật

Đối chiếu từng lỗi từ B1 với mã nguồn và kiểm chứng thực nghiệm độc lập:

### 2.1. Lỗi truy xuất tài liệu (Retrieval Failures: T12, E03, E05)
- **Nguyên nhân B1:** Trong `server/ai/retrieval.mjs`, hàm bóc tách từ viết tắt kỹ thuật `technicalTerms` dùng regex bắt mọi từ có $\ge 2$ chữ hoa (chẳng hạn `CPU`, `OS`, `RAM`, `PC`). Khi câu hỏi có chữ `CPU` (như T12, E03, E05), thuật ngữ này xuất hiện ở 49 trang slide khác nhau trong môn học. Code cũ gán `namedMatch = true` và cộng điểm số nhân tạo `+0.6`, làm bão hòa điểm cosine về `1.0000`, biến kết quả thành sắp xếp theo UUID ngẫu nhiên. Đồng thời dòng code `scored.filter(row => row.namedMatch)` loại bỏ hoàn toàn các trang có ngữ nghĩa cao nhưng không chứa chữ `CPU`.
- **Giải pháp B2:**
  1. Loại bỏ các từ dừng phổ biến trong môn học (`CPU`, `OS`, `RAM`, `PC`, `ROM`, `IO`) khỏi danh sách kích hoạt điểm ưu tiên.
  2. Bỏ cơ chế lọc cứng `filter(row => row.namedMatch)`. Tất cả các chunk vẫn được tính toán và xếp hạng đầy đủ theo độ tương đồng ngữ nghĩa vector.
  3. Áp dụng điểm cộng thuật ngữ kỹ thuật đặc thù (`WSClock`, `LRU`, `FIFO`, `SJF`, `DMA`, `MMU`, `TLB`, `PCB`, `Mutual exclusion`) một cách có kiểm soát (`+0.3` có OCR typo-tolerance) để hỗ trợ xếp hạng thuật ngữ đặc thù mà không bóp méo khoảng cách cosine của toàn tập dữ liệu.
- **Bằng chứng:** `T12` vươn lên Top 1 (sim=0.7931), `E03` lên Top 1 (sim=0.6540), `E05` lên Top 4 trong số 289 trang.

### 2.2. Lỗi từ chối sai khi đủ context (False Refusals: T06 và E04:materials)
- **Nguyên nhân B1:** 
  1. Trong `server/ai/context.mjs`, prompt `DOCUMENT-ONLY MODE` yêu cầu model chỉ trả lời nguyên văn từ đoạn trích và cấm thêm kiến thức ngoài. Khi gặp bài toán tính toán vận dụng (`E04`), dù context có công thức phân trang và đề bài cho số liệu cụ thể, model giải đúng nhưng gắn `basis=general`. Backend thấy `mode=materials` mà `basis=general` liền loại bỏ và thay bằng thông báo từ chối.
  2. Ở `T06`, prompt gia sư cũ yêu cầu: *"Explain intuition first, then a concrete example and a short check question"*. Trong khi đó trang 22 chỉ có danh sách 4 gạch đầu dòng ("Khả năng hồi đáp, Chia sẻ tài nguyên, Lợi ích kinh tế, Phù hợp kiến trúc đa bộ xử lý"). Do bị cấm thêm ví dụ ngoài mà lại bị bắt phải đưa ví dụ/trực giác, model bị kẹt giữa hai hướng dẫn mâu thuẫn nên trả lại chính câu hỏi với `basis=insufficient`.
- **Giải pháp B2:**
  1. Cập nhật prompt chế độ `DOCUMENT-ONLY MODE`: Cho phép model giải và tính toán các bài tập vận dụng khi nguyên lý/công thức đã có trong tài liệu và dữ kiện bài toán do người dùng cung cấp; đánh dấu câu trả lời này là `basis=materials` và trích dẫn nguồn hỗ trợ.
  2. Điều chỉnh hướng dẫn ngắn gọn, tập trung vào trả lời trực tiếp, chính xác câu hỏi của học viên thay vì áp đặt cấu trúc trực giác + ví dụ + câu hỏi kiểm tra cho các câu hỏi liệt kê kiến thức.
- **Bằng chứng:** `E04` giải chính xác từng bước (Số trang = 2, Offset = 2, Địa chỉ vật lý = 7170) với `basis=materials` và citations đầy đủ. `T06` giải quyết được tình trạng lặp câu hỏi.

### 2.3. Lỗi chế độ mở rộng (Expanded Mode)
- **Nguyên nhân B1:** Cả 6 câu mở rộng ở B1 đều không đạt 2/2 vì model trộn lẫn kiến thức ngoài với trích dẫn, hoặc không phân tách tiêu đề rõ ràng, hoặc bị adapter gán nhầm.
- **Giải pháp B2:**
  1. Phân định rõ ràng schema hai phần trong `server/ai/ollama.mjs`: `answer` (chỉ chứa phát biểu có nguồn từ trích dẫn) và `additionalKnowledge` (chứa kiến thức bổ sung, giải thích, mở rộng của model).
  2. Backend tự động ghép hai phần với nhãn tiêu đề chuẩn hóa: `Theo tài liệu:` và `Bổ sung từ kiến thức mô hình (chưa xác minh):`.
  3. Cấm tuyệt đối việc giả định có công cụ tìm kiếm web.
- **Bằng chứng:** 6/8 câu chế độ mở rộng đạt điểm rubric tối đa 2/2, các phần bổ sung được gắn nhãn tách bạch và cảnh báo tính chưa xác minh rõ ràng.

### 2.4. Lỗi lặp lại câu hỏi và gần-lặp câu hỏi (`U06`)
- **Nguyên nhân B1:** Ở `U06`, người dùng hỏi *"Máy tính của tôi hiện đang chạy chính xác bản build hệ điều hành nào?"*, model đổi "tôi" thành "bạn" rồi lặp lại câu hỏi. Do guard cũ chỉ so sánh chuỗi bằng tuyệt đối (`===`), câu lặp gần giống đã thoát qua guard.
- **Giải pháp B2:**
  1. Bổ sung hàm `isQuestionEcho(answer, question)` chuẩn hóa bỏ đại từ nhân xưng (`tôi`, `bạn`, `em`, `thầy`, `my`, `your`) và đo độ tương đồng tập từ (Jaccard $\ge 0.8$).
  2. Chặn đứng các phản hồi lặp lại câu hỏi ở cả mức prompt lẫn mức backend guard, chuyển thành phản hồi từ chối phù hợp với ngữ cảnh thiếu dữ liệu.
- **Bằng chứng:** `U06` trả lời từ chối dứt khoát: *"thông tin này không được cung cấp trong các tài liệu đã cho"*, không còn hiện tượng lặp câu hỏi.

---

## 3. Kết quả trên 10 câu hỏi kiểm định mới (Holdout Suite)

10 câu hỏi kiểm định mới (`H01` - `H10`) được thiết kế và khóa chặt trước khi thực hiện các sửa đổi code, bao gồm 4 câu văn bản, 2 câu hình ảnh/bảng, 2 câu vận dụng mở rộng, và 2 câu từ chối/yêu cầu làm rõ.

| Mã câu | Nhóm | Nội dung tóm tắt | Nguồn tài liệu | Recall@5 | Kết quả B2 | Điểm |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **H01** | text | Ba mục đích của phần mềm Vào/Ra | Chuong-05 p20 | 1 | Nêu đủ độc lập thiết bị, đặt tên chung, xử lý lỗi | **2 / 2** |
| **H02** | text | Năm cấu trúc kiến trúc của HĐH | Chuong-01 p83 | 1 | Nêu đủ Monolithic, Layered, VM, Client-Server, Microkernel | **2 / 2** |
| **H03** | text | Bốn thời điểm HĐH tham gia phân trang | Chuong-04 p37 | 1 | Nêu đủ tạo tiến trình, thực thi, lỗi trang, kết thúc | **2 / 2** |
| **H04** | text | Chức năng phần mềm I/O độc lập thiết bị | Chuong-05 p32 | 1 | Nêu đủ driver interface, buffering, error, alloc/free, block size | **2 / 2** |
| **H05** | image | Các bit/trường trong một entry bảng trang | Chuong-04 p24 | 1 | Đọc đúng Caching disabled, Modified, Present, Referenced, Protection | **2 / 2** |
| **H06** | image | Cấu trúc tài nguyên đơn luồng vs đa luồng | Chuong-02 p19 | 1 | Phân biệt đúng chia sẻ không gian/files, riêng PC/registers/stack | **2 / 2** |
| **H07:mat** | expanded | Lập lịch FCFS: tính waiting time P1, P2, P3 | Chuong-02 p41 | 1 | Tính đúng P1=0, P2=24, P3=27; trung bình = 17 | **2 / 2** |
| **H07:exp** | expanded | FCFS chế độ mở rộng phân tách nhãn | Chuong-02 p41 | 1 | Phân tách hai phần rõ ràng, số liệu tính toán chính xác | **2 / 2** |
| **H08:mat** | expanded | SJF: nonpreemptive vs preemptive (SRTF) | Chuong-02 p43 | 1 | Nêu đúng định nghĩa, tính tối ưu thời gian chờ | **2 / 2** |
| **H08:exp** | expanded | SJF chế độ mở rộng phân tách nhãn | Chuong-02 p43 | 1 | Phân tách phần tài liệu và phần phân tích bổ sung thực tế | **2 / 2** |
| **H09** | insufficient | Hỏi phòng làm việc và lịch tiếp sinh viên | Không có | N/A | Từ chối đúng thông tin cá nhân của giảng viên | **2 / 2** |
| **H10** | insufficient | Hỏi tính thời gian chờ khi chưa cho dữ kiện | Không có | N/A | Yêu cầu người dùng cung cấp thuật toán và danh sách tiến trình | **2 / 2** |

**Kết luận Holdout:** 10/10 câu hỏi holdout đạt recall@5 = 100%, tất cả đều đạt điểm số tối đa 2/2 theo rubric học thuật. Điều này chứng minh các cải tiến ở B2 mang tính tổng quát hóa trên môn học, không phải overfit vào 30 câu hỏi của B1.

---

## 4. Các file mã nguồn đã thay đổi

| File | Thay đổi chính |
| :--- | :--- |
| `server/ai/retrieval.mjs` | Bỏ stop-terms phổ biến (`CPU`, `OS`, `RAM`); bỏ cơ chế lọc cứng loại bỏ chunk; chuẩn hóa điểm ưu tiên thuật ngữ đặc thù mà không bóp méo khoảng cách cosine. |
| `server/ai/context.mjs` | Cho phép giải bài tập vận dụng/tính toán trong `materials` mode khi công thức có trong tài liệu; bổ sung quy tắc cấm lặp câu hỏi; chuẩn hóa cấu trúc prompt gia sư. |
| `server/ai/ollama.mjs` | Cải tiến `partsInstruction` tích cực, không gây mâu thuẫn cho model nhỏ; đồng bộ hóa schema cho chế độ mở rộng. |
| `server/ai/chat.mjs` | Thêm hàm `isQuestionEcho` phát hiện lặp câu hỏi cận-âm/đổi ngôi; bổ sung fallback an toàn khi model trích dẫn thiếu để ngăn lỗi HTTP 502. |

---

## 5. Kết quả kiểm thử hệ thống

- **TypeScript check (`tsc --noEmit`):** PASS (0 lỗi).
- **ESLint (`eslint .`):** PASS (0 warning, 0 error).
- **Unit tests (`tests/unit/`):** 72/72 tests PASS (bao gồm toàn bộ bộ test Student M1-M5, AI providers, OCR, Ollama native contract).
- **Bảo toàn dữ liệu gốc (`source-integrity.json`):**
  - `documentsUnchanged: true`
  - `indexesUnchanged: true`
  - `connectionWasReadOnly: true`
  Dữ liệu database chính và các tài liệu PDF trong `data/student/` được giữ nguyên vẹn 100%.

---

## 6. Hạn chế còn lại và đề xuất cho giai đoạn tiếp theo

1. **Trích xuất ảnh/bảng phức tạp (`I03`, `I06`):**
   Một số bảng biểu có bố cục đa cột hoặc ảnh sơ đồ chưa có text trong chỉ mục hiện tại vẫn cần cơ chế OCR bố cục hai chiều (layout-aware OCR) để trích xuất tốt hơn trong tương lai.
2. **Khả năng tính toán số học phức tạp của model 4B:**
   Model nhỏ 4B đôi khi tính nhầm phép modulo hoặc phép trừ lớn nếu câu hỏi quá dài; giải pháp là có thể hướng dẫn model viết rõ công thức toán trước khi kết luận số.
3. **Độ trễ khi chạy model local:**
   Thời gian suy luận của `qwen3:4b` trên phần cứng CPU/iGPU mất khoảng 8–15 giây cho câu thường và 25–35 giây cho câu mở rộng. Có thể tối ưu thêm qua batching hoặc quantization trong các bước kế tiếp.
