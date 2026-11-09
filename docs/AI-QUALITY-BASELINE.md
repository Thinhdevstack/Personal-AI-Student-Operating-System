# AI quality baseline — Bước 1

## Phạm vi và cách đọc kết quả

Đánh giá khả năng hỏi đáp trên tài liệu thật bằng cấu hình Ollama hiện có. Giai đoạn này chỉ thêm công cụ đánh giá, kiểm thử công cụ, mẫu dữ liệu và báo cáo; không đổi prompt, model, OCR, chunking, embedding, retrieval hoặc giao diện production.

- Code được đo: commit `ea3ab369b3753e40035537c885181c6a698f6e1d`, nhánh `fix/local-ai-ocr-upload`.
- Dữ liệu: một môn, bốn PDF, 289 trang PDF; phạm vi chỉ là Hệ điều hành, không đại diện cho mọi môn.
- Model: `qwen3:4b`, `embeddinggemma:latest`, vector 768 chiều; Ollama `0.40.15`.
- Máy: Ryzen 5 6600H, RAM khoảng 16 GB, RTX 3050 Laptop 4096 MiB VRAM. Digest/định dạng model và driver được lưu trong artifact riêng.
- Ngày đánh giá: 2026-11-07, múi giờ Asia/Bangkok.
- Câu hỏi độc lập dùng lịch sử và memory trống trong database sao chép. Không đánh giá tác dụng của memory hoặc hội thoại nối tiếp trong mẫu này.

Unit/E2E thành công chỉ xác nhận công cụ/luồng hoạt động; không được thay cho điểm nội dung. Chấm nội dung do coding agent đối chiếu rubric và nguồn đã xác minh; chưa có giáo viên/người chấm độc lập xác nhận.

## Bộ câu hỏi và đáp án chuẩn

30 câu gốc: 12 câu lớp chữ, 6 câu ảnh/bảng, 6 câu mở rộng/vận dụng và 6 câu thiếu dữ kiện, mơ hồ hoặc ngoài phạm vi. Sáu câu mở rộng được chạy ở cả `materials` và `expanded`, tạo 36 điều kiện chính; bốn điều kiện được chạy lại, tổng 40 kết quả hoàn tất.

Nguồn chuẩn gồm lớp chữ PDF gốc và sáu trang ảnh/bảng đã render để kiểm tra trực tiếp. Mỗi câu lưu SHA-256 tài liệu, số trang PDF thực tế, số trang in trên slide, trích đoạn ngắn, ý đúng cần có, điều không được khẳng định và mức chắc chắn. Không dùng qwen3 để tạo đáp án chuẩn.

Phần ngoài tài liệu được đối chiếu với các nguồn học thuật gốc:

