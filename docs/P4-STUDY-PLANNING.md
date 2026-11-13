# P4 — Daily Study Planning and In-App Reminders

## 1. Mục tiêu và Nguyên tắc triển khai

- **Mục tiêu**: Xây dựng phân hệ lập kế hoạch học tập hàng ngày (Daily Study Planning) và nhắc nhở học tập trong ứng dụng (In-App Reminders) hoàn toàn chạy offline trên máy, không phụ thuộc vào AI/Ollama.
- **Tập trung vào hành động thực tế**:
  - Tách bạch rõ ràng 4 khu vực: **Việc quá hạn (Overdue)**, **Kế hoạch hôm nay (Today)**, **Sắp tới (Upcoming)**, và **Đã hoàn thành (Completed)**.
  - Sắp xếp công việc ưu tiên: Công việc quá hạn đưa lên đầu; việc cùng ngày sắp xếp theo mức độ ưu tiên (`high > medium > low`), sau đó theo giờ nhắc nhở (`plannedTime`).
- **Liên kết chặt chẽ Kế hoạch và Nhật ký (Task → Log Transaction)**:
  - Khi hoàn thành một công việc, hệ thống thực thi trong **một giao dịch SQLite duy nhất (single transaction)**: tạo mới (hoặc cập nhật) một bản ghi nhật ký học tập (`study_logs`), cập nhật trạng thái việc học thành `completed`, ghi nhận `completedAt` và liên kết `studyLogId`.
  - **Quy tắc vàng về thời gian**: Người dùng tự nhập thời gian học thực tế (`actualMinutes`). Hệ thống tuyệt đối **không tự sao chép** thời gian ước tính sang thời gian thực tế.
  - **Khả năng mở lại và hoàn thành lại**: Khi mở lại một việc học (`reopenTask`), bản ghi nhật ký đã tạo được bảo tồn nguyên vẹn. Khi bấm hoàn thành lại, hệ thống cập nhật đúng bản ghi nhật ký đã liên kết thay vì tạo bản ghi rác trùng lặp.
  - **Chống trùng lặp (Idempotency)**: Sử dụng `requestId` để tránh lặp giao dịch khi người dùng click nhanh hoặc mạng chập chờn.

---

## 2. Lược đồ CSDL và Migration (Migration 010)

Bảng `study_tasks` được định nghĩa trong `server/student/migrations/010-study-logs-and-tasks.sql`:

```sql
CREATE TABLE study_tasks (
  id TEXT PRIMARY KEY,
  courseId TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  plannedDate TEXT NOT NULL,
  plannedTime TEXT,
  estimatedDuration INTEGER CHECK(estimatedDuration IS NULL OR (estimatedDuration >= 0 AND estimatedDuration <= 1440)),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped')),
  completedAt TEXT,
  studyLogId TEXT REFERENCES study_logs(id) ON DELETE SET NULL,
  reminderDismissedAt TEXT,
  reminderSnoozedUntil TEXT,
  requestId TEXT UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_study_tasks_date ON study_tasks(plannedDate, status);
CREATE INDEX idx_study_tasks_course ON study_tasks(courseId);
```

- Khóa ngoại `studyLogId REFERENCES study_logs(id) ON DELETE SET NULL`: Khi người dùng xóa một bản ghi nhật ký, trường `studyLogId` trên task tự động chuyển về `NULL`, công việc không bị xóa hay phát sinh lỗi tham chiếu.
- Khóa ngoại `courseId REFERENCES courses(id) ON DELETE SET NULL`: Khi xóa môn học, việc học được giữ lại dưới dạng học cá nhân.

---

## 3. Kiến trúc API và Service

Các hàm xử lý P4 được triển khai trong `server/student/study.mjs` và mở qua `server/student/routes.mjs`:

### Endpoint HTTP:
- `GET /api/student/study-tasks`: Trả về danh sách công việc đã phân loại sẵn (`overdue`, `today`, `upcoming`, `completed`, `other`).
- `POST /api/student/study-tasks`: Tạo việc học mới với tính năng chống trùng lặp qua `requestId`.
- `GET /api/student/study-tasks/suggestions`: Cơ chế gợi ý kế hoạch hôm nay:
  - Gợi ý hoàn thành các việc quá hạn từ ngày hôm trước.
  - Gợi ý từ trường `nextSteps` (bước tiếp theo) của các bản ghi nhật ký gần nhất.
- `GET /api/student/study-tasks/:id`: Lấy chi tiết công việc.
- `PATCH /api/student/study-tasks/:id`: Cập nhật tiêu đề, ngày giờ, ước tính thời gian, độ ưu tiên, ghi chú.
- `DELETE /api/student/study-tasks/:id`: Xóa việc học khỏi kế hoạch.
- `POST /api/student/study-tasks/:id/complete`: Giao dịch hoàn thành việc học kèm tạo/cập nhật bản ghi nhật ký.
- `POST /api/student/study-tasks/:id/reopen`: Mở lại việc học về trạng thái `pending`.
- `POST /api/student/study-tasks/:id/reminder`: Xử lý hành động nhắc nhở:
  - `action: 'dismiss'`: Đánh dấu đã bỏ qua (`reminderDismissedAt = now()`), lưu bền vững vào SQLite.
  - `action: 'snooze'`: Hoãn nhắc nhở 15 phút (`reminderSnoozedUntil = now() + 15m`).

---

## 4. Cơ chế Nhắc nhở Trong Ứng Dụng (In-App Reminders)

- Thành phần `StudyReminderBanner` chạy trong tab đang mở, kiểm tra mỗi 30–60 giây.
- Điều kiện kích hoạt nhắc nhở:
  - Công việc có ngày thực hiện `plannedDate <= todayBangkok`.
  - Có giờ nhắc nhở `plannedTime` và thời gian hiện tại đã đến hoặc vượt quá `plannedTime`.
  - Công việc chưa hoàn thành (`status !== 'completed'`).
  - Chưa bị bấm "Bỏ qua" (`!reminderDismissedAt`) và không trong thời gian hoãn (`reminderSnoozedUntil <= now()`).
- Khi xuất hiện thanh banner nhắc nhở ở đầu trang, người dùng có 3 lựa chọn tức thì:
  1. **Hoàn thành**: Mở ngay modal hoàn thành để nhập thời gian thực tế và nội dung đã học.
  2. **Nhắc lại 15p**: Hoãn nhắc nhở thêm 15 phút, cập nhật trường `reminderSnoozedUntil` trong CSDL.
  3. **Bỏ qua**: Tắt thông báo cho công việc này trong ngày, lưu vào CSDL để không bị nhắc lại khi tải lại trang.

