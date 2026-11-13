# P3 — Study Logs and 12-Month Heatmap

## 1. Mục tiêu và Nguyên tắc triển khai

- **Mục tiêu**: Xây dựng hệ thống nhật ký học tập (Study Logs) cá nhân và biểu đồ trực quan hóa quá trình học 12 tháng (GitHub-like Heatmap) hoàn toàn offline, độc lập 100% với AI/Ollama.
- **Nguyên tắc thời gian**: Toàn bộ ngày học (`studyDate`) tuân thủ múi giờ `Asia/Bangkok` (UTC+7). Định dạng chuẩn `YYYY-MM-DD`.
  - Nghiêm cấm ghi nhận phiên học trong tương lai (`studyDate <= todayInBangkok`), trả về mã lỗi `futureDateNotAllowed`.
  - Cho phép ghi bổ sung / bù cho các ngày trong quá khứ.
- **Không áp đặt**: Không sử dụng streak hay phạt ngày nghỉ; màu sắc ô ngày chỉ phản ánh số lượng bản ghi thực tế, không đại diện cho "độ thành thạo" kiến thức.
- **Môn học tùy chọn**: Hỗ trợ ghi nhật ký không gắn với môn học nào (`courseId = NULL`) phục vụ học tiếng Nhật, đọc sách, nghiên cứu kỹ năng cá nhân.

---

## 2. Lược đồ CSDL và Migration (Migration 010)

Bảng `study_logs` được định nghĩa trong `server/student/migrations/010-study-logs-and-tasks.sql`:

```sql
CREATE TABLE study_logs (
  id TEXT PRIMARY KEY,
  studyDate TEXT NOT NULL,
  courseId TEXT REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  activityType TEXT NOT NULL CHECK(activityType IN ('read', 'assignment', 'review', 'practice', 'other')),
  durationMinutes INTEGER CHECK(durationMinutes IS NULL OR (durationMinutes >= 0 AND durationMinutes <= 1440)),
  learnedContent TEXT NOT NULL,
  difficulties TEXT,
  nextSteps TEXT,
  sourceTurnId TEXT,
  sourceConversationId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_study_logs_date ON study_logs(studyDate);
CREATE INDEX idx_study_logs_course ON study_logs(courseId);
```

- **Ràng buộc an toàn**: Khi xóa một khóa học (`courses`), các bản ghi nhật ký liên quan được giữ nguyên (`ON DELETE SET NULL`) thay vì bị xóa mất dữ liệu học tập lịch sử.
- **Backup trước migration**: `server/student/database.mjs` tự động tạo bản chụp SQLite snapshot (`VACUUM INTO backups/before-migration-10-...sqlite`) trước khi thực thi migration.

---

## 3. Kiến trúc API và Service

Tầng service được đóng gói trong `server/student/study.mjs` và tích hợp vào `server/student/service.mjs`:

### Endpoint HTTP:
- `GET /api/student/study-logs`: Liệt kê các bản ghi học tập (hỗ trợ lọc theo `courseId`, `studyDate`, `fromDate`, `toDate`, phân trang `limit`, `offset`).
- `POST /api/student/study-logs`: Tạo bản ghi mới. Kiểm tra chặn ngày tương lai, validate độ dài tiêu đề (1–120 ký tự), nội dung (tối đa 5000 ký tự), khó khăn & bước tiếp theo (tối đa 2000 ký tự).
- `GET /api/student/study-logs/summary`: Trả về dữ liệu heatmap liên tục 365+ ngày cho 12 tháng gần nhất, kèm thống kê `totalLogs`, `totalMinutes`, `activeDays`.
- `GET /api/student/study-logs/:id`: Xem chi tiết bản ghi.
- `PATCH /api/student/study-logs/:id`: Cập nhật bản ghi học tập.
- `DELETE /api/student/study-logs/:id`: Xóa bản ghi (có hộp thoại xác nhận trên giao diện).

### Tính toán mức độ hiển thị Heatmap (5 Levels):
- **Level 0**: 0 bản ghi (`#ebedf0`).
- **Level 1**: 1 bản ghi (`#9be9a8`).
- **Level 2**: 2–3 bản ghi (`#40c463`).
- **Level 3**: 4–5 bản ghi (`#30a14e`).
- **Level 4**: ≥6 bản ghi (`#216e39`).
Tooltip hiển thị chi tiết khi rê chuột: `Ngày · X bản ghi · Y phút`. Bấm vào ô ngày lọc danh sách bản ghi theo đúng ngày đó.

---

## 4. Tích hợp giao diện và Hội thoại Chat

- **Sidebar Navigation**: Thêm mục `Nhật ký học tập` (`view === 'logs'`).
- **Course Progress Tab**: Tại tab `Tiến độ` (`progress`) của từng môn học, hiển thị biểu đồ nhiệt và thống kê thời gian học riêng cho môn đó.
- **Ghi nhật ký từ Chat**:
  - Tại `CourseChat` và `StudyAssistant`, mỗi câu trả lời của AI trợ giảng đều có nút `📝 Ghi vào nhật ký`.
  - Mở form xem lại (Review Draft Modal) với các trường đã điền sẵn từ nội dung chat.
  - Người dùng có thể điều chỉnh thời gian, nội dung trước khi lưu thực sự. Xóa hội thoại chat **không làm mất** bản ghi nhật ký.

