# Personal AI Student OS — khảo sát và kế hoạch

Khảo sát trên commit `5c1e7bf`. Chỉ triển khai Milestone 1 trong lượt này.

## 1. Kiến trúc thực tế

- `package.json`: Next 16.4.3, React 19.2.4, Three.js 0.160; Node >=20.9; không có ORM, SDK OpenAI hay PDF parser.
- `server/index.mjs`: HTTP server Node ESM (~3.400 dòng), nhận hook Claude, quản lý session, API, SSE `/stream`, rồi chuyển request trang cho Next. Không dùng Next API routes.
- `app/page.tsx`: ghép markup React cho văn phòng. `OfficeBoot.tsx` import `src/office/main.js` để khởi động engine một lần.
- `src/office/`: Three.js thuần, shared mutable state, module setup theo thứ tự; UI legacy tìm DOM bằng ID. Không phải React Three Fiber.
- Luồng: Claude hooks → server/session state → broadcast SSE (có live polling) → engine → workers, activity, animation. Event hiện tại mang semantics của Claude/session.
- `server/tasks.mjs`, `rewrite.mjs`: gọi Claude CLI. Codex account/quota integration không phải OpenAI API adapter cho Tutor.
- `/api/chat` đã là group chat; không thể thay endpoint này bằng Course Chat mà không phân luồng payload.
- Persistence hiện tại: JSON, JSONL, gzip trong `OFFICE_DATA_DIR`/`data/`. SQLite đọc bởi Antigravity là DB của ứng dụng ngoài, không phải DB domain nội bộ.
- Deployment chính là local Node server; GitHub Pages chỉ là static demo, không có API/upload/database.
- Test: `node --test`, Playwright, TypeScript, ESLint; CI Node 20/22 và smoke Windows/macOS/Linux.

## 2. Reuse và refactor

| Phần | Quyết định |
| --- | --- |
| 3D map, character, animation, navigation | Giữ nguyên `src/office/world`, `people`, `scene`, `core` |
| Project/Git/tool visualization | Giữ nguyên `server/git.mjs`, session flow và UI hiện tại |
| HTTP auth | Reuse host allow-list, loopback/PIN authorization và same-origin guard; đặt API mới sau kiểm tra host |
| Theme/font/i18n | Reuse CSS variables và `src/i18n`; thêm dictionary student en/vi |
| Chat UI legacy | Reuse ngôn ngữ thiết kế; không reuse controller đang gắn Claude/session |
| Backend lớn | Chỉ thêm điểm mount nhỏ; domain mới ở module riêng, không tái cấu trúc toàn server |
| Routing | Giữ `/`; thêm `/student`; dùng full-page navigation vì engine cũ không có teardown |
| Event | Domain event độc lập với DTO session; adapter sang SSE/3D ở M5 |

## 3. Database và storage

Chọn SQLite với `better-sqlite3`: phù hợp server local ESM và Node 20/22 hiện tại; tránh tăng Node minimum để dùng `node:sqlite`. Không thêm Prisma/Drizzle cho ba bảng đầu tiên.

- `data/student/student.sqlite`: metadata, foreign keys, migration version, transactions, WAL.
- `data/student/documents/<uuid>/source.pdf`: bytes; UI chỉ biết document ID/download URL.
- `semesters`: yêu cầu gốc + `isActive`; status active/archived khác với semester đang được chọn. Tối đa một semester `isActive=1`.
- `courses`: thuộc semester, status active/archived; archive semester archive các course trong transaction. Không tự unarchive course khi đổi semester hiện hành.
- `documents`: metadata theo yêu cầu + `sizeBytes`; M1 status `uploaded`, pageCount null. Không ghi `ready` khi chưa extract/index.
- Không xóa course có document; foreign key RESTRICT bảo vệ metadata. Những bảng M2–M4 phải bổ sung vào quy tắc này khi được thêm.
- Backup M1: dừng server rồi sao chép toàn bộ `data/student/` (bao gồm WAL nếu có); không chỉ copy file .sqlite đang mở.

## 4. Cấu trúc chính xác

