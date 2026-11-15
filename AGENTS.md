## **1\. Dự án này là gì**

* Tên dự án: \[Personal AI Student Operating System\]  
* Mục đích (1-2 câu): \[Web quản lí và theo dõi học tập \]  
* Người dùng cuối: \[ tôi \]  
* Trạng thái: \[ thêm tính năng mới \]

## **2\. Công nghệ đang dùng**

* Ngôn ngữ: \[**TypeScript** ,JavaScript, **Node.js ES Modules** , **SQL (SQLite dialect)**, **CSS3 / CSS Variables**  \]  
* Framework: \[Next.js, **React, [Node.js](http://Node.js), React DOM  Built-in HTTP & Native Server**  \]  
* Database: \[ **SQLite (thông qua `better-sqlite3`)**  \]

Không tự ý thêm thư viện, framework hoặc công cụ mới. Nếu thấy thật sự cần, hãy hỏi tôi trước và giải thích lý do.

## **3\. Cấu trúc thư mục**

```
├── app/                        # Định tuyến trang và giao diện theo App Router của Next.js
│   └── student/                # Màn hình chính của hệ điều hành học tập cá nhân (Student OS)
├── bin/                        # Tập tin thực thi dòng lệnh (CLI binary) khởi động ứng dụng
├── data/                       # Dữ liệu cục bộ và môi trường lưu trữ thực tế trên máy
│   ├── student/                # Cơ sở dữ liệu SQLite chính thức và kho lưu trữ PDF người dùng
│   ├── student-demo/           # Dữ liệu mẫu dùng riêng cho chế độ chạy mô phỏng (Demo mode)
│   └── evaluations/            # Kết quả đo lường và đánh giá chất lượng mô hình AI cục bộ
├── docs/                       # Tài liệu thiết kế, báo cáo kiểm thử và lộ trình phát triển (P1–P4)
│   ├── examples/               # Ví dụ mẫu về cấu hình và ngữ cảnh dữ liệu học tập
│   └── media/                  # Hình ảnh và ảnh động tài liệu minh họa tính năng
├── public/                     # Tài nguyên tĩnh phục vụ trực tiếp cho trình duyệt web
│   └── assets/                 # Hình ảnh, icon, âm thanh và font chữ dùng trong không gian 3D
├── scripts/                    # Các script Node.js hỗ trợ build, chạy dev và khởi động các chế độ
├── server/                     # Tầng backend phục vụ API native, xử lý tài liệu và tích hợp AI
│   ├── ai/                     # Quản lý kết nối nhà cung cấp AI (Ollama, OpenAI, Gemini), bộ nhớ và ngữ cảnh RAG
│   ├── documents/              # Xử lý trích xuất văn bản PDF, nhận diện chữ (OCR) và cắt đoạn (chunking)
│   ├── student/                # Dịch vụ nghiệp vụ học tập, cơ sở dữ liệu SQLite, migration và quản lý nhật ký / kế hoạch
│   └── platform/               # Các tiện ích hệ thống, bảo mật nguồn gốc request và tương thích đa nền tảng
├── src/                        # Mã nguồn giao diện người dùng (Frontend UI/Components)
│   ├── features/               # Các module chức năng chính (Học phần academic, AI trợ giảng, Nhật ký & Kế hoạch study)
│   ├── office/                 # Toàn bộ logic dựng hình không gian làm việc 3D (Three.js), bàn học và nhân vật
│   ├── components/             # Các thành phần giao diện dùng chung trong ứng dụng
│   ├── i18n/                   # Cấu hình và từ điển đa ngôn ngữ song ngữ (Tiếng Việt & Tiếng Anh)
│   └── styles/                 # Toàn bộ định kiểu CSS thuần (Vanilla CSS) và biến màu giao diện
└── tests/                      # Bộ kiểm thử tự động của dự án
   ├── unit/                   # Các bài kiểm thử đơn vị nhanh sử dụng Node.js Test Runner native
   ├── e2e/                    # Các bài kiểm thử đầu-cuối (End-to-End) trên trình duyệt với Playwright
   └── fixtures/               # Dữ liệu giả lập PDF và mock server phục vụ môi trường test

```

\[ Mô tả ngắn các thư mục quan trọng. Chỗ nào không được đụng thì ghi rõ. \]

## **4\. Lệnh thường dùng**

* Chạy dự án: `[ npm run dev ]`  
* Chạy test: `[ npm test ]`  
* Kiểm tra lỗi code: `[ npm run lint ]`

## **5\. PHẠM VI LÀM VIỆC (quan trọng nhất)**

* Chỉ làm đúng việc tôi yêu cầu trong tin nhắn hiện tại. Không làm thêm.  
* Chỉ sửa các file liên quan trực tiếp đến yêu cầu. Không refactor, đổi tên, hay dọn dẹp code ở nơi khác dù thấy chưa đẹp.  
* Nếu phát hiện vấn đề khác, chỉ báo cho tôi biết, không tự sửa.  
* Không xóa file, không đổi cấu trúc thư mục, không đổi cấu hình (package.json, .env, config) nếu tôi chưa đồng ý.  
* Không thêm tính năng "tiện thể" mà tôi không yêu cầu.  
* Nếu yêu cầu chưa rõ hoặc có nhiều cách hiểu, hỏi lại tôi trước khi viết code. Không tự đoán.  
* Với thay đổi lớn (sửa trên 3 file hoặc đổi cách hoạt động): hãy đưa kế hoạch trước, chờ tôi đồng ý rồi mới làm.

## **6\. Quy ước viết code**

* Theo đúng phong cách code đang có trong dự án, không áp phong cách riêng.  
* Đặt tên biến/hàm: \[tiếng Anh \]  
* Comment trong code: \[ tiếng Việt chỉ comment chỗ khó hiểu \]  
* Ưu tiên cách đơn giản, dễ đọc hơn cách thông minh nhưng khó hiểu.

## **7\. Cách trả lời tôi**

* Trả lời bằng tiếng Việt.  
* Tôi đang học, nên giải thích ngắn gọn: đã sửa gì, tại sao sửa vậy.  
* Không giải thích dài dòng lý thuyết nếu tôi không hỏi.  
* Sau khi làm xong, liệt kê các file đã thay đổi.

## **8\. Tuyệt đối không**

* Không ghi đè hoặc để lộ khóa API, mật khẩu, nội dung file `.env`.  
* Không chạy lệnh có thể xóa dữ liệu (rm \-rf, drop table...) khi chưa hỏi tôi.  
* Không giả vờ đã chạy test hoặc đã sửa xong khi chưa kiểm tra thật.

## **9\. Ghi chú riêng về dự án**

\[ **QUY TẮC CỐT LÕI CHO AI KHI PHÁT TRIỂN DỰ ÁN STUDENT OS**

1. **Phân biệt lộ trình:** Tập trung vào lộ trình hiện tại **P1–P4** (Student OS: Trợ lý học tập, Nhật ký & Kế hoạch). Không nhầm lẫn với các mốc cũ M1–M5 (Văn phòng 3D mô phỏng) hoặc B1–B5 (Thử nghiệm ban đầu). Không dùng `activity.mjs` (trạng thái 3D tạm thời) thay cho nhật ký học tập bền vững (`study_logs`).  
2. **Hoạt động 100% Offline (P3–P4):** Toàn bộ phân hệ Nhật ký học tập (P3), Biểu đồ Heatmap 12 tháng, Lập kế hoạch hôm nay (P4), Nhắc nhở và Gợi ý việc học PHẢI chạy hoàn toàn ngoại tuyến qua SQLite (`better-sqlite3`), tuyệt đối KHÔNG phụ thuộc hay tự ý gọi Ollama/LLM khi không cần thiết.  
3. **Chuẩn thời gian & Múi giờ:** Luôn dùng múi giờ `Asia/Bangkok` (UTC+7) qua hàm `getTodayInBangkok()`; không dùng `toISOString().slice(0, 10)` (giờ UTC gây lệch ngày). Nghiêm cấm ghi nhật ký vào ngày tương lai (`futureDateNotAllowed`), cho phép ghi bù ngày quá khứ. Môn học (`courseId`) là tùy chọn (hỗ trợ tự học tự do).  
4. **Liên kết Công việc & Nhật ký:** Khi hoàn thành việc (`completeTask`), người dùng phải tự nhập thời gian thực tế (`actualMinutes`), tuyệt đối không tự sao chép thời gian ước tính sang thực tế. Xóa môn học hoặc xóa chat KHÔNG ĐƯỢC xóa nhật ký (`ON DELETE SET NULL`).  
5. **Tính minh bạch của AI Provider:** Tách biệt rõ Ollama Local, Ollama Cloud và các API ngoài. Khi gặp lỗi kết nối/hạn mức, báo lỗi cụ thể để người dùng xử lý; không tự ý âm thầm chuyển đổi (fallback) nhà cung cấp.  
6. **Môi trường & Kỷ luật Git:** Dự án chạy trên Windows, gọi trực tiếp `node ...` hoặc `npm.cmd` để tránh lỗi PowerShell ExecutionPolicy. Tuyệt đối KHÔNG tự ý chạy `git commit` hay `git push` trừ khi người dùng yêu cầu rõ ràng.

 \]

