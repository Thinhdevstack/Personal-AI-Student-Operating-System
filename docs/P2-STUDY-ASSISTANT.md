# P2 — Personal study assistant

## Implemented behavior

The Student workspace now includes **Trợ lý học tập / Study assistant**. It supports creating, renaming, reopening and deleting conversations. Deletion requires confirmation in the UI and is rejected while a turn is pending. Existing course conversations remain separate; no artificial course is created.

Sources default to none. Select one or more active courses to retrieve materials. The server validates course membership and persists the sorted selected course IDs on every turn. Retrieval is performed separately within those courses and selected round-robin within the existing context budget. Source labels include course, PDF and page. Ambiguous page references ask for a PDF instead of silently selecting a result.

History is eligible for a prompt only when its stored source scope matches the current scope. Global preferences and relevant notes from selected courses are bounded by the shared memory budget. Unselected-course notes are excluded. The profile section uses existing global-memory CRUD for goals, self-described level, preferences and difficulties. Saving an answer as a note is explicit and confirmed; it does not establish mastery.

Generation, context budgets, citation validation and providers reuse existing AI modules. Local model configuration remains unchanged. Cloud is optional and subject to existing configuration; there is no automatic fallback. General knowledge is not web research. Provider output is escaped plain text.

## API and persistence

- `GET/POST /api/student/assistant`: list/create conversations; create requires a title of 1–120 characters.
- `GET/PATCH/DELETE /api/student/assistant/:id`: history, rename with `title`, and delete.
- `POST /api/student/assistant/:id/chat`: `message`, UUID `requestId`, `courseIds` (0–8), `language` (`vi/en`), `mode` (`materials/expanded`), optional `provider`.
- `POST /api/student/assistant/:id/cancel`: UUID `requestId`.

Routes use the same authorization, origin checks and bounded body reader as other Student APIs. Request fingerprints reject replay with changed content/provider/mode/scope. Completed replay performs no inference. Pending turns are preserved; a service restart marks them interrupted for retry. Failed earlier turns cannot be retried after newer turns exist.

Migration 009 adds `assistant_conversations` and `assistant_turns`, leaving course chat tables untouched. Opening an existing database with pending migrations first makes a consistent SQLite `VACUUM INTO` snapshot in its `backups/` directory. QA uses isolated storage, not the user's academic database.

## Verification and limits

- Unit fixtures verify scope validation, exclusion of unselected notes, fair multi-course retrieval, same-request replay, conflicts, cancellation/retry, persistence and deletion without deleting memories or creating courses.
- A Playwright scenario passed create/send/rename/reload/delete and mobile rendering using the Ollama HTTP fixture. This is protocol/UI coverage, not real-model quality evidence.
- An isolated production build and TypeScript check passed. Browser screenshots are in ignored test artifacts.
- Real local inference and the model comparison are recorded separately under ignored `data/evaluations/`; see P1 for quality findings. Code availability does not establish that a small local model reliably solves academic problems.
- The real local assistant smoke completed with qwen3:4b: no selected courses, a 30-minute study suggestion, general-knowledge label, no source citations, `isMock=false`. Its result is saved only in QA storage/artifacts.
- Migration testing simulates a version-8 database, confirms a backup is created, upgrades to version 9 and verifies existing global preferences survive.

Not implemented here: web search, schedules/reminders, study logs, flashcards, mind maps, code notebooks or a visual redesign. OS notifications are outside P2. Local model quality remains limited; verify important answers against sources. Unknown citation IDs are rejected, but source membership cannot prove every statement is correct.

## Running

From the repository, with Node 22 on PATH: `npm.cmd run dev:student-local`. Open `http://127.0.0.1:4312/student?lang=vi`, choose **Trợ lý học tập**, enter a title and create a conversation. Leave course boxes unchecked for general discussion, or select sources. Use the profile section to add/edit preferences. Restart an older server to load the new backend routes; migration backups occur automatically before schema changes.

The previously running server is not evidence that the new build has been activated. Browser QA launches separate fixture-backed processes. No commit, push or deployment is performed by this implementation.
