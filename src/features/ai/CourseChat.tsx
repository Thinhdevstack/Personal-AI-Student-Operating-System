'use client';

import { useEffect, useRef, useState } from 'react';
import { createT } from '@/i18n/index.js';
import { AcademicApiError, apiUrl } from '@/features/academic/api';
import { chatHistory, sendChat, aiSettings, cancelChat } from './api';
import type { ChatRequest } from './api';
import type { ChatHistory, ChatTurn, ChatMessage, ChatProviderId, AISettings } from './types';
import { MemoryEditor } from './MemoryWorkspace';
import { LocalStatusView, useLocalStatus } from './LocalAIStatus';

export default function CourseChat({ courseId, lang, hasReadyMaterials, onMemoryChange }: { courseId: string; lang: string; hasReadyMaterials: boolean; onMemoryChange?: () => void }) {
  const translate = createT(lang);
  const t = (key: string) => String(translate(`student.${key}`));
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState<ChatRequest | null>(null);
  const [reload, setReload] = useState(0);
  const [savingMemory, setSavingMemory] = useState<ChatMessage | null>(null);
  const [memorySaved, setMemorySaved] = useState(false);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [provider, setProvider] = useState<ChatProviderId>('openai');
  const [mode, setMode] = useState<'materials' | 'expanded'>('materials');
  const currentAttempt = useRef<ChatRequest | null>(null);
  const localStatus = useLocalStatus(provider === 'ollama', reload);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const recoveryAttempts = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const pending = history?.turns.some((turn) => turn.status === 'pending');

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; requestController.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    aiSettings(controller.signal).then((config) => {
      setSettings(config);
      let saved: string | null = null;
      try { saved = localStorage.getItem('student-chat-provider:' + courseId); } catch { /* Blocked storage. */ }
      setProvider(config.chatProviders.find((entry) => entry.id === saved)?.id || config.defaultProvider);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof AcademicApiError ? err.message : 'network');
    });
    return () => controller.abort();
  }, [courseId]);
  useEffect(() => {
    const controller = new AbortController();
    chatHistory(courseId, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])).then((result) => {
      setHistory(result);
      const saved = uncertain && result.turns.find((turn) => turn.requestId === uncertain.requestId);
      if (saved?.status === 'completed') { setUncertain(null); setError(''); setMessage(''); }
      else if (saved?.status === 'failed') { setUncertain(null); setMessage(''); }
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof AcademicApiError ? err.message : 'network');
    });
    return () => controller.abort();
  }, [courseId, reload, uncertain]);
  useEffect(() => {
    if (!pending && !working && !(uncertain && recoveryAttempts.current > 0)) return;
    // Give a history read its full 5s deadline before starting another. Bound recovery to five polls.
    const timer = setTimeout(() => {
      if (uncertain) recoveryAttempts.current = Math.max(0, recoveryAttempts.current - 1);
      setReload((value) => value + 1);
    }, 6000);
    return () => clearTimeout(timer);
  }, [pending, history, working, uncertain, reload]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [history, working]);

  async function submit(attempt: ChatRequest) {
    if (inFlight.current || pending) return;
    inFlight.current = true; setWorking(true); setError('');
    currentAttempt.current = attempt;
    const controller = new AbortController(); requestController.current = controller;
    try {
      const result = await sendChat(attempt, controller.signal);
      if (alive.current) { setHistory(result); setUncertain(null); setMessage(''); }
    } catch (err) {
      if (alive.current) {
        setError(controller.signal.aborted ? 'chatCancelled' : err instanceof AcademicApiError ? err.message : 'network');
        recoveryAttempts.current = 5;
        setUncertain(attempt);
        try {
          // A lost connection must not hold the Retry button indefinitely while history recovery waits.
          const recovered = await chatHistory(courseId, AbortSignal.timeout(5000));
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
      currentAttempt.current = null;
      if (alive.current) setWorking(false);
    }
  }
  function retry(turn: ChatTurn) {
    const user = turn.messages.find((item) => item.role === 'user');
    if (user) void submit({ courseId, requestId: turn.requestId, message: user.content, language: turn.language, provider: turn.provider, mode: turn.mode, ...(history?.conversationId && { conversationId: history.conversationId }) });
  }
  const unresolved = uncertain && !history?.turns.some((turn) => turn.requestId === uncertain.requestId);
  const selected = settings?.chatProviders.find((entry) => entry.id === provider);
  const ready = !!selected?.configured && (mode === 'expanded' && !hasReadyMaterials || !!settings?.embedding.configured) && (provider !== 'ollama' || !!localStatus?.connected && !!localStatus.chatReady && (!hasReadyMaterials || !!localStatus.embeddingReady));
  const phase = history?.turns.find((turn) => turn.status === 'pending')?.phase;
  async function stop() {
    const requestId = currentAttempt.current?.requestId || history?.turns.find((turn) => turn.status === 'pending')?.requestId;
    if (!requestId) return;
    try { await cancelChat(courseId, requestId); }
    catch { setError('network'); }
    requestController.current?.abort();
    setReload((r) => r + 1);
  }
  const providerLabel = (id: ChatProviderId) => settings?.chatProviders.find((entry) => entry.id === id)?.label || (id === 'mock' ? t('tutor.offlineShort') : id);
  return <div className="course-chat">
    <div className="student-section-heading"><h2>{t('tutor.title')}</h2><span className="student-chat-scope">{t('tutor.courseScope')}</span></div>
    {history?.isMock && <p className="student-chat-offline" role="status">{t('tutor.offline')}</p>}
    {!hasReadyMaterials && <p className="student-chat-hint">{t('tutor.noMaterials')}</p>}
    <div className="student-provider-controls">
      <label htmlFor={`chat-provider-${courseId}`}>{t('providers.choose')}</label>
      <select id={`chat-provider-${courseId}`} value={provider} disabled={!settings || working || pending || !!unresolved} onChange={(event) => {
        setProvider(event.target.value as ChatProviderId);
        try { localStorage.setItem('student-chat-provider:' + courseId, event.target.value); } catch { /* Blocked storage. */ }
      }}>
        {settings?.chatProviders.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}{entry.isMock ? ` · ${t('tutor.offlineShort')}` : !entry.configured ? ` · ${t('providers.notConfigured')}` : ''}</option>)}
      </select>
      {selected && <small>{selected.model} · {t('providers.embedding')}: {settings?.embedding.model}</small>}
      {provider === 'ollama' && <LocalStatusView lang={lang} status={localStatus} refresh={() => setReload((r) => r + 1)} />}
      {settings && provider !== 'ollama' && !ready && <p className="student-chat-hint">{t(!selected?.configured ? 'providers.missingKey' : 'providers.missingEmbeddingKey')}</p>}
      <small>{t(settings?.isMock ? 'demo.contextHint' : provider === 'ollama' && settings?.embedding.provider === 'ollama' ? 'local.contextHint' : 'providers.contextHint')}</small>
      <label htmlFor={`chat-mode-${courseId}`}>{t('local.mode')}</label>
      <select id={`chat-mode-${courseId}`} value={mode} disabled={working || pending || !!unresolved} onChange={(event) => setMode(event.target.value as 'materials' | 'expanded')}>
        <option value="materials">{t('local.materials')}</option><option value="expanded">{t('local.expanded')}</option>
      </select>
      <small>{t(mode === 'materials' ? 'local.materialsHint' : 'local.expandedHint')}</small>
      <label className="student-check"><input type="checkbox" checked={false} disabled />{t('local.web')} · {t('local.webNotConfigured')}</label>
    </div>
    {memorySaved && <p role="status">{t('memory.saved')}</p>}
    {error && <div className="student-error" role="alert">{t(`errors.${error}`)} <button type="button" onClick={() => setReload((value) => value + 1)}>{t('retry')}</button></div>}
    {!history ? <p>{t('loading')}</p> : <>
      {!history.turns.length && <div className="student-empty">{t('tutor.welcome')}</div>}
      <div className="student-chat-log" role="log" aria-label={t('tutor.history')} aria-live="polite" aria-relevant="additions text">
        {history.turns.map((turn, index) => <div key={turn.id} className="student-chat-turn">
          {turn.messages.map((item) => <article key={item.id} className={`student-chat-message student-chat-${item.role}`}>
            <header><strong>{t(item.role === 'user' ? 'tutor.you' : 'tutor.assistant')}</strong>{item.role === 'assistant' && <span>{providerLabel(turn.provider)} · {turn.isMock ? t('tutor.offlineShort') : turn.model} · {t(turn.mode === 'materials' ? 'local.materials' : 'local.expanded')}</span>}</header>
            {item.basis && <p className={`student-chat-basis student-chat-basis-${item.basis}`}>{t(`tutor.basis.${item.basis}`)}</p>}
            {/* React escapes plain text; model output is never interpreted as HTML. */}
            <div className="student-chat-text">{item.content}</div>
            {!!item.sources.length && <div className="student-chat-sources"><strong>{t('tutor.sources')}</strong><ul>{item.sources.map((source) => <li key={source.sourceId}><a href={apiUrl(`documents/${source.documentId}/file`)}>{source.documentName} · {t('page')} {source.pageNumber}</a><small>{source.sourceId} · {t('tutor.chunk')} {source.chunkIndex + 1}</small></li>)}</ul></div>}
            {!!item.memories?.length && <details className="student-chat-memories"><summary>{t('memory.shared')} ({item.memories.length})</summary><p>{t('memory.snapshotHint')}</p><ul>{item.memories.map((memory) => <li key={memory.id}><small>{t(memory.scope === 'global' ? 'memory.global' : 'memory.course')}</small><p className="student-memory-content">{memory.content}</p></li>)}</ul></details>}
            {turn.status === 'completed' && <button type="button" className="student-save-memory" onClick={() => { setMemorySaved(false); setSavingMemory(item); }}>{t('memory.saveFromChat')}</button>}
          </article>)}
          {turn.status === 'pending' && <p role="status">{t(turn.phase === 'library.search' ? 'local.reading' : 'tutor.responding')}</p>}
          {turn.status === 'failed' && <div className="student-chat-failed"><p>{t(`errors.${turn.errorCode || 'aiUnavailable'}`)}</p>{index === history.turns.length - 1 && <button type="button" disabled={working || pending || (turn.mode === 'materials' && !hasReadyMaterials)} onClick={() => retry(turn)}>{t('tutor.retry')}</button>}</div>}
        </div>)}
        {working && !pending && <p role="status">{t(phase === 'ai.respond' ? 'tutor.responding' : 'local.reading')}</p>}
        {(working || pending) && <button type="button" onClick={() => void stop()}>{t('local.stop')}</button>}
        <div ref={bottom} />
      </div>
      {unresolved && <button type="button" disabled={working || pending} onClick={() => void submit(uncertain)}>{t('tutor.retry')}</button>}
      <form className="student-chat-compose" onSubmit={(event) => {
        event.preventDefault();
        if (!message.trim()) return;
        if (!ready) return;
        void submit({ courseId, message: message.trim(), provider, mode, webSearch: false, requestId: crypto.randomUUID(), language: lang === 'vi' ? 'vi' : 'en', ...(history.conversationId && { conversationId: history.conversationId }) });
      }}>
        <label htmlFor={`chat-question-${courseId}`}>{t('tutor.question')}</label>
        <textarea id={`chat-question-${courseId}`} rows={3} maxLength={4000} placeholder={t('tutor.placeholder')} value={message} onChange={(event) => setMessage(event.target.value)} disabled={working || pending || !!unresolved} />
        <div><small>{message.length}/4000 · {t('tutor.enterHint')}</small><button className="student-primary" type="submit" disabled={working || pending || !message.trim() || (mode === 'materials' && !hasReadyMaterials) || !!unresolved || !ready}>{working || pending ? t('tutor.responding') : t('tutor.send')}</button></div>
      </form>
    </>}
    {savingMemory && <MemoryEditor lang={lang} target={{ scope: 'course', courseId }} initialContent={savingMemory.content} source={{ sourceMessageId: savingMemory.id, sourceCourseId: courseId }} allowGlobal onClose={() => setSavingMemory(null)} onSaved={() => { setMemorySaved(true); onMemoryChange?.(); }} />}
  </div>;
}