- [Carr và Hennessy — WSCLOCK](https://cseweb.ucsd.edu/classes/wi19/cse221-a/papers/carr81.pdf).
- OSTEP: [chính sách thay thế trang](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf), [lập lịch](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf), [phân trang](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf), [I/O](https://pages.cs.wisc.edu/~remzi/OSTEP/file-devices.pdf), [đồng thời và luồng](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf).

Ví dụ tính toán mới được kiểm tra độc lập từ dữ kiện đề; không nhận là ví dụ có sẵn trong slide. Trong chế độ Theo tài liệu, một câu vận dụng có thể giải bằng quy tắc trong nguồn và dữ kiện đề; không mặc định mọi câu thuộc nhóm mở rộng đều phải bị từ chối.

## Phương pháp đo

`scripts/ai-evaluation.mjs` mở database đầu vào chỉ đọc, dùng SQLite backup sang thư mục chạy riêng rồi sao chép PDF. Từng lượt gọi `createStudentRoutes` và `createStudentService` hiện tại qua HTTP loopback có khóa tạm. Công cụ chỉ đăng ký Ollama thật, không có đường gọi provider trả phí.

Wrapper đo provider/phase không thay đổi nội dung yêu cầu hoặc thuật toán. Sau lượt chat, truy xuất được phát lại với đúng query vector đã thu nhận để ghi top-5, không gọi thêm embedding. Lưu cả top-5 lẫn đoạn thực sự còn trong context sau giới hạn độ dài.

- **Extraction:** kiểm tra ý/thuật ngữ chuẩn có trong chỉ mục đang dùng; anchors là phép kiểm tra phụ, không đủ chứng minh bảng còn đúng hàng/cột.
- **Canonical-page hit:** nguồn chuẩn được chỉ định có trong top-5/context hay không. Nếu một trang khác cung cấp cùng thông tin, ghi nhận riêng khi chấm; không tự sửa bộ chuẩn để làm đẹp điểm.
- **Correctness 0–2:** 0 = sai cốt lõi/không hoàn thành câu có thể trả lời; 1 = đúng một phần hoặc thiếu ý; 2 = đáp ứng rubric theo chế độ. Câu thiếu dữ kiện được điểm 2 khi làm rõ/từ chối phù hợp.
- **Completeness 0–2:** chấm mức đáp ứng các ý của câu hỏi, riêng với độ đúng.
- **Source support 0–2:** 0 = nguồn không hỗ trợ hoặc mâu thuẫn; 1 = hỗ trợ một phần/nguồn thiếu chính xác; 2 = hỗ trợ các phát biểu cần căn cứ. Phần mở rộng được kiểm tra với nguồn học thuật và yêu cầu ghi nhãn, không giả thành nội dung slide.
- **Mode compliance:** có tự thêm kiến thức ở chế độ Theo tài liệu hoặc gán kiến thức model cho PDF không.
- **Appropriate refusal:** phân biệt từ chối đúng vì context thiếu với từ chối sai khi context có đáp án. Một câu có thể không hoàn thành do thiếu chữ ảnh dù model đã từ chối đúng theo context.
- **Thời gian:** đo phase truy xuất, gọi model và toàn HTTP. Lấy mẫu `/api/ps` trước từng call, lưu thời gian nạp model từ API native; không chủ động unload để tạo cold start. Có overhead nhỏ từ đo đạc và lấy trạng thái.
- **UI/API:** kiểm tra mã HTTP và payload khớp lịch sử lưu. Phần chạy model này không tự chứng minh trình duyệt render đúng hoặc không lag.

Mỗi lỗi có thể mang nhiều nhãn `extraction`, `retrieval`, `generation`, `UI-API`; chỉ gán khi có bằng chứng. Tất cả lượt lặp được giữ lại; không chọn lần tốt nhất.

## Kết quả

Đã hoàn tất và chấm **40/40 lượt**, gồm **36 điều kiện chính và 4 lượt lặp**. Bộ câu hỏi có chủ đích bao gồm các lỗi đã gặp và bài vận dụng khó hơn việc chép slide; các tỷ lệ sau không phải ước lượng độ chính xác cho mọi câu hỏi/mọi môn.

| Nhóm | Điều kiện chính | Đạt 2/2 | Đạt 1/2 | Đạt 0/2 | Trung vị tổng thời gian |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lớp chữ PDF | 12 | 10 | 0 | 2 | 9,40 giây |
| Ảnh/bảng | 6 | 2 | 1 | 3 | 5,28 giây |
| Mở rộng/vận dụng, chạy cả hai chế độ | 12 | 0 | 3 | 9 | 26,16 giây |
| Thiếu dữ kiện/mơ hồ/ngoài phạm vi | 6 | 2 | 3 | 1 | 4,22 giây |
| **Tổng** | **36** | **14** | **7** | **15** | **9,40 giây** |

Điểm trung bình 0,97/2. **14/36 điều kiện đạt đầy đủ rubric**; không cộng bốn lượt lặp để nâng số này. Riêng chế độ mở rộng có 6 câu, 0 câu đạt 2/2, 2 câu đạt 1/2 và 4 câu đạt 0/2. Một số từ chối trong chế độ Theo tài liệu là phù hợp với ngữ cảnh được cấp; điểm thấp về hoàn thành nhiệm vụ không tự động chứng minh model phải bịa để trả lời.

**Đọc và tìm nguồn:**

- Trang chuẩn nằm trong top-5 ở **19/24 câu gốc có nguồn** (79,2%). Tính cả hai chế độ của sáu câu so sánh: **22/30 điều kiện có nguồn** (73,3%). Đoạn chuẩn tìm được không bị rơi thêm bởi giới hạn context trong mẫu này.
- `I04` không trúng trang chuẩn của bảng nhưng một đoạn khác đã hỗ trợ ý chính. Vì vậy canonical-page miss không bị diễn giải thành mất mọi căn cứ; đánh giá câu trả lời vẫn cho đúng nội dung và ghi hạn chế nguồn riêng.
- Ba trong sáu trang ảnh có các anchors cần thiết trong chỉ mục; ba trang còn lại thiếu nội dung ảnh. Với hai PDF chưa được lập lại chỉ mục sau khi thêm OCR, đây là tình trạng chỉ mục hiện tại, chưa phải bằng chứng OCR mới không đọc được chúng.
- `I03` có các con số trong OCR nhưng cấu trúc bảng/bit bị suy giảm; model đọc sai ánh xạ. Sự hiện diện của từ khóa không đủ chứng minh hiểu đúng hình.

**Sinh câu trả lời:**

- `T06` và `E04:materials` tìm đúng và đưa nguồn vào context nhưng vẫn trả thiếu căn cứ. `T06` có đủ bốn ý trong đoạn đầu; output adapter chỉ lặp lại câu hỏi. Không phải thiếu API key.
- `I02` có đủ bảng nhưng bỏ một nửa đối tượng được hỏi.
- `E01` gán cơ chế thuật toán cho bảng chỉ có nhận xét, và có lỗi về xử lý trang bẩn. Có trích dẫn tồn tại không chứng minh các câu đều được trang đó hỗ trợ.
- `E02:expanded` chọn đúng nạn nhân ở cuối nhưng mô tả sai lần hit và đếm sai lỗi trang. `E04:expanded` có công thức nhưng tính sai số dư, dẫn tới địa chỉ cuối sai. Đây là lỗi nội dung/suy luận, không được chấm đạt vì trả lời dài.
- `U06` chỉ đổi đại từ rồi trả lại câu hỏi. Guard so sánh chuỗi tuyệt đối không nhận ra gần-lặp câu hỏi. Một số câu khác từ chối an toàn nhưng chỉ dùng thông báo chung, không nêu đúng dữ kiện còn thiếu hoặc giới hạn tìm web.
- Nhãn lỗi sau rà soát: extraction 4 điều kiện, retrieval 7, generation 15; có chồng lấp và không cộng thành số lỗi duy nhất. Extraction ở `I04` được ghi dù nguồn thay thế giúp câu đó trả lời đúng.

**Hiệu năng và vận hành:**

- 36/36 HTTP chính và 4/4 HTTP lặp trả 200; payload khớp lịch sử lưu, không có model timeout trong các lượt hoàn tất. HTTP 200 vẫn có thể chứa câu trả lời sai hoặc không hữu ích.
- Tổng thời gian chính: trung vị **9,40 giây**, khoảng **2,56–50,38 giây**. Phase truy xuất trung vị **0,077 giây**, khoảng **0,052–4,25 giây**. Gọi model trung vị **8,40 giây**, khoảng **2,46–50,26 giây**.
- Riêng 6 lượt chế độ mở rộng: tổng trung vị **27,50 giây**, khoảng **21,29–50,38 giây**.
- Trên 40 lượt, model chat không resident trước call ở 2 lượt: thời gian nạp native khoảng **8,43–8,45 giây**; 38 lượt resident có thời gian nạp trung vị khoảng **0,010 giây**. Đây là phân loại theo `/api/ps`, không phải benchmark khởi động máy hoặc xóa disk cache.
- Bốn lượt embedding chưa resident có thời gian nạp khoảng **3,35–3,89 giây**. Không suy ra mọi độ trễ là do GPU thiếu bộ nhớ; chưa làm thí nghiệm kiểm soát tải nền.
- Không phát hiện lấy nguồn khác môn, nhưng corpus chỉ có một môn nên đây không phải kiểm chứng đầy đủ về cách ly nhiều môn.
- Ba replay giao diện dùng câu trả lời thật đã đo: hiển thị nguyên văn, số liên kết nguồn và chế độ đúng, nút hỏi mở rộng đúng ở trạng thái thiếu căn cứ; không lỗi JavaScript hoặc thao tác ghi. Đã xem ảnh replay. Đây là **phát lại chỉ đọc**, không phải ba lượt inference mới trong browser hay phép đo FPS/3D.
- Metadata tài liệu, hash PDF và thông tin số lượng/namespace chỉ mục nguồn không đổi; source connection chỉ đọc. Kiểm thử công cụ riêng xác nhận history/memory/PDF đầu vào và resume được bảo toàn. Không đo lại tốc độ upload/OCR/reindex trong B1.

**Độ ổn định:** ba trong bốn cặp lặp giữ điểm; nhãn basis giữ nguyên ở cả bốn. `E01:expanded` thay đổi nội dung và giảm từ 1/2 xuống 0/2, trong khi vẫn trích cùng trang. Chỉ một cặp trùng nguyên văn; diễn đạt khác không tự động là lỗi. Mẫu bốn cặp quá nhỏ để kết luận thống kê về độ ổn định chung.

Một lượt chạy bị gián đoạn sau 19 kết quả hoàn tất. Process đánh giá không còn tồn tại, snapshot còn một turn pending nhưng không có phản hồi HTTP cuối; nguyên nhân chưa xác định. Đã lưu artifact riêng và tiếp tục theo run key, không chạy lại 19 lượt đã hoàn tất. Turn không có kết quả cuối không được gán thành model timeout hoặc dùng tính điểm/thời gian.

## Ưu tiên tiếp theo và phạm vi Bước 2

| Ưu tiên | Vấn đề và bằng chứng | Tác động | Ước lượng công sức |
| --- | --- | --- | --- |
| 1 | Sinh câu trả lời/tuân thủ nguồn: 15 điều kiện có vấn đề; có trường hợp context đủ vẫn từ chối, giải thích sai phép tính hoặc gán kiến thức ngoài cho nguồn | Người học có thể tin lời giải sai; đổi giao diện/đưa thêm web chưa giải quyết được | 6–10 giờ điều tra và thử nghiệm có kiểm soát |
| 2 | Truy xuất: 7 điều kiện thuộc 4 câu gốc bỏ nguồn cần thiết; canonical hit chỉ 19/24 câu có nguồn | Model không nhận được quy tắc để giải dù PDF có | 6–10 giờ |
| 3 | Chỉ mục/OCR: ba trang ảnh thiếu chữ, một hình có bố cục/bit suy giảm; chưa có provenance phiên bản extractor rõ trong chỉ mục | Trạng thái Sẵn sàng dễ bị hiểu thành đọc đủ mọi nội dung PDF | 6–10 giờ |
| 4 | Phản hồi không đủ căn cứ quá chung, gần-lặp câu hỏi lọt qua guard (`U06`) | Người dùng không biết thiếu nguồn, thiếu đầu vào hay model không đáp ứng | 2–4 giờ |
| 5 | Độ trễ mở rộng trung vị 27,5 giây và nạp model thêm vài giây | Cần trạng thái rõ và quản lý tải để tránh cảm giác treo | 3–5 giờ sau khi ổn chất lượng |

Đây là ước lượng công sức, không phải cam kết model sẽ đạt chất lượng học thuật sau số giờ cố định. Chưa đủ bằng chứng tách hoàn toàn ảnh hưởng của trọng số model, schema/hướng dẫn dài và ngữ cảnh gây nhiễu; không quy tất cả cho kích thước 4B.

**Bước 2 đề xuất thu hẹp vào chất lượng trả lời và truy xuất**, chưa thêm web/planner/3D:

1. Dùng lại những câu thất bại với đoạn nguồn chuẩn cố định để tách lỗi retrieval khỏi lỗi generation.
2. Thử thay đổi hướng dẫn/schema có kiểm soát trên cùng model, mỗi lần một biến; nếu vẫn không đạt mới so sánh cấu hình/model khác được người dùng chọn.
3. Đánh giá lại xếp hạng, từ khóa + ngữ nghĩa, định dạng embedding query/document và ngữ cảnh lân cận. Đây là các giả thuyết cần A/B, chưa phải nguyên nhân đã chứng minh.
4. Lập lại chỉ mục **trên bản sao** với OCR hiện tại cho các trang thiếu, đối chiếu hàng/cột/bit; sau khi có bằng chứng mới áp dụng bản thật và bổ sung provenance/coverage.
5. Chạy lại đúng suite này, giữ mọi kết quả và thêm khoảng 10 câu holdout để tránh chỉ sửa trúng 30 câu đã biết. Mục tiêu thử nghiệm: canonical hit ít nhất 21/24 câu có nguồn, hết hai từ chối sai khi context đủ, không gán cơ chế ngoài nguồn cho PDF, và ít nhất 4/6 câu mở rộng đạt rubric. Nếu không đạt, giữ giới hạn chức năng rõ thay vì công bố đã ổn.

Có thể bắt đầu bằng khoảng **12–20 giờ** cho ưu tiên 1–2 và đo lại; phần OCR/provenance là một hạng mục tiếp theo có tiêu chí riêng. Không có thay đổi production hoặc commit/push trong B1.

## Artifact riêng tư

Các file sau nằm trong `data/`, đã được Git bỏ qua; không commit PDF, nội dung trích xuất, ID môn học hoặc phản hồi thô:

```text
data/evaluations/baseline-2026-11-07/
  inventory/inventory.json
  inventory/<document-sha256>.json
  visual/<document-alias>/page-<n>.png
  suite.private.json
  run-01/
    manifest.json
    runtime-metadata.json
    results.jsonl
    reviews.json
    summary.json
    analysis.json
    source-integrity.json
    interruptions.json
    workspace/                 # database/PDF sao chép, không phải vùng học tập thật
    ui-replay/                 # ảnh và kết quả phát lại giao diện chỉ đọc
```

`results.jsonl` chứa context, nguồn, output adapter trước guard của chat, câu trả lời lưu/HTTP, metadata native và số liệu thời gian. Đây không phải log đầy đủ mọi byte raw của Ollama; nội dung đã bị adapter loại trước khi trả về không được khôi phục bằng đoán. Không đưa các artifact riêng tư này vào issue/PR công khai.

## Chạy lại

Cần Node 22, dependency của repo, server local và Ollama/model đã sẵn sàng. Không tự tải model. Lệnh yêu cầu chỉ rõ database, gốc storage, suite và output. Thay đường dẫn cho dữ liệu của bạn; `--documents` là thư mục chứa `documents/<id>/source.pdf`, không phải riêng một PDF.

```cmd
node scripts/ai-evaluation.mjs inventory --database "data/student/student.sqlite" --documents "data/student" --out "data/evaluations/new-baseline/inventory"
```

Tạo suite riêng theo `docs/examples/ai-evaluation-suite.example.json`, thay mọi placeholder và kiểm tra đáp án trước khi chấm. Dùng `group`: `text`, `image`, `expanded`, `insufficient`; nhóm mở rộng đặt `modes: ["materials", "expanded"]`. Ảnh/bảng cần `visualVerified: true` sau khi xem trang thật. Không dùng `gradingEligible: true` nếu đáp án ngoài tài liệu chưa được xác minh.

```cmd
node scripts/ai-evaluation.mjs render --pdf "DUONG_DAN_PDF_CAN_KIEM_TRA" --pages 1,2 --out "data/evaluations/new-baseline/visual"
node scripts/ai-evaluation.mjs run --database "data/student/student.sqlite" --documents "data/student" --suite "data/evaluations/new-baseline/suite.private.json" --out "data/evaluations/new-baseline/run-01" --runtime-url http://127.0.0.1:4312 --ollama-url http://127.0.0.1:11434 --context-size 8192 --timeout-ms 180000
```

Nếu gián đoạn, chạy lại nguyên lệnh `run` và thêm `--resume`. Công cụ từ chối resume khi commit, production digest, suite, cấu hình hoặc danh sách tài liệu không khớp. Giữ số liệu trước gián đoạn; ghi rõ turn chưa hoàn tất. Không build/đổi model hay chỉnh chỉ mục trong lúc đo.

Sau khi đọc/chấm từng câu trong `reviews.json`, ghi rõ người/công cụ chấm và lý do. `null` là chưa chấm, không được tính thành đúng; điểm ngoài 0–2 bị từ chối.

```cmd
node scripts/ai-evaluation.mjs summarize --run "data/evaluations/new-baseline/run-01"
node scripts/ai-evaluation-ui.mjs --run "data/evaluations/new-baseline/run-01" --runtime-url http://127.0.0.1:4312 --out "data/evaluations/new-baseline/run-01/ui-replay"
node --test tests/unit/ai-evaluation.test.mjs
```

Nếu Ollama chưa chạy, vẫn hoàn thành kiểm kê, render và bộ câu hỏi; không thay bằng mock rồi báo chất lượng đã đạt. Kiểm thử HTTP/isolation trong unit dùng fixture để chứng minh bảo toàn input/resume, không được tính vào 40 lượt model thật.
