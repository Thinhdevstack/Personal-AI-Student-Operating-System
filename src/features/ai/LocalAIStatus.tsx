'use client';

import { useEffect, useState } from 'react';
import { createT } from '@/i18n/index.js';
import { localAIStatus } from './api';
import type { LocalAIStatus as Status } from './types';

export function useLocalStatus(enabled: boolean, revision: number) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    localAIStatus(controller.signal).then(setStatus).catch(() => {
      if (!controller.signal.aborted) setStatus({ connected: false, chatReady: false, embeddingReady: false, models: [] });
    });
    return () => controller.abort();
  }, [enabled, revision]);
  return status;
}

export function LocalStatusView({ lang, status, refresh }: { lang: string; status: Status | null; refresh: () => void }) {
  const translate = createT(lang);
  const t = (key: string) => String(translate('student.local.' + key));
  return <div className="student-local-status" role="status">
    <strong>{t(!status ? 'checking' : !status.connected ? 'disconnected' : status.chatReady && status.embeddingReady ? 'connected' : 'missingModel')}</strong>
    {status?.chatModel && <small>{status.chatModel} · {status.embeddingModel}</small>}
    {status && (!status.connected || !status.chatReady || !status.embeddingReady) && <p>{t('setupHint')}</p>}
    <button type="button" onClick={refresh}>{t('refresh')}</button>
  </div>;
}

export default function LocalAIStatus({ lang }: { lang: string }) {
  const [revision, setRevision] = useState(0);
  const status = useLocalStatus(true, revision);
  return <LocalStatusView lang={lang} status={status} refresh={() => setRevision((r) => r + 1)} />;
}