```text
app/student/page.tsx
server/student/
  database.mjs
  migrations/001-academic.sql
  service.mjs
  routes.mjs
  storage.mjs
src/features/academic/
  types.ts
  api.ts
  StudentWorkspace.tsx
src/styles/student.css
src/i18n/locales/en/student.js
src/i18n/locales/vi/student.js
tests/unit/student.test.mjs
tests/e2e/student.spec.ts
scripts/start.mjs
docs/STUDENT-OS-PLAN.md
```

M2–M5 sẽ thêm khi cần, không tạo sẵn file rỗng:

```text
server/student/migrations/002-chunks.sql
server/documents/pdf.mjs
server/documents/chunking.mjs
server/ai/provider.ts                 # type contract, runtime vẫn ESM
server/ai/openai.mjs
server/ai/config.mjs
server/ai/retrieval.mjs
server/ai/context.mjs
server/ai/chat.mjs
server/ai/memory.mjs
server/ai/router.mjs
server/student/migrations/003-chat-memory.sql
src/features/ai/CourseChat.tsx
src/features/ai/MemoryWorkspace.tsx
src/shared/office-events.js
src/office/adapters/student-events.js
.env.example
```

Server logic ở `server/` theo convention thật, không đặt OpenAI/key/storage trong client `src/`. Course Chat có thể dùng `/api/student/chat`; nếu giữ `POST /api/chat` như brief thì dispatch `courseId/message` sang domain mới, giữ `{op,...}` của group chat. Chốt và test compatibility ở M3.

## 5. Dependencies

- M1: `better-sqlite3` (runtime, phiên bản tương thích Node 20/22). Upload binary PDF bằng Fetch/HTTP có giới hạn bytes, không cần multipart package.
- M2: PDF.js (`pdfjs-dist`) để extract theo trang; chọn bản tương thích Node minimum sau khi kiểm tra. Dùng OpenAI SDK cho embeddings khi bắt đầu semantic retrieval.
- M3: SDK `openai` nếu chưa thêm; config server-side `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`. Không chọn/hard-code model trước khi kiểm tra tài liệu tại thời điểm làm M3.
- M4/M5: dự kiến không cần package mới. Vector MVP: cosine trên embeddings scoped theo course sau interface RetrievalStore, không triển khai cluster.

## 6. Milestone và tiêu chí kiểm tra

1. **M1a persistence/API**: migration, semester create/rename/active/archive; course create/rename/archive/delete-empty; upload/download PDF. Test restart persistence, archive cascade, FK, invalid payload/upload/path/size.
2. **M1b UI**: `/student`, Today đơn giản, switch semester và Archived; course Overview/Materials/Chat/Progress. Chat/Progress ghi rõ chưa có. UI tạo semester → course → upload → reload thấy document. Giữ `/` và static demo build.
3. **M2 processing/retrieval**: uploaded → processing → ready/failed; page-aware chunks; embedding model/dimension/version đi cùng index; retry lỗi; course-scoped search, archived chỉ tìm khi được chỉ định.
4. **M3 Tutor**: OpenAIProvider, context builder, source citations, persistent scoped chat; lỗi key/rate limit/timeouts rõ; không gửi toàn PDF, coi document content là dữ liệu không tin cậy.
5. **M4 Memory V1**: save explicit, global preference/course memory, relevance filtering và context budget; không inject memory khác course/project.
6. **M5 Office adapter**: typed event contracts, library.search/memory.search/ai.respond qua adapter; animation subscribe, không đưa business logic vào 3D.

M1 chưa có AI requests, extraction, planner, assignments, quiz hay memory. Mỗi milestone phải qua kiểm tra trước khi tiếp tục.

## 7. File hiện có dự kiến sửa ở M1

- `server/index.mjs`: khởi tạo service, mount API sau host guard và trước legacy method gate.
- `src/components/office/TopBar.tsx`: link Student Workspace, ẩn ở static demo.
- `src/styles/topbar.css`: kiểu link trên topbar phù hợp theme.
- `src/i18n/locales/{en,vi}/index.js`: đăng ký dictionary.
- `package.json`, `package-lock.json`: SQLite dependency; sửa script start cho Windows nếu cần.
- `.gitignore`: bảo vệ `.env*`, giữ `.env.example`.
- `README.md`: đường dẫn workspace, persistence, giới hạn milestone.

