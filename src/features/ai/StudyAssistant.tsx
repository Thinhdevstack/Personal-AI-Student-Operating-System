'use client';

import { useEffect, useRef, useState } from 'react';
import { request, apiUrl } from '@/features/academic/api';
import type { Course } from '@/features/academic/types';
import type { AISettings, ChatProviderId, ChatSource } from './types';
import MemoryWorkspace from './MemoryWorkspace';
import StudyLogDraftModal, { DraftLogData } from '@/features/study/StudyLogDraftModal';

type Attempt = {
  requestId: string;
  message: string;
  courseIds: string[];
  language: 'vi' | 'en';
  provider: ChatProviderId;
  mode: 'materials' | 'expanded';
};

type Turn = Attempt & {
  id: string;
  scope: string[];
  status: string;
  errorCode?: string;
  model?: string;
  answer: { answer: string; basis: string; sources: ChatSource[] } | null;
};

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
  const [mobileConvOpen, setMobileConvOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const json = (body: object) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    Promise.all([
      request<{ id: string; title: string }[]>('assistant', { signal: abort.signal }),
      request<AISettings>('ai', { signal: abort.signal }),
    ])
      .then(([list, config]) => {
        if (!abort.signal.aborted) {
          setThreads(list);
          setSettings(config);
          setProvider(config.defaultProvider);
          if (list.length > 0 && !current.current) {
            void select(list[0].id);
          }
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(String(err.message));
      });
    return () => {
      mounted.current = false;
      abort.abort();
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.turns.length, busy]);

  async function select(id: string) {
    current.current = id;
    setAttempt(null);
    setError('');
    setScope([]);
    setThread(null);
    setMobileConvOpen(false);
    try {
      const result = await request<Thread>(`assistant/${id}`);
      if (mounted.current && current.current === id) {
        setThread(result);
        setTitle(result.title);
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    }
  }

  async function manage(action: 'create' | 'rename' | 'delete') {
    if (busy) return;
    if (action === 'delete' && !window.confirm(vi ? 'Xóa hội thoại này?' : 'Delete this conversation?')) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'create') {
        const created = await request<Thread>('assistant', {
          method: 'POST',
          ...json({ title: (vi ? 'Hội thoại ' : 'Conversation ') + (threads.length + 1) }),
        });
        await select(created.id);
      } else if (thread) {
        if (action === 'rename') {
          const newTitle = window.prompt(vi ? 'Nhập tên mới cho hội thoại:' : 'New conversation title:', title);
          if (newTitle && newTitle.trim()) {
            const updated = await request<Thread>(`assistant/${thread.id}`, { method: 'PATCH', ...json({ title: newTitle.trim() }) });
            setThread(updated);
            setTitle(updated.title);
          }
        } else {
          await request(`assistant/${thread.id}`, { method: 'DELETE' });
          setThread(null);
          current.current = null;
        }
      }
      setThreads(await request('assistant'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function send(next: Attempt) {
    if (!thread || busy) return;
    const id = thread.id;
    setBusy(true);
    setError('');
    setAttempt(next);
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await request<Thread>(`assistant/${id}/chat`, { method: 'POST', ...json(next), signal: abort.signal });
      if (mounted.current && current.current === id) {
        setThread(result);
        setAttempt(null);
      }
    } catch (err) {
      if (mounted.current && current.current === id) {
        setError(abort.signal.aborted ? (vi ? 'Đã dừng yêu cầu.' : 'Request stopped.') : (err as Error).message);
        try {
          const saved = await request<Thread>(`assistant/${id}`, { signal: AbortSignal.timeout(5000) });
          if (mounted.current && current.current === id) {
            setThread(saved);
            if (saved.turns.find((turn) => turn.requestId === next.requestId)?.status === 'completed') setAttempt(null);
          }
        } catch {
          /* Retry retains original request */
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const pending = thread?.turns.find((turn) => turn.status === 'pending');

  async function stop() {
    if (!thread) return;
    const requestId = attempt?.requestId || pending?.requestId;
    if (requestId) {
      try {
        await request(`assistant/${thread.id}/cancel`, { method: 'POST', ...json({ requestId }) });
      } catch (err) {
        setError((err as Error).message);
      }
    }
    controller.current?.abort();
  }

  function copyText(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const activeProviderEntry = settings?.chatProviders.find((entry) => entry.id === provider);

  return (
    <div className="student-assistant-layout">
      {/* 1. Left Conversation List Sidebar */}
      <aside className={`student-assistant-sidebar ${mobileConvOpen ? 'is-open' : ''}`}>
        <div className="student-assistant-sidebar-header">
          <button
            type="button"
            className="student-primary"
            style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6 }}
            disabled={busy || !!pending}
            onClick={() => void manage('create')}
          >
            <span>+</span> {vi ? 'Hội thoại mới' : 'New conversation'}
          </button>
        </div>

        <div className="student-conv-list">
          {threads.length === 0 ? (
            <p style={{ padding: '16px 12px', fontSize: 13, color: 'var(--student-text-faint)', margin: 0 }}>
              {vi ? 'Chưa có hội thoại nào.' : 'No conversations yet.'}
            </p>
          ) : (
            threads.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`student-conv-item ${thread?.id === item.id ? 'is-active' : ''}`}
                onClick={() => void select(item.id)}
              >
                <span className="student-conv-title">{item.title}</span>
                <span className="student-conv-meta">
                  {thread?.id === item.id ? (vi ? 'Đang chọn' : 'Active') : (vi ? 'Nhấn để mở' : 'Open')}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* 2. Main Chat Workspace */}
      <div className="student-assistant-main">
        {/* Header: Provider & Model status + Config Toggle */}
        <div className="student-assistant-header">
          <div className="student-assistant-header-info">
            <button
              type="button"
              className="student-mobile-btn"
              onClick={() => setMobileConvOpen(!mobileConvOpen)}
            >
              ☰ {vi ? 'Hội thoại' : 'Chats'}
            </button>
            <div className="student-model-badge">
              <span className="student-model-status-dot" />
              <span>{activeProviderEntry?.label || provider} · {activeProviderEntry?.model || 'local'}</span>
            </div>
            {thread && (
              <span style={{ fontSize: 13, color: 'var(--student-text-muted)' }}>
                {title}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {thread && (
              <>
                <button
                  type="button"
                  className="student-btn-subtle"
                  style={{ fontSize: 12 }}
                  disabled={busy || !!pending}
                  onClick={() => void manage('rename')}
                  title={vi ? 'Đổi tên' : 'Rename'}
                >
                  ✏️ {vi ? 'Đổi tên' : 'Rename'}
                </button>
                <button
                  type="button"
                  className="student-btn-subtle student-btn-danger"
                  style={{ fontSize: 12 }}
                  disabled={busy || !!pending}
                  onClick={() => void manage('delete')}
                  title={vi ? 'Xóa hội thoại' : 'Delete'}
                >
                  🗑️
                </button>
              </>
            )}
            <button
              type="button"
              className="student-config-toggle"
              onClick={() => setConfigOpen(!configOpen)}
            >
              <span>{vi ? 'Cấu hình & Nguồn tài liệu' : 'Context & Config'}</span>
              <span>{configOpen ? '▲' : '▼'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Context Configuration Panel */}
        {configOpen && (
          <div className="student-assistant-config-panel">
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--student-text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>
                {vi ? 'Nguồn tài liệu môn học' : 'Course Materials'}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                <label className="student-check" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={scope.length === 0}
                    onChange={() => setScope([])}
                  />
                  <span>{vi ? 'Tất cả tài liệu môn đang hoạt động' : 'All active course materials'}</span>
                </label>
                {courses.filter((c) => c.status === 'active').map((course) => (
                  <label key={course.id} className="student-check" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={scope.includes(course.id)}
                      onChange={(e) => {
                        if (e.target.checked) setScope([...scope, course.id]);
                        else setScope(scope.filter((id) => id !== course.id));
                      }}
                    />
                    <span>{course.name} {course.code ? `(${course.code})` : ''}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--student-text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>
                {vi ? 'Nhà cung cấp AI & Cách trả lời' : 'AI Provider & Mode'}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select
                  value={provider}
                  disabled={busy || !!pending || !!attempt}
                  onChange={(e) => setProvider(e.target.value as ChatProviderId)}
                  style={{ fontSize: 13, padding: '5px 8px' }}
                >
                  {settings?.chatProviders.map((entry) => (
                    <option key={entry.id} value={entry.id} disabled={!entry.configured}>
                      {entry.label} {!entry.configured ? (vi ? '· Chưa cài' : '· Not ready') : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={mode}
                  disabled={busy || !!pending || !!attempt}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                  style={{ fontSize: 13, padding: '5px 8px' }}
                >
                  <option value="expanded">{vi ? 'Tài liệu + Kiến thức mở rộng' : 'Materials + Knowledge'}</option>
                  <option value="materials">{vi ? 'Chỉ trả lời từ tài liệu' : 'Strictly materials only'}</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--student-text-faint)', textTransform: 'uppercase', marginBottom: 6 }}>
                {vi ? 'Hồ sơ học tập & Ghi nhớ' : 'Memory & Profile'}
              </label>
              <details style={{ fontSize: 12 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--student-accent-hover)' }}>
                  {vi ? 'Xem ghi nhớ học tập toàn cục' : 'View global study memory'}
                </summary>
                <div style={{ marginTop: 8 }}>
                  <MemoryWorkspace lang={lang} target={{ scope: 'global' }} />
                </div>
              </details>
            </div>
          </div>
        )}

        {/* 3. Messages Container (Scrollable) */}
        <div className="student-assistant-messages">
          {error && <div className="student-error" role="alert">{error}</div>}

          {!thread ? (
            <div className="student-empty" style={{ maxWidth: 540, margin: '60px auto 0' }}>
              <div className="student-empty-icon">💬</div>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--student-text)' }}>
                {vi ? 'Chọn hoặc tạo một hội thoại để bắt đầu' : 'Select or create a conversation'}
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--student-text-muted)' }}>
                {vi ? 'Trợ lý sẽ giúp bạn tóm tắt bài học, giải bài tập và tra cứu trích dẫn trực tiếp từ các file PDF đã tải lên.' : 'The study assistant helps you review materials, solve questions and locate citations from your uploaded PDFs.'}
              </p>
              <button
                type="button"
                className="student-primary"
                style={{ marginTop: 8 }}
                onClick={() => void manage('create')}
              >
                + {vi ? 'Bắt đầu hội thoại mới' : 'Start new conversation'}
              </button>
            </div>
          ) : thread.turns.length === 0 ? (
            <div className="student-empty" style={{ maxWidth: 620, margin: '40px auto 0' }}>
              <div className="student-empty-icon">✨</div>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--student-text)' }}>
                {vi ? 'Bắt đầu đặt câu hỏi với Trợ lý học tập' : 'Ask anything about your courses'}
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--student-text-muted)' }}>
                {vi ? 'Bạn có thể hỏi về các khái niệm lý thuyết, yêu cầu giải thích slide hoặc tóm tắt tài liệu môn học.' : 'Ask about theoretical concepts, slide explanations or summaries.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 12 }}>
                <button
                  type="button"
                  style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13 }}
                  onClick={() => setMessage(vi ? 'Tóm tắt các ý chính trong chương gần nhất của môn học?' : 'Summarize key points from the latest chapter?')}
                >
                  💡 &ldquo;{vi ? 'Tóm tắt các ý chính trong chương gần nhất của môn học?' : 'Summarize key points from the latest chapter?'}&rdquo;
                </button>
                <button
                  type="button"
                  style={{ textAlign: 'left', padding: '8px 12px', fontSize: 13 }}
                  onClick={() => setMessage(vi ? 'Giải thích công thức và điều kiện áp dụng trong bài giảng?' : 'Explain formulas and applicability from lecture?')}
                >
                  💡 &ldquo;{vi ? 'Giải thích công thức và điều kiện áp dụng trong bài giảng?' : 'Explain formulas and applicability from lecture?'}&rdquo;
                </button>
              </div>
            </div>
          ) : (
            thread.turns.map((turn) => (
              <div key={turn.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* User Turn */}
                <div className="student-chat-bubble-user">
                  {turn.message}
                </div>

                {/* Assistant Turn */}
                <div className="student-chat-bubble-assistant">
                  {turn.status === 'pending' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--student-text-muted)', fontSize: 14 }}>
                      <span className="student-collapse-icon is-open">⚙️</span>
                      <span>{vi ? 'Đang trích xuất tài liệu và tổng hợp câu trả lời...' : 'Searching materials and preparing answer...'}</span>
                    </div>
                  ) : turn.status === 'failed' ? (
                    <div className="student-error" style={{ margin: 0 }}>
                      <strong>{vi ? 'Lỗi xử lý câu trả lời:' : 'Failed to answer:'}</strong> {turn.errorCode || (vi ? 'Mô hình không phản hồi.' : 'Model error.')}
                    </div>
                  ) : (
                    <>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
                        {turn.answer?.answer}
                      </div>

                      {turn.answer?.basis && (
                        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--student-text-faint)' }}>
                          {turn.answer.basis}
                        </p>
                      )}

                      {/* Citations as chips */}
                      {turn.answer?.sources && turn.answer.sources.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {turn.answer.sources.map((source) => (
                            <a
                              key={source.sourceId}
                              className="student-citation-chip"
                              href={apiUrl(`documents/${source.documentId}/file`) + `#page=${source.pageNumber}`}
                              target="_blank"
                              rel="noopener"
                            >
                              📄 {source.documentName} · {vi ? 'Trang' : 'Page'} {source.pageNumber}
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Actions row under response */}
                      <div className="student-chat-actions-row">
                        <button
                          type="button"
                          className="student-btn-sm"
                          onClick={async () => {
                            if (window.confirm(vi ? 'Lưu câu trả lời vào sở thích/ghi chú chung? Hãy kiểm tra tính đúng trước khi lưu.' : 'Save this answer as a global note?')) {
                              try {
                                await request('memories', {
                                  method: 'POST',
                                  ...json({ scope: 'global', content: turn.answer!.answer, requestId: crypto.randomUUID() }),
                                });
                                alert(vi ? 'Đã lưu vào ghi chú chung!' : 'Saved to notes!');
                              } catch (err) {
                                setError((err as Error).message);
                              }
                            }
                          }}
                        >
                          📌 {vi ? 'Lưu ghi chú' : 'Save note'}
                        </button>
                        <button
                          type="button"
                          className="student-btn-sm"
                          onClick={() => openDraftLog(turn)}
                        >
                          ⏱️ {vi ? 'Ghi vào nhật ký' : 'Save to diary'}
                        </button>
                        <button
                          type="button"
                          className="student-btn-sm"
                          onClick={() => copyText(turn.id, turn.answer?.answer || '')}
                        >
                          {copiedId === turn.id ? (vi ? '✓ Đã chép' : '✓ Copied') : (vi ? 'Sao chép' : 'Copy')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))
          )}

          {attempt && !busy && (
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <button type="button" className="student-primary" onClick={() => void send(attempt)}>
                {vi ? 'Thử lại lượt vừa xong' : 'Retry last request'}
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 4. Chat Input Bar (Pinned at bottom) */}
        {thread && (
          <form
            className="student-chat-pinned-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim() && !busy && !pending) {
                void send({
                  message: message.trim(),
                  requestId: crypto.randomUUID(),
                  courseIds: scope,
                  provider,
                  mode,
                  language: vi ? 'vi' : 'en',
                });
              }
            }}
          >
            <div className="student-study-actions" role="group" aria-label="Chế độ học tập">
              <button
                type="button"
                className="student-study-action-btn"
                disabled={busy || !!pending || !!attempt}
                onClick={() => {
                  setMessage(vi
                    ? 'Khảo bài: Hãy đặt 1 câu hỏi trọng tâm từ tài liệu môn học để tôi tự trả lời. Chưa đưa ra đáp án, hãy chờ tôi trả lời rồi chấm điểm trên thang điểm 10, phân tích điểm đúng/thiếu và trích dẫn trang nguồn.'
                    : 'Socratic Quiz: Ask me 1 core question from course materials for me to answer. Do not give the answer yet; wait for my answer then evaluate on a 10-point scale.');
                }}
              >
                {vi ? 'Khảo bài' : 'Active Recall'}
              </button>
              <button
                type="button"
                className="student-study-action-btn"
                disabled={busy || !!pending || !!attempt}
                onClick={() => {
                  setMessage(vi
                    ? 'Tạo trắc nghiệm: Hãy tạo 3-5 câu hỏi trắc nghiệm A, B, C, D từ tài liệu môn học kèm đáp án đúng và giải thích chi tiết trích dẫn từ tài liệu.'
                    : 'Generate Quiz: Create 3-5 multiple-choice questions A, B, C, D from course materials with correct answers and explanations.');
                }}
              >
                {vi ? 'Tạo trắc nghiệm' : 'Quiz Generator'}
              </button>
              <button
                type="button"
                className="student-study-action-btn"
                disabled={busy || !!pending || !!attempt}
                onClick={() => {
                  setMessage(vi
                    ? 'Tóm tắt cốt lõi: Hãy tóm tắt các định nghĩa, công thức, bảng so sánh và các điểm mấu chốt hay ra thi từ tài liệu môn học dưới dạng phao kiến thức dễ nhớ.'
                    : 'Core Cheatsheet: Summarize essential definitions, formulas, comparisons, and exam tips from course materials.');
                }}
              >
                {vi ? 'Tóm tắt cốt lõi' : 'Cheatsheet'}
              </button>
              <button
                type="button"
                className="student-study-action-btn"
                disabled={busy || !!pending || !!attempt}
                onClick={() => {
                  setMessage(vi
                    ? 'Tạo Flashcards: Hãy tạo 5-8 thẻ ghi nhớ từ tài liệu môn học theo định dạng rõ ràng: Mặt trước là Thuật ngữ / Câu hỏi ngắn, Mặt sau là Định nghĩa cốt lõi và ví dụ ngắn.'
                    : 'Create Flashcards: Generate 5-8 flashcards from course materials: Front = Term/Question, Back = Definition/Explanation.');
                }}
              >
                {vi ? 'Tạo Flashcards' : 'Flashcards'}
              </button>
            </div>
            <div className="student-chat-input-wrapper">
              <input
                type="text"
                placeholder={vi ? 'Nhập câu hỏi học tập hoặc yêu cầu giải thích...' : 'Ask a question about your study materials...'}
                value={message}
                disabled={busy || !!pending || !!attempt}
                onChange={(e) => setMessage(e.target.value)}
              />
              {(busy || pending) ? (
                <button
                  type="button"
                  className="student-btn-danger"
                  style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
                  onClick={() => void stop()}
                >
                  {vi ? 'Dừng' : 'Stop'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="student-primary"
                  style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13 }}
                  disabled={!message.trim() || !activeProviderEntry?.configured}
                >
                  {vi ? 'Gửi' : 'Send'}
                </button>
              )}
            </div>
            <div style={{ maxWidth: 860, margin: '6px auto 0', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--student-text-faint)' }}>
              <span>Enter {vi ? 'để gửi' : 'to send'}</span>
              <span>
                {vi ? 'Nguồn:' : 'Context:'} {scope.length === 0 ? (vi ? 'Tất cả môn đang hoạt động' : 'All courses') : `${scope.length} ${vi ? 'môn đã chọn' : 'selected courses'}`}
              </span>
            </div>
          </form>
        )}
      </div>

      {/* 5. Study Log Draft Modal */}
      {draftLog && (
        <StudyLogDraftModal
          draft={draftLog}
          courses={courses}
          todayDate={
            new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Bangkok',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date())
          }
          lang={lang}
          onSaved={() => setDraftLog(null)}
          onClose={() => setDraftLog(null)}
        />
      )}
    </div>
  );
}
