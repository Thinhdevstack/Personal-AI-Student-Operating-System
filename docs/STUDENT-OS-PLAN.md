# Personal AI Student OS — khảo sát và kế hoạch

Khảo sát gốc trên commit `5c1e7bf`. Các mục kiến trúc ban đầu ghi lại baseline M1; cập nhật triển khai M3 và M4 ở mục 10–11. Hiện M1–M3 đã có trong lịch sử Git; M4 được triển khai local, M5 chưa làm. Runtime hiện yêu cầu Node >=22 và đã có OpenAI SDK/PDF.js.

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

## 10. Milestone 3 — Course Tutor

### Khảo sát M2 trước triển khai

Baseline `110793b` đã có PDF.js extraction, page-aware chunks, SQLite embeddings và OpenAI SDK 7.47.0. 13 test Student M1/M2 đạt trước khi sửa. Những lỗi ảnh hưởng trực tiếp M3 đã được xử lý:

- Gửi dimensions thật cho text-embedding-3 và xác thực vector trả về; ghi model/dimensions/version nhất quán.
- Retrieval loại model/version khác kể cả khi cùng dimensions, kiểm tra byte length, đọc BLOB không phụ thuộc alignment, chỉ dùng ready documents cùng course.
- `includeArchived` nay có hiệu lực; UI search và Chat opt-in khi người dùng mở đích danh môn lưu trữ.
- `server/env.mjs` load `.env*` bằng loader của Next trước khi tạo provider. API key không tự bật mock; offline phải bật `AI_OFFLINE_MODE=1` và có nhãn trên UI.

### File và kiến trúc

```text
server/env.mjs                         # startup env trước AI initialization
server/ai/config.mjs                   # AI config và context/output limits
server/ai/openai.mjs                   # embed + Responses chat, errors đã sanitize
server/ai/retrieval.mjs                # compatible vectors, scope và threshold
server/ai/context.mjs                  # bounded history/sources và citation validation
server/ai/chat.mjs                     # conversation, retry, lock và persistence
server/student/migrations/003-chat.sql # conversations, turns, messages
src/features/ai/types.ts
src/features/ai/api.ts
src/features/ai/CourseChat.tsx
tests/fixtures/student-pdf.mjs
tests/unit/student-m3.test.mjs
```

Các file hiện có sửa: `server/index.mjs` (import env), `server/student/{database,service,routes}.mjs`, `src/features/academic/{StudentWorkspace.tsx,api.ts}`, dictionaries Student en/vi, `src/styles/student.css`, `tests/e2e/student.spec.ts`, `playwright.config.ts`, `.env.example`, README và tài liệu này. Không thêm dependency.

