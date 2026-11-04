'use client';

import { useEffect, useRef, useState } from 'react';
import { createT } from '@/i18n/index.js';
import { AcademicApiError, apiUrl } from '@/features/academic/api';
import { chatHistory, sendChat } from './api';
import type { ChatRequest } from './api';
import type { ChatHistory, ChatTurn } from './types';

export default function CourseChat({ courseId, lang, hasReadyMaterials }: { courseId: string; lang: string; hasReadyMaterials: boolean }) {
  const translate = createT(lang);
  const t = (key: string) => String(translate(`student.${key}`));
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState<ChatRequest | null>(null);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const pending = history?.turns.some((turn) => turn.status === 'pending');

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requestController.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    chatHistory(courseId, controller.signal).then(setHistory).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof AcademicApiError ? err.message : 'network');
    });
    return () => controller.abort();
  }, [courseId, reload]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setReload((value) => value + 1), 2000);
    return () => clearTimeout(timer);
  }, [pending, history]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [history, working]);

  async function submit(attempt: ChatRequest) {
    if (inFlight.current || pending) return;
    inFlight.current = true; setWorking(true); setError('');
    const controller = new AbortController(); requestController.current = controller;
    try {
      const result = await sendChat(attempt, controller.signal);
      if (alive.current) { setHistory(result); setUncertain(null); setMessage(''); }
    } catch (err) {
      if (alive.current) {
        setError(err instanceof AcademicApiError ? err.message : 'network');
        setUncertain(attempt);
        try {
          const recovered = await chatHistory(courseId, controller.signal);
          if (alive.current) {
            setHistory(recovered);
            const saved = recovered.turns.find((turn) => turn.requestId === attempt.requestId);
            if (saved) setMessage('');
            if (saved?.status === 'completed') { setUncertain(null); setError(''); }
          }
        } catch { /* Retry keeps the original request ID if the response was lost. */ }
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setWorking(false);
    }
  }
  function retry(turn: ChatTurn) {
    const user = turn.messages.find((item) => item.role === 'user');
    if (user) void submit({ courseId, requestId: turn.requestId, message: user.content, language: turn.language, ...(history?.conversationId && { conversationId: history.conversationId }) });
  }
  const unresolved = uncertain && !history?.turns.some((turn) => turn.requestId === uncertain.requestId);
  return <div className="course-chat">
    <div className="student-section-heading"><h2>{t('tutor.title')}</h2><span className="student-chat-scope">{t('tutor.courseScope')}</span></div>
    {history?.isMock && <p className="student-chat-offline" role="status">{t('tutor.offline')}</p>}
    {!hasReadyMaterials && <p className="student-chat-hint">{t('tutor.noMaterials')}</p>}
    {error && <div className="student-error" role="alert">{t(`errors.${error}`)} <button type="button" onClick={() => setReload((value) => value + 1)}>{t('retry')}</button></div>}
    {!history ? <p>{t('loading')}</p> : <>
      {!history.turns.length && <div className="student-empty">{t('tutor.welcome')}</div>}
      <div className="student-chat-log" role="log" aria-label={t('tutor.history')} aria-live="polite" aria-relevant="additions text">
        {history.turns.map((turn, index) => <div key={turn.id} className="student-chat-turn">
          {turn.messages.map((item) => <article key={item.id} className={`student-chat-message student-chat-${item.role}`}>
            <header><strong>{t(item.role === 'user' ? 'tutor.you' : 'tutor.assistant')}</strong>{item.role === 'assistant' && <span>{turn.isMock ? t('tutor.offlineShort') : turn.model}</span>}</header>
            {item.basis && <p className={`student-chat-basis student-chat-basis-${item.basis}`}>{t(`tutor.basis.${item.basis}`)}</p>}
            {/* React escapes plain text; model output is never interpreted as HTML. */}
            <div className="student-chat-text">{item.content}</div>
            {!!item.sources.length && <div className="student-chat-sources"><strong>{t('tutor.sources')}</strong><ul>{item.sources.map((source) => <li key={source.sourceId}><a href={apiUrl(`documents/${source.documentId}/file`)}>{source.documentName} · {t('page')} {source.pageNumber}</a><small>{source.sourceId} · {t('tutor.chunk')} {source.chunkIndex + 1}</small></li>)}</ul></div>}
          </article>)}
          {turn.status === 'pending' && <p role="status">{t('tutor.responding')}</p>}
          {turn.status === 'failed' && <div className="student-chat-failed"><p>{t(`errors.${turn.errorCode || 'aiUnavailable'}`)}</p>{index === history.turns.length - 1 && <button type="button" disabled={working || pending || !hasReadyMaterials} onClick={() => retry(turn)}>{t('tutor.retry')}</button>}</div>}
        </div>)}
        {working && <p role="status">{t('tutor.responding')}</p>}
        <div ref={bottom} />
      </div>
      {unresolved && <button type="button" disabled={working || pending} onClick={() => void submit(uncertain)}>{t('tutor.retry')}</button>}
      <form className="student-chat-compose" onSubmit={(event) => {
        event.preventDefault();
        if (!message.trim()) return;
        void submit({ courseId, message: message.trim(), requestId: crypto.randomUUID(), language: lang === 'vi' ? 'vi' : 'en', ...(history.conversationId && { conversationId: history.conversationId }) });
      }}>
        <label htmlFor={`chat-question-${courseId}`}>{t('tutor.question')}</label>
        <textarea id={`chat-question-${courseId}`} rows={3} maxLength={4000} placeholder={t('tutor.placeholder')} value={message} onChange={(event) => setMessage(event.target.value)} disabled={working || pending || !!unresolved} />
        <div><small>{message.length}/4000 · {t('tutor.enterHint')}</small><button className="student-primary" type="submit" disabled={working || pending || !message.trim() || !hasReadyMaterials || !!unresolved}>{working || pending ? t('tutor.responding') : t('tutor.send')}</button></div>
      </form>
    </>}
  </div>;
}
