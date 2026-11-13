'use client';
import { useEffect, useRef, useState } from 'react';
import { request, apiUrl } from '@/features/academic/api';
import type { Course } from '@/features/academic/types';
import type { AISettings, ChatProviderId, ChatSource } from './types';
import MemoryWorkspace from './MemoryWorkspace';
import StudyLogDraftModal, { DraftLogData } from '@/features/study/StudyLogDraftModal';

type Attempt = { requestId: string; message: string; courseIds: string[]; language: 'vi' | 'en'; provider: ChatProviderId; mode: 'materials' | 'expanded' };
type Turn = Attempt & { id: string; scope: string[]; status: string; errorCode?: string; model?: string; answer: { answer: string; basis: string; sources: ChatSource[] } | null };
type Thread = { id: string; title: string; turns: Turn[] };
export default function StudyAssistant({ lang, courses }: { lang: string; courses: Course[] }) {
  const vi = lang === 'vi';
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [provider, setProvider] = useState<ChatProviderId>('ollama');
  const [scope, setScope] = useState<string[]>([]);
  const [mode, setMode] = useState<'materials' | 'expanded'>('expanded');
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [draftLog, setDraftLog] = useState<DraftLogData | null>(null);
  const controller = useRef<AbortController | null>(null);

  function openDraftLog(turn: Turn) {
    setDraftLog({
      courseId: turn.scope.length === 1 ? turn.scope[0] : null,
      title: turn.message.slice(0, 100),
      learnedContent: turn.answer?.answer || '',
      activityType: 'review',
      sourceTurnId: turn.id,
      sourceConversationId: thread?.id,
    });
  }
  const current = useRef<string | null>(null);
  const mounted = useRef(false);
  const json = (body: object) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    Promise.all([request<{ id: string; title: string }[]>('assistant', { signal: abort.signal }), request<AISettings>('ai', { signal: abort.signal })]).then(([list, config]) => {
      if (!abort.signal.aborted) { setThreads(list); setSettings(config); setProvider(config.defaultProvider); }
    }).catch((err) => { if (!abort.signal.aborted) setError(String(err.message)); });
    return () => { mounted.current = false; abort.abort(); controller.current?.abort(); };
  }, []);
  async function select(id: string) {
    current.current = id; setAttempt(null); setError(''); setScope([]); setThread(null);
    try { const result = await request<Thread>(`assistant/${id}`); if (mounted.current && current.current === id) { setThread(result); setTitle(result.title); } }
    catch (err) { if (mounted.current) setError((err as Error).message); }
  }
  async function manage(action: 'create' | 'rename' | 'delete') {
    if (busy) return;
    if (action === 'delete' && !window.confirm(vi ? 'Xóa hội thoại này?' : 'Delete this conversation?')) return;
    setBusy(true); setError('');
    try {
      if (action === 'create') { const created = await request<Thread>('assistant', { method: 'POST', ...json({ title: title.trim() || (vi ? 'Hội thoại mới' : 'New conversation') }) }); await select(created.id); }
      else if (thread) {
        if (action === 'rename') setThread(await request<Thread>(`assistant/${thread.id}`, { method: 'PATCH', ...json({ title }) }));
        else { await request(`assistant/${thread.id}`, { method: 'DELETE' }); setThread(null); current.current = null; }
      }
      setThreads(await request('assistant'));
    } catch (err) { setError((err as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function send(next: Attempt) {
    if (!thread || busy) return;
    const id = thread.id; setBusy(true); setError(''); setAttempt(next); setMessage('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const result = await request<Thread>(`assistant/${id}/chat`, { method: 'POST', ...json(next), signal: abort.signal });
      if (mounted.current && current.current === id) { setThread(result); setAttempt(null); }
    } catch (err) {
      if (mounted.current && current.current === id) {
        setError(abort.signal.aborted ? (vi ? 'Đã dừng yêu cầu.' : 'Request stopped.') : (err as Error).message);
        try { const saved = await request<Thread>(`assistant/${id}`, { signal: AbortSignal.timeout(5000) }); if (mounted.current && current.current === id) { setThread(saved); if (saved.turns.find((turn) => turn.requestId === next.requestId)?.status === 'completed') setAttempt(null); } } catch { /* Retry retains the original request. */ }
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  const pending = thread?.turns.find((turn) => turn.status === 'pending');
  async function refresh() { if (thread) await select(thread.id); }
  async function stop() {
    if (!thread) return;
    const requestId = attempt?.requestId || pending?.requestId;
    if (requestId) { try { await request(`assistant/${thread.id}/cancel`, { method: 'POST', ...json({ requestId }) }); } catch (err) { setError((err as Error).message); } }
    controller.current?.abort();
  }
  return <section className="student-panel course-chat study-assistant">
    <h2>{vi ? 'Trợ lý học tập' : 'Study assistant'}</h2>
    <p>{vi ? 'Trao đổi việc học. Chỉ dùng tài liệu của các môn bạn chọn; chưa có tìm web hoặc nhắc học tự động.' : 'Discuss your studies. Only selected course materials are used. No web search or automatic reminders.'}</p>
    {error && <p role="alert">{error}</p>}
    <label>{vi ? 'Tên hội thoại' : 'Conversation title'}<input value={title} maxLength={120} disabled={busy || !!pending} onChange={(event) => setTitle(event.target.value)} /></label>
    <button disabled={busy || !!pending} onClick={() => void manage('create')}>{vi ? 'Hội thoại mới' : 'New conversation'}</button>
    <label>{vi ? 'Hội thoại' : 'Conversation'}<select value={thread?.id || ''} disabled={busy || !!pending} onChange={(event) => { if (event.target.value) void select(event.target.value); }}><option value="">—</option>{threads.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    {thread && <>
      <button disabled={busy || !!pending || !title.trim()} onClick={() => void manage('rename')}>{vi ? 'Đổi tên' : 'Rename'}</button>
      <button disabled={busy || !!pending} onClick={() => void manage('delete')}>{vi ? 'Xóa hội thoại' : 'Delete conversation'}</button>
      <fieldset disabled={busy || !!pending || !!attempt}><legend>{vi ? 'Nguồn tài liệu (bỏ chọn tất cả để dùng kiến thức model)' : 'Sources (none selected means model knowledge)'}</legend>{courses.filter((course) => course.status === 'active').map((course) => <label className="student-check" key={course.id}><input type="checkbox" checked={scope.includes(course.id)} onChange={(event) => setScope(event.target.checked ? [...scope, course.id] : scope.filter((id) => id !== course.id))} />{course.name}</label>)}</fieldset>
      <label>{vi ? 'Nhà cung cấp AI' : 'AI provider'}<select value={provider} disabled={busy || !!pending || !!attempt} onChange={(event) => setProvider(event.target.value as ChatProviderId)}>{settings?.chatProviders.map((entry) => <option key={entry.id} value={entry.id} disabled={!entry.configured}>{entry.label}{!entry.configured ? (vi ? ' · Chưa cấu hình' : ' · Not configured') : ''}</option>)}</select></label>
      <p>{settings?.chatProviders.find((entry) => entry.id === provider)?.model}</p>
      <p>{provider === 'ollama' ? (vi ? 'Xử lý bằng model trên máy nếu embedding cũng là local.' : 'Processed locally when embeddings are also local.') : (vi ? 'Câu hỏi, trích đoạn, lịch sử và memory được gửi đến nhà cung cấp đã chọn.' : 'Questions, excerpts, history and memory are sent to the selected provider.')}</p>
      <label>{vi ? 'Cách trả lời' : 'Answer mode'}<select value={mode} disabled={busy || !!pending || !!attempt} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="expanded">{vi ? 'Tài liệu + mở rộng' : 'Materials + knowledge'}</option><option value="materials">{vi ? 'Theo tài liệu' : 'Materials only'}</option></select></label>
      <div role="log" aria-live="polite">{thread.turns.map((turn) => <article key={turn.id} className="student-chat-turn"><p><strong>{vi ? 'Bạn' : 'You'}:</strong> {turn.message}</p><small>{turn.provider} · {turn.model} · {turn.scope.map((id) => courses.find((course) => course.id === id)?.name || id).join(', ') || (vi ? 'Không dùng tài liệu' : 'No materials')}</small>{turn.answer && <><p className="student-chat-text">{turn.answer.answer}</p><p>{turn.answer.basis}</p>{turn.answer.sources.map((source) => <a key={source.sourceId} href={apiUrl(`documents/${source.documentId}/file`) + `#page=${source.pageNumber}`} target="_blank" rel="noopener">{source.documentName} · {source.pageNumber} </a>)}<button onClick={async () => { if (window.confirm(vi ? 'Lưu câu trả lời vào sở thích/ghi chú chung? Hãy kiểm tra tính đúng trước khi lưu.' : 'Save this answer as a global note? Check accuracy first.')) { try { await request('memories', { method: 'POST', ...json({ scope: 'global', content: turn.answer!.answer, requestId: crypto.randomUUID() }) }); } catch (err) { setError((err as Error).message); } } }}>{vi ? 'Lưu ghi chú (xác nhận)' : 'Save note (confirm)'}</button><button type="button" className="student-save-log" onClick={() => openDraftLog(turn)}>📝 {vi ? 'Ghi vào nhật ký' : 'Save to diary'}</button></>}{turn.status === 'failed' && <p role="alert">{turn.errorCode}</p>}{turn.status === 'pending' && <p role="status">{vi ? 'Đang xử lý…' : 'Working…'}</p>}</article>)}</div>
      {attempt && !busy && <button disabled={!!pending} onClick={() => void send(attempt)}>{vi ? 'Thử lại cùng yêu cầu' : 'Retry same request'}</button>}
      {!attempt && !busy && thread.turns.at(-1)?.status === 'failed' && <button onClick={() => {
        const last = thread.turns.at(-1)!;
        void send({ message: last.message, requestId: last.requestId, courseIds: last.scope, provider: last.provider, mode: last.mode, language: last.language });
      }}>{vi ? 'Thử lại câu bị lỗi' : 'Retry failed question'}</button>}
      {pending && !busy && <button onClick={() => void refresh()}>{vi ? 'Kiểm tra lịch sử' : 'Refresh history'}</button>}
      {(busy || pending) && <button onClick={() => void stop()}>{vi ? 'Dừng trả lời' : 'Stop'}</button>}
      <form className="student-chat-compose" onSubmit={(event) => { event.preventDefault(); if (message.trim()) void send({ message: message.trim(), requestId: crypto.randomUUID(), courseIds: scope, provider, mode, language: vi ? 'vi' : 'en' }); }}><label>{vi ? 'Câu hỏi của bạn' : 'Your question'}<textarea maxLength={4000} rows={3} value={message} disabled={busy || !!pending || !!attempt} onChange={(event) => setMessage(event.target.value)} /></label><button disabled={busy || !!pending || !!attempt || !message.trim() || !settings?.chatProviders.find((entry) => entry.id === provider)?.configured}>{vi ? 'Gửi' : 'Send'}</button></form>
    </>}
    <details><summary>{vi ? 'Hồ sơ học tập: mục tiêu, trình độ, cách học và khó khăn' : 'Learning profile: goals, level, preferences and difficulties'}</summary><MemoryWorkspace lang={lang} target={{ scope: 'global' }} /></details>
    {draftLog && (
      <StudyLogDraftModal
        draft={draftLog}
        courses={courses}
        todayDate={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}
        lang={lang}
        onSaved={() => setDraftLog(null)}
        onClose={() => setDraftLog(null)}
      />
    )}
  </section>;
}