Luồng: validated request → DB reservation → course-scoped retrieval → context builder → OpenAI Responses structured JSON → citation whitelist → commit assistant message + sources. Model mặc định `gpt-5-mini`, có thể đổi bằng `OPENAI_CHAT_MODEL`; phản hồi trả JSON khi hoàn tất, chưa streaming. Xem [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [embedding dimensions](https://developers.openai.com/api/reference/resources/embeddings/methods/create).

API mới, giữ nguyên group chat `/api/chat`:

- `GET /api/student/courses/:courseId/chat`: latest 40 turns, optional conversationId được kiểm tra scope.
- `POST /api/student/chat`: `{ courseId, message, requestId?, conversationId?, language?: "en"|"vi" }`. Request tối thiểu vẫn chỉ cần courseId/message; client dùng UUID requestId để retry idempotent. Client không được gửi role/history/system.

Một conversation cho mỗi course. Turn reservation trong SQLite transaction immediate + unique pending index bảo vệ giữa nhiều kết nối. Hai yêu cầu đồng thời nhận `chatBusy`; completed requestId được replay, payload khác nhận conflict. Retry giữ nguyên user message, chỉ cho failed turn mới nhất. Lease 120 giây cho request bị ngắt/restart; attemptId ngăn worker cũ ghi đè lượt retry. Failed turn không có assistant message giả. Course có conversation không được xóa như course trống; archive giữ toàn bộ dữ liệu.

### Context, nguồn và giới hạn

- Question tối đa 4.000 ký tự, 10 history messages/8.000 ký tự, top 5 chunks/12.000 ký tự; serialized context tối đa 28.000 ký tự; output tối đa 4.096 tokens và 16.000 ký tự. Đây là giới hạn ký tự bảo thủ, không phải token counting chính xác.
- Follow-up ngắn dùng thêm câu hỏi gần nhất khi retrieval, lấy từ DB của đúng conversation.
- Sources được backend gán S1…S5. Assistant chỉ được trả source IDs trong tập đó. Metadata hiển thị gồm documentId/name, page, chunkId/index; không gửi physical path hoặc embedding về chat UI. Citation filtering bảo vệ tính hợp lệ của ID, không tự chứng minh nội dung model luôn đúng.
- Plain-text output được React escape; không render raw HTML/Markdown. Document content được đặt trong context dạng dữ liệu không tin cậy, không có tool execution.
- Không có ready PDF: failed turn + lỗi rõ để người dùng upload/process rồi retry. Có ready PDF nhưng relevance thấp: model được yêu cầu báo thiếu căn cứ hoặc ghi rõ kiến thức chung, không gán nguồn giả. Cosine cutoff 0.25 là heuristic, chất lượng semantic thực cần đánh giá với dữ liệu/live embeddings.
- Archived course: xem history và hỏi tiếp khi mở đích danh course; không đưa archived vào Today/planning mặc định.
- Chế độ offline mô phỏng cả embeddings và answer, có nhãn rõ; muốn live phải đổi về 0 và xử lý lại tài liệu mock.
- Chưa có API key trong workspace lúc triển khai: chưa xác minh live OpenAI. Automated tests dùng injected/offline provider, không được tính là live test. Không triển khai Memory M4.

### Kết quả kiểm tra M3

- `npm run typecheck`, `npm run lint`: đạt.
- `npm test`: 171 test, 168 đạt, 3 skip sẵn có trên Windows; không lỗi. Có 10 test M3 mới cho scope, persistence, retry/lease/concurrency, provider config/errors, context/citations và HTTP guards.
- `npm run build`: đạt. Build kiểm tra E2E riêng ở `.next-e2e`; build production mặc định ở `.next`.
- Playwright Student + Office smoke: 8 đạt. Bổ sung lượt chạy Course Tutor riêng sau chỉnh recovery UI: đạt cả mất request trước server lẫn mất response sau khi server đã commit; không thêm message trùng. Có screenshot desktop/mobile và kiểm tra tiếng Việt/course isolation.
- `npm run smoke`: đạt trên Windows (server/page/hook/machine panel/installer dùng settings tạm).
- Static export tiếng Việt `/my-office/vi`: đạt từ bản copy source trong `data/tooling/m3-static`, không đụng artifacts production/E2E đang phục vụ. `/student` static vẫn giải thích cần server local.
- Live OpenAI: chưa chạy vì không có key. Cần kiểm tra một câu hỏi thật sau khi cấu hình key và process PDF bằng embeddings thật; không dùng kết quả offline để khẳng định chất lượng Tutor hoặc semantic search.

## 11. Milestone 4 — Memory V1

### Baseline và phạm vi

Baseline M3 `51e2f61` sạch, `feat/course-chat-m3` trùng tracking origin; main local ở `110793b`. 10 test M3 đạt trước triển khai. Tạo `feat/memory-m4` từ M3, không merge/commit/push theo yêu cầu. Loader env xác nhận chưa có API key nên không chạy live OpenAI. Không thêm dependency hoặc thay đổi API/model của provider.

M1: học kỳ/môn/PDF và persistence; M2: extraction/chunks/embeddings/retrieval; M3: scoped Tutor/citations/history/retry; M4: bộ nhớ chủ động. M5 Office adapter và learning progress chưa triển khai.

### Schema và API

- Migration mới `004-memory.sql`, không sửa migration cũ: `memories`, `memory_create_requests`, thêm JSON `chat_messages.memories` mặc định `[]` cho lịch sử cũ.
- Memory gồm id, scope, courseId, content, timestamps và optional sourceMessageId/sourceCourseId. Scope global bắt buộc courseId null; scope course bắt buộc courseId hợp lệ. FK/CHECK và triggers kiểm tra nguồn chat hoàn tất, thuộc đúng course; global từ chat vẫn giữ course nguồn, chỉ được tạo khi người dùng chọn global rõ.
- Tối đa 1.000 ký tự/note, 50 global, 100/course; payload HTTP tối đa 16 KiB như API Student. Course có memory hoặc được memory tham chiếu làm nguồn được bảo vệ khỏi delete-empty. Snapshot có `hasData` để UI vô hiệu hóa nút xóa.
- API đọc/sửa/xóa luôn có query `scope=global` hoặc `scope=course&courseId=<uuid>`; scope khác không sửa/xóa được memory. Scope/source là bất biến qua API edit.

| Method | Path | Payload/kết quả |
| --- | --- | --- |
| GET | `/api/student/memories?scope=...` | Danh sách đúng scope, mới nhất trước |
| POST | `/api/student/memories` | `{scope, courseId?, content, requestId, sourceMessageId?, sourceCourseId?}` |
| PATCH | `/api/student/memories/:id?scope=...` | `{content}` |
| DELETE | `/api/student/memories/:id?scope=...` | `{ok:true}`; lặp lại an toàn |

Reuse auth/host/same-origin guard. Create transaction immediate + UUID requestId/fingerprint chống double-click/retry qua nhiều connection. Cùng mã với payload khác báo conflict; retry sau edit không ghi đè nội dung mới; retry sau delete không hồi sinh note. Nội dung trùng trong cùng scope sau chuẩn hóa Unicode/khoảng trắng/chữ hoa trả note đã có; edit trùng báo lỗi. Receipts giữ ID và hash, không giữ nội dung; chưa có TTL/compaction nên tăng theo số lần lưu. Archive giữ notes; quản lý và chọn memory chỉ khi mở đích danh course, không có tác vụ tự chọn môn archived.

### Chọn memory và context

`server/ai/memory.mjs` quản lý CRUD và ranking. Global preferences luôn là ứng viên về cách học: tối đa hai, ưu tiên overlap rồi updatedAt/id. Course notes chỉ từ đúng course và cần ít nhất một token nội dung khớp câu hỏi; follow-up ngắn dùng thêm câu hỏi user trước như retrieval M3. Tokenizer chuẩn hóa dấu tiếng Việt, loại stop words en/vi. Đây là heuristic lexical, không hiểu từ đồng nghĩa, ngữ nghĩa hay dịch ngôn ngữ.

Tối đa sáu notes, 3.000 ký tự nội dung; giữ nguyên từng note để không cắt mất phủ định. Context builder lọc lại scope và giới hạn, rồi loại bớt notes cuối nếu serialized context vượt 28.000 ký tự. Nếu baseline question/history/PDF đã vượt giới hạn thì vẫn báo lỗi M3. Memory là untrusted data trong user payload, không nằm trong system instructions; không được ghi đè system/UI language, không có tools và không được coi là PDF evidence.

Chat lưu snapshot `{id, scope, courseId, content, updatedAt}` đúng tập thực sự đưa vào context tại thời điểm request. Backend không tự tuyên bố model đã sử dụng/tôn trọng từng note; UI ghi rõ “Bộ nhớ đã gửi cho trợ giảng”. Snapshot không tạo document citation. Sửa/xóa ảnh hưởng chọn note ở lần hỏi sau; chat cũ và snapshot giữ nguyên. Nội dung note có thể vẫn được nhắc trong answer cũ thuộc bounded history; xóa memory không xóa chat.

### UI và file

- `src/features/ai/MemoryWorkspace.tsx`: CRUD, modal có native focus containment, scope label, xác nhận xóa, giới hạn và error/retry. Create giữ request ID khi retry nguyên payload; thay nội dung/phạm vi tạo ID mới.
- Sidebar “Sở thích chung” (`?view=memory`); tab “Bộ nhớ” trong course (`?course=...&tab=memory`), giữ đúng view khi refresh.
- `CourseChat.tsx`: nút lưu từ completed message, review/edit form mặc định course; snapshot được hiển thị riêng PDF sources. React escape plain text; hỗ trợ en/vi và mobile.
- File server sửa: database registration, service CRUD/hasData/delete-empty, routes, context và chat persistence. File client sửa: workspace, types/API, dictionary en/vi, CSS. Không sửa 3D engine hoặc legacy `/api/chat`.
- Tests mới `tests/unit/student-m4.test.mjs`; E2E thêm vào `tests/e2e/student.spec.ts`.

### Kiểm tra M4

- `npm test`: 179 tests, 176 đạt, 3 skip có sẵn trên Windows, không lỗi. Tám test M4 kiểm tra CRUD/persistence, idempotency qua nhiều connection, validation/DB constraints, source ownership, ranking/budget/archive, chat snapshots, nâng cấp DB M3 và HTTP auth/origin/scope. Sau điều chỉnh cuối, chạy lại tám test M4 vẫn đạt.
- `npm run typecheck`: đạt sau khi khôi phục tsconfig gốc (Next build riêng tự thêm generated include, không đưa thay đổi đó vào bàn giao).
- `npm run lint`: đạt; lint lại các file thay đổi cuối đạt.
- `npm run build`: đạt cả output kiểm tra `.next-e2e` và production mặc định `.next`; không có server dùng artifacts đó trong lúc build.
- Playwright: 9 kịch bản Student/Office đạt qua lượt smoke và lượt chạy lại sau sửa. Năm Office smoke đạt; ba Student M1–M3 đạt cả trên production cuối; M4 E2E riêng đạt sau khi sửa label ô nội dung điền sẵn và cho test chờ history load trước khi đếm turns. Luồng bao gồm mất response khi save rồi retry không trùng, lưu từ chat đúng scope, edit/delete tác động context mới, snapshot cũ giữ nguyên, global dùng giữa hai môn và course isolation.
- Đã xem screenshot chat desktop, trang Memory và modal edit tiếng Việt 390px; không tràn ngang, không có uncaught page error. Các QA server đã dừng. Artifacts/logs chỉ ở thư mục ignored.
- Live OpenAI: chưa kiểm chứng vì không có key. Test chỉ chứng minh luồng chọn/truyền/lưu memory với injected/offline provider, không khẳng định chất lượng câu trả lời hoặc khả năng model thật tuân theo memory.