## 8. Rủi ro cần giữ rõ

- Không mount React client state lên DOM legacy mà engine đang sửa.
- Không cho static GitHub Pages giả vờ upload thành công; workspace cần local server.
- Auth cũ là single-user local/PIN, không tự coi đó là multi-user ownership.
- Upload kiểm tra extension/MIME/header và giới hạn 20 MiB; structural parsing, encrypted/scanned PDF xử lý ở M2. File được tải xuống dạng attachment + nosniff, không thực thi tài liệu.
- Native SQLite dependency cần prebuilt binary hoặc compiler khi cài trên platform chưa hỗ trợ.
- Máy hiện không có node/npm trong PATH; dùng Node portable trong `data/tooling` (ignored) để kiểm tra, không sửa cài đặt hệ thống.

Tài liệu tham chiếu dependency: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md . Phân tích repo dựa trên checkout local, không chỉ README/demo.

## 9. Triển khai Milestone 1

Đã tạo đúng nhóm file M1 ở mục 4. Các file sửa hiện có nằm ở mục 7. `scripts/start.mjs` thay phép gán biến môi trường kiểu Unix bằng khởi động Node portable trên Windows. Không sửa engine `src/office/`, không đổi schema/event/session Claude và không thêm AI request.

API (chung lớp xác thực của My Office):

| Method | Path | Chức năng |
| --- | --- | --- |
| GET | `/api/student/snapshot` | Semester/course và tài liệu gần đây của học kỳ hiện hành |
| POST | `/api/student/semesters` | Tạo semester |
| PATCH | `/api/student/semesters/:id` | `rename`, `activate`, `archive` |
| POST | `/api/student/courses` | Tạo course |
| PATCH | `/api/student/courses/:id` | `rename`, `archive` |
| DELETE | `/api/student/courses/:id` | Chỉ xóa khi chưa có document |
| GET/POST | `/api/student/courses/:id/materials` | Liệt kê/upload PDF binary; tên file qua query `filename` |
| GET/HEAD | `/api/student/documents/:id/file` | Download attachment, không trả physical path |

Không cần key OpenAI ở M1. `data/` và `.env*` được git-ignore.

### Kiểm tra

- TypeScript và ESLint: đạt.
- Production Next build: đạt, có `/` và `/student`.
- Static export tiếng Việt với base path `/my-office/vi`: đạt; trang student chỉ thông báo cần local server.
- Unit tests: 154 tổng, 151 đạt, 3 skip sẵn có trên Windows, không lỗi. Bao gồm 6 test mới của Student domain/API.
- `npm run smoke`: đạt trên Windows, gồm server, page, hook, machine panel và installer dùng settings tạm.
- Playwright: 5 smoke test Office đạt (ba layout 3D, hook và ngôn ngữ); test Student đạt sau khi bổ sung forwarding `/student` trong custom HTTP server. Luồng tạo semester/course → upload/download PDF → reload → archive → reload được kiểm tra cùng desktop và viewport mobile 390px. Không có uncaught page error ở Student test.
- Module-map: code engine không thay đổi. Check nguyên bản báo lệch trên checkout `core.autocrlf=true`; check với CRLF chuẩn hóa trong bộ nhớ đạt. Không chỉnh file engine hay bảng module để che lỗi newline có sẵn này.

### Chạy trong workspace hiện tại

Máy chưa có Node trong PATH. Node portable đã tải và kiểm tra SHA-256 nằm trong `data/tooling`:

```powershell
$env:PATH = (Join-Path (Get-Location) 'data\tooling\node-v22.21.1-win-x64') + ';' + $env:PATH
npm.cmd start
```

Mở `http://localhost:4310/student?lang=vi`. Khi đã cài Node hệ thống, dùng `npm install`, `npm run dev` hoặc `npm run build` rồi `npm start` như bình thường.
