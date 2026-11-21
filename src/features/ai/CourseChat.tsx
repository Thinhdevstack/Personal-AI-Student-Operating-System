'use client';

import { useEffect, useRef, useState } from 'react';
import { createT } from '@/i18n/index.js';
import { AcademicApiError, apiUrl } from '@/features/academic/api';
import type { Material } from '@/features/academic/types';
import { chatHistory, sendChat, aiSettings, cancelChat, verifyAIProvider } from './api';
import type { ChatRequest } from './api';
import type { ChatHistory, ChatTurn, ChatMessage, ChatProviderId, AISettings } from './types';
import { useLocalStatus } from './LocalAIStatus';
import StudyLogDraftModal, { DraftLogData } from '@/features/study/StudyLogDraftModal';

type CloudState = 'not_configured' | 'unverified' | 'verifying' | 'connected' | 'auth_required' | 'rate_limited' | 'model_missing' | 'disconnected' | 'error';

export default function CourseChat({
  courseId,
  lang,
  hasReadyMaterials,
  materials = [],
}: {
  courseId: string;
  lang: string;
  hasReadyMaterials: boolean;
  materials?: Material[];
  onMemoryChange?: () => void;
}) {
  const translate = createT(lang);
  const t = (key: string) => String(translate(`student.${key}`));
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState<ChatRequest | null>(null);
  const [reload, setReload] = useState(0);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [provider, setProvider] = useState<ChatProviderId>('openai');
  const [mode, setMode] = useState<'materials' | 'expanded'>('materials');
  const [cloudModel, setCloudModel] = useState<string>('glm-5.3-flash:cloud');
  const [localCloudOverride, setLocalCloudOverride] = useState<CloudState | null>(null);
  const [targetDocId, setTargetDocId] = useState<string>('');
  const currentAttempt = useRef<ChatRequest | null>(null);
  const isOllamaFamily = provider === 'ollama' || provider === 'ollama-cloud';
  const localStatus = useLocalStatus(isOllamaFamily, reload);
  const cloudState: CloudState = localCloudOverride || localStatus?.cloudStatus?.state || 'unverified';
  const inFlight = useRef(false);
  const alive = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const recoveryAttempts = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const pending = history?.turns.some((turn) => turn.status === 'pending');
  const [draftLog, setDraftLog] = useState<DraftLogData | null>(null);

  function openDraftLog(turn: ChatTurn, item: ChatMessage) {
    const userMsg = turn.messages.find((m) => m.role === 'user');
    setDraftLog({
      courseId,
      title: userMsg ? userMsg.content.slice(0, 100) : (lang === 'vi' ? 'Hỏi đáp môn học' : 'Course Q&A'),
      learnedContent: item.content,
      activityType: 'review',
      sourceTurnId: turn.id,
      sourceConversationId: history?.conversationId || undefined,
    });
  }

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
      try { setMode(localStorage.getItem('student-chat-mode:' + courseId) === 'expanded' ? 'expanded' : 'materials'); } catch { /* Blocked storage. */ }
      const defaultCloud = config.cloudModels?.[0] || 'glm-5.3-flash:cloud';
      let savedCloud: string | null = null;
      try { savedCloud = localStorage.getItem('student-cloud-model:' + courseId); } catch { /* Blocked storage. */ }
      setCloudModel(config.cloudModels?.includes(savedCloud || '') ? savedCloud! : defaultCloud);
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
      else if (saved?.status === 'failed') { setUncertain(null); }
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof AcademicApiError ? err.message : 'network');
    });
    return () => controller.abort();
  }, [courseId, reload, uncertain]);
  useEffect(() => {
    if (!pending && !working && !(uncertain && recoveryAttempts.current > 0)) return;
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

    // For Ollama Cloud, perform minimal non-academic verification ping before sending student documents if unverified
    const chosenProvider = attempt.provider || provider;
    if (chosenProvider === 'ollama-cloud' && !cloudVerified) {
      setLocalCloudOverride('verifying');
      try {
        const res = await verifyAIProvider({ provider: 'ollama-cloud', model: attempt.model || cloudModel }, controller.signal);
        const ok = res.ok;
        const nextState: CloudState = (res.state as CloudState) || (ok ? 'connected' : 'error');
        setLocalCloudOverride(nextState);
        if (!ok) {
          setError(res.error || 'aiUnavailable');
          inFlight.current = false;
          setWorking(false);
          return;
        }
      } catch {
        setLocalCloudOverride('error');
        setError('ollamaUnavailable');
        inFlight.current = false;
        setWorking(false);
        return;
      }
    }

    // Optimistically render pending turn immediately
    const optimisticTurn: ChatTurn = {
      id: attempt.requestId,
      sequence: (history?.turns.at(-1)?.sequence || 0) + 1,
      requestId: attempt.requestId,
      provider: attempt.provider || provider,
      mode: attempt.mode || mode,
      model: attempt.model || null,
      status: 'pending',
      phase: 'library.search',
      errorCode: null,
      sourceTarget: attempt.sourceTarget || (attempt.documentId ? {
        documentId: attempt.documentId,
        documentName: readyMaterials.find((m) => m.id === attempt.documentId)?.originalFilename,
        pageNumber: attempt.pageNumber,
      } : null),
      isMock: false,
      language: attempt.language,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: attempt.message,
          basis: null,
          sources: [],
          memories: [],
          createdAt: new Date().toISOString(),
        },
      ],
    };
    setHistory((prev) => (prev ? { ...prev, turns: [...prev.turns.filter((t) => t.requestId !== attempt.requestId), optimisticTurn] } : prev));

    try {
      const result = await sendChat(attempt, controller.signal);
      if (alive.current) { setHistory(result); setUncertain(null); setMessage(''); }
    } catch (err) {
      if (alive.current) {
        const errorCode = controller.signal.aborted ? 'chatCancelled' : err instanceof AcademicApiError ? err.message : 'network';
        setError(errorCode);
        recoveryAttempts.current = 5;
        setUncertain(attempt);
        try {
          const recovered = await chatHistory(courseId, AbortSignal.timeout(5000));
          if (alive.current) {
            const saved = recovered.turns.find((turn) => turn.requestId === attempt.requestId);
            if (saved?.status === 'completed') {
              setHistory(recovered);
              setUncertain(null);
              setError('');
            } else if (saved) {
              setHistory(recovered);
            } else {
              // Server did not record turn yet (e.g. network failed before reaching server).
              // Retain optimistic turn as failed so the user never loses their question and can retry!
              const failedTurn: ChatTurn = {
                ...optimisticTurn,
                status: 'failed',
                errorCode,
              };
              setHistory({
                ...recovered,
                turns: [...recovered.turns.filter((t) => t.requestId !== attempt.requestId), failedTurn],
              });
            }
          }
        } catch {
          // If recovering history itself failed, also preserve optimistic turn as failed
          setHistory((prev) => (prev ? {
            ...prev,
            turns: prev.turns.map((t) => t.requestId === attempt.requestId ? { ...t, status: 'failed', errorCode } : t),
          } : prev));
        }
      }
    } finally {
      inFlight.current = false;
      currentAttempt.current = null;
      if (alive.current) setWorking(false);
    }
  }
  function retry(turn: ChatTurn) {
    const user = turn.messages.find((item) => item.role === 'user');
    if (user) {
      void submit({
        courseId,
        requestId: turn.requestId,
        message: user.content,
        language: turn.language,
        provider: turn.provider,
        mode: turn.mode,
        model: turn.model || undefined,
        documentId: turn.sourceTarget?.documentId,
        pageNumber: turn.sourceTarget?.pageNumber,
        sourceTarget: turn.sourceTarget || undefined,
        ...(history?.conversationId && { conversationId: history.conversationId }),
      });
    }
  }
  function chooseMode(value: 'materials' | 'expanded') {
    setMode(value);
    try { localStorage.setItem('student-chat-mode:' + courseId, value); } catch { /* Blocked storage. */ }
  }
  function askExpanded(turn: ChatTurn) {
    const user = turn.messages.find((item) => item.role === 'user');
    if (!user) return;
    chooseMode('expanded'); setProvider(turn.provider);
    try { localStorage.setItem('student-chat-provider:' + courseId, turn.provider); } catch { /* Blocked storage. */ }
    void submit({
      courseId,
      requestId: crypto.randomUUID(),
      message: user.content,
      language: turn.language,
      provider: turn.provider,
      mode: 'expanded',
      model: turn.model || undefined,
      documentId: turn.sourceTarget?.documentId,
      pageNumber: turn.sourceTarget?.pageNumber,
      sourceTarget: turn.sourceTarget || undefined,
      ...(history?.conversationId && { conversationId: history.conversationId }),
    });
  }
  const unresolved = uncertain && !history?.turns.some((turn) => turn.requestId === uncertain.requestId);
  const selected = settings?.chatProviders.find((entry) => entry.id === provider);
  const cloudVerified = cloudState === 'connected';
  const ready = !!selected?.configured &&
    (mode === 'expanded' && !hasReadyMaterials || !!settings?.embedding.configured) &&
    (provider !== 'ollama' || (!!localStatus?.connected && !!localStatus.chatReady && (!hasReadyMaterials || !!localStatus.embeddingReady))) &&
    (provider !== 'ollama-cloud' || (!!localStatus?.connected && cloudVerified && (!hasReadyMaterials || !!localStatus.embeddingReady)));

  async function stop() {
    const requestId = currentAttempt.current?.requestId || history?.turns.find((turn) => turn.status === 'pending')?.requestId;
    if (!requestId) return;
    try { await cancelChat(courseId, requestId); }
    catch { setError('network'); }
    requestController.current?.abort();
    setReload((r) => r + 1);
  }
  const providerLabel = (id: ChatProviderId) => settings?.chatProviders.find((entry) => entry.id === id)?.label || (id === 'mock' ? t('tutor.offlineShort') : id);
  const readyMaterials = materials.filter((m) => m.status === 'ready');

  return <div className="course-chat">
    <div className="student-chat-topbar">
      <div className="student-chat-topbar-left">
        <span className="student-chat-badge">{providerLabel(provider)}</span>
        <select
          className="student-chat-select"
          value={mode}
          disabled={!settings || working || pending || !!unresolved}
          onChange={(event) => chooseMode(event.target.value as 'materials' | 'expanded')}
          aria-label={t('local.mode')}
        >
          <option value="materials">{t('local.materials')}</option>
          <option value="expanded">{t('local.expanded')}</option>
        </select>
        {hasReadyMaterials && (
          <select
            className="student-chat-select"
            value={targetDocId}
            disabled={working || pending || !!unresolved}
            onChange={(event) => setTargetDocId(event.target.value)}
            aria-label={t('providers.targetDocument')}
          >
            <option value="">{t('providers.allMaterials')}</option>
            {readyMaterials.map((m) => (
              <option key={m.id} value={m.id}>{m.originalFilename}</option>
            ))}
          </select>
        )}
      </div>
      <div className="student-chat-topbar-right">
        <span className="student-chat-scope">{t('tutor.courseScope')}</span>
      </div>
    </div>
    {history?.isMock && <p className="student-chat-offline" role="status">{t('tutor.offline')}</p>}
    {!hasReadyMaterials && <p className="student-chat-hint">{t('tutor.noMaterials')}</p>}
    {error && <div className="student-error" role="alert">{t(`errors.${error}`)} <button type="button" onClick={() => setReload((value) => value + 1)}>{t('retry')}</button></div>}
    {!history ? <p>{t('loading')}</p> : <>
      {!history.turns.length && <div className="student-empty">{t('tutor.welcome')}</div>}
      <div className="student-chat-log" role="log" aria-label={t('tutor.history')} aria-live="polite" aria-relevant="additions text">
        {history.turns.map((turn, index) => <div key={turn.id} className="student-chat-turn">
          {turn.messages.map((item) => <article key={item.id} className={`student-chat-message student-chat-${item.role}`}>
            <header>
              <strong>{t(item.role === 'user' ? 'tutor.you' : 'tutor.assistant')}</strong>
              {item.role === 'assistant' && <span>{providerLabel(turn.provider)} · {turn.isMock ? t('tutor.offlineShort') : turn.model} · {t(turn.mode === 'materials' ? 'local.materials' : 'local.expanded')}</span>}
            </header>
            {item.role === 'user' && turn.sourceTarget && (
              <p className="student-target-badge" style={{ fontSize: '12px', color: '#0369a1', margin: '2px 0 6px' }}>
                {t('providers.targetDocument')}: {turn.sourceTarget.documentName || turn.sourceTarget.documentId}
                {turn.sourceTarget.pageNumber ? ` · ${t('page')} ${turn.sourceTarget.pageNumber}` : ''}
              </p>
            )}
            {item.basis && <p className={`student-chat-basis student-chat-basis-${item.basis}`}>{t(`tutor.basis.${item.basis}`)}</p>}
            <div className="student-chat-text">{item.content}</div>
            {item.role === 'assistant' && item.basis === 'insufficient' && turn.mode === 'materials' && index === history.turns.length - 1 && <button type="button" className="student-ask-expanded" disabled={working || pending || !!unresolved || !settings?.chatProviders.find((entry) => entry.id === turn.provider)?.configured} onClick={() => askExpanded(turn)}>{t('local.askExpanded')}</button>}
            {!!item.sources.length && <div className="student-chat-sources"><strong>{t('tutor.sources')}</strong><ul>{item.sources.map((source) => <li key={source.sourceId}><a href={apiUrl(`documents/${source.documentId}/file`)}>{source.documentName} · {t('page')} {source.pageNumber}</a><small>{source.sourceId} · {t('tutor.chunk')} {source.chunkIndex + 1}</small></li>)}</ul></div>}
            {turn.status === 'completed' && item.role === 'assistant' && <button type="button" className="student-save-log" onClick={() => openDraftLog(turn, item)}>{lang === 'vi' ? 'Ghi vào nhật ký' : 'Save to diary'}</button>}
          </article>)}
          {turn.status === 'pending' && (
            <div className="student-chat-pending-indicator" role="status">
              <span className="student-chat-dots"><i></i><i></i><i></i></span>
              <span>{lang === 'vi' ? 'Đang tìm kiếm...' : 'Searching...'}</span>
            </div>
          )}
          {turn.status === 'failed' && <div className="student-chat-failed"><p>{t(`errors.${turn.errorCode || 'aiUnavailable'}`)}</p>{index === history.turns.length - 1 && <button type="button" disabled={working || pending || (turn.mode === 'materials' && !hasReadyMaterials)} onClick={() => retry(turn)}>{t('tutor.retry')}</button>}</div>}
        </div>)}
        {working && !pending && (
          <div className="student-chat-pending-indicator" role="status">
            <span className="student-chat-dots"><i></i><i></i><i></i></span>
            <span>{lang === 'vi' ? 'Đang tìm kiếm...' : 'Searching...'}</span>
          </div>
        )}
        {(working || pending) && <button type="button" onClick={() => void stop()}>{t('local.stop')}</button>}
        <div ref={bottom} />
      </div>
      {unresolved && <button type="button" disabled={working || pending} onClick={() => void submit(uncertain)}>{t('tutor.retry')}</button>}
      <form className="student-chat-compose" onSubmit={(event) => {
        event.preventDefault();
        const text = message.trim();
        if (!text) return;
        if (!ready) return;
        setMessage('');
        void submit({
          courseId,
          message: text,
          provider,
          mode,
          model: provider === 'ollama-cloud' ? cloudModel : undefined,
          documentId: targetDocId || undefined,
          webSearch: false,
          requestId: crypto.randomUUID(),
          language: lang === 'vi' ? 'vi' : 'en',
          ...(history.conversationId && { conversationId: history.conversationId }),
        });
      }}>
        <div className="student-study-actions" role="group" aria-label="Chế độ học tập">
          <button
            type="button"
            className="student-study-action-btn"
            disabled={working || pending}
            onClick={() => {
              setMessage(lang === 'vi'
                ? 'Khảo bài: Hãy đặt 1 câu hỏi trọng tâm từ tài liệu môn học để tôi tự trả lời. Chưa đưa ra đáp án, hãy chờ tôi trả lời rồi chấm điểm trên thang điểm 10, phân tích điểm đúng/thiếu và trích dẫn trang nguồn.'
                : 'Socratic Quiz: Ask me 1 core question from course materials for me to answer. Do not give the answer yet; wait for my answer then evaluate on a 10-point scale.');
            }}
          >
            {lang === 'vi' ? 'Khảo bài' : 'Active Recall'}
          </button>
          <button
            type="button"
            className="student-study-action-btn"
            disabled={working || pending}
            onClick={() => {
              setMessage(lang === 'vi'
                ? 'Tạo trắc nghiệm: Hãy tạo 3-5 câu hỏi trắc nghiệm A, B, C, D từ tài liệu môn học kèm đáp án đúng và giải thích chi tiết trích dẫn từ tài liệu.'
                : 'Generate Quiz: Create 3-5 multiple-choice questions A, B, C, D from course materials with correct answers and explanations.');
            }}
          >
            {lang === 'vi' ? 'Tạo trắc nghiệm' : 'Quiz Generator'}
          </button>
          <button
            type="button"
            className="student-study-action-btn"
            disabled={working || pending}
            onClick={() => {
              setMessage(lang === 'vi'
                ? 'Tóm tắt cốt lõi: Hãy tóm tắt các định nghĩa, công thức, bảng so sánh và các điểm mấu chốt hay ra thi từ tài liệu môn học dưới dạng phao kiến thức dễ nhớ.'
                : 'Core Cheatsheet: Summarize essential definitions, formulas, comparisons, and exam tips from course materials.');
            }}
          >
            {lang === 'vi' ? 'Tóm tắt cốt lõi' : 'Cheatsheet'}
          </button>
          <button
            type="button"
            className="student-study-action-btn"
            disabled={working || pending}
            onClick={() => {
              setMessage(lang === 'vi'
                ? 'Tạo Flashcards: Hãy tạo 5-8 thẻ ghi nhớ từ tài liệu môn học theo định dạng rõ ràng: Mặt trước là Thuật ngữ / Câu hỏi ngắn, Mặt sau là Định nghĩa cốt lõi và ví dụ ngắn.'
                : 'Create Flashcards: Generate 5-8 flashcards from course materials: Front = Term/Question, Back = Definition/Explanation.');
            }}
          >
            {lang === 'vi' ? 'Tạo Flashcards' : 'Flashcards'}
          </button>
        </div>
        <label htmlFor={`chat-question-${courseId}`}>{t('tutor.question')}</label>
        <textarea id={`chat-question-${courseId}`} rows={3} maxLength={4000} placeholder={t('tutor.placeholder')} value={message} onChange={(event) => setMessage(event.target.value)} disabled={working || pending || !!unresolved} />
        <div><small>{message.length}/4000 · {t('tutor.enterHint')}</small><button className="student-primary" type="submit" disabled={working || pending || !message.trim() || (mode === 'materials' && !hasReadyMaterials) || !!unresolved || !ready}>{working || pending ? t('tutor.responding') : t('tutor.send')}</button></div>
      </form>
    </>}
    {draftLog && (
      <StudyLogDraftModal
        draft={draftLog}
        courses={[{ id: courseId, name: courseId }]}
        todayDate={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}
        lang={lang}
        onSaved={() => setDraftLog(null)}
        onClose={() => setDraftLog(null)}
      />
    )}
  </div>;
}
