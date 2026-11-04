'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createT } from '@/i18n/index.js';
import { AcademicApiError } from '@/features/academic/api';
import { createMemory, deleteMemory, listMemories, updateMemory } from './api';
import type { MemorySource, MemoryTarget, SavedMemory } from './types';

type MemoryEditorProps = {
  lang: string; target: MemoryTarget; memory?: SavedMemory; initialContent?: string;
  source?: MemorySource; allowGlobal?: boolean; onClose: () => void; onSaved: () => void;
};

export function MemoryEditor({ lang, target, memory, initialContent = '', source, allowGlobal, onClose, onSaved }: MemoryEditorProps) {
  const translate = createT(lang);
  const t = (key: string) => String(translate(`student.${key}`));
  const contentId = useId();
  const [content, setContent] = useState(memory?.content || initialContent.slice(0, 1000));
  const [scope, setScope] = useState(target.scope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  // Keep the exact payload and request ID on a network retry; rotate only after an edit.
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="student-modal memory-editor" aria-labelledby="memory-editor-title" onCancel={(event) => { if (inFlight.current) event.preventDefault(); else onClose(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (inFlight.current || !content.trim()) return;
      inFlight.current = true; setBusy(true); setError(''); setNotice('');
      const dest: MemoryTarget = scope === 'global' ? { scope: 'global' } : target;
      const payload = JSON.stringify({ ...dest, content: content.trim(), source });
      if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
      try {
        if (memory) await updateMemory(memory.id, target, content.trim());
        else await createMemory(dest, content.trim(), attempt.current.id, source);
        onSaved(); onClose();
      } catch (err) {
        setError(err instanceof AcademicApiError ? err.message : 'network');
        setNotice('memory.retryHint');
      } finally { inFlight.current = false; setBusy(false); }
    }}>
      <h2 id="memory-editor-title">{t(memory ? 'memory.edit' : 'memory.create')}</h2>
      <p>{t('memory.explicitHint')}</p>
      {initialContent.length > 1000 && <p>{t('memory.truncated')}</p>}
      {error && <p className="student-error" role="alert">{t(`errors.${error}`)}</p>}
      {notice && <p>{t(notice)}</p>}
      {allowGlobal && target.scope === 'course' && !memory ? <label>{t('memory.scope')}<select value={scope} onChange={(event) => setScope(event.target.value as 'global' | 'course')} disabled={busy}>
        <option value="course">{t('memory.course')}</option><option value="global">{t('memory.global')}</option>
      </select></label> : <p className="student-memory-scope">{t(target.scope === 'global' ? 'memory.global' : 'memory.course')}</p>}
      {scope === 'global' && <p>{t('memory.globalHint')}</p>}
      {source && <p>{t('memory.fromChat')}</p>}
      <label htmlFor={contentId}>{t('memory.content')}</label><textarea id={contentId} autoFocus required rows={5} maxLength={1000} value={content} onChange={(event) => setContent(event.target.value)} disabled={busy} />
      <small>{content.length}/1000</small>
      <div className="student-actions"><button type="button" disabled={busy} onClick={onClose}>{t('cancel')}</button><button className="student-primary" type="submit" disabled={busy || !content.trim()}>{t(busy ? 'working' : 'save')}</button></div>
    </form>
  </dialog>;
}

export default function MemoryWorkspace({ lang, target, onChange }: { lang: string; target: MemoryTarget; onChange?: () => void }) {
  const translate = createT(lang);
  const t = (key: string) => String(translate(`student.${key}`));
  const [items, setItems] = useState<SavedMemory[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<SavedMemory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SavedMemory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const scope = target.scope, courseId = target.scope === 'course' ? target.courseId : null;
  useEffect(() => {
    const controller = new AbortController();
    listMemories(scope === 'global' ? { scope } : { scope, courseId: courseId! }, controller.signal).then((result) => { if (!controller.signal.aborted) setItems(result); }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof AcademicApiError ? err.message : 'network'); });
    return () => controller.abort();
  }, [scope, courseId, revision]);
  useEffect(() => { const dialog = confirmDialog.current; if (deleting) dialog?.showModal(); return () => dialog?.close(); }, [deleting]);
  function changed() { setRevision((value) => value + 1); setNotice('success'); setError(''); onChange?.(); }
  return <div className="memory-workspace">
    <div className="student-section-heading"><h2>{t(scope === 'global' ? 'memory.global' : 'memory.course')}</h2><button className="student-primary" disabled={!items} onClick={() => setEditor('new')}>+ {t('memory.create')}</button></div>
    <p>{t(scope === 'global' ? 'memory.globalHint' : 'memory.courseHint')}</p>
    <p>{t('memory.explicitHint')}</p>
    {error && <p className="student-error" role="alert">{t(`errors.${error}`)} <button onClick={() => { setError(''); setRevision((value) => value + 1); }}>{t('retry')}</button></p>}
    <p role="status" className="student-notice">{notice && t(notice)}</p>
    {!items ? <p>{t('loading')}</p> : !items.length ? <div className="student-empty">{t('memory.empty')}</div> : <ul className="student-memory-list">{items.map((item) => <li key={item.id} data-memory-id={item.id}>
      <div><span className="student-memory-scope">{t(item.scope === 'global' ? 'memory.global' : 'memory.course')}</span><p className="student-memory-content">{item.content}</p><small>{t('memory.updated')} {new Date(item.updatedAt).toLocaleString(lang)}{item.sourceMessageId && ` · ${t('memory.fromChat')}`}</small></div>
      <div className="student-actions"><button disabled={busy} onClick={() => setEditor(item)}>{t('memory.edit')}</button><button disabled={busy} onClick={() => setDeleting(item)}>{t('memory.delete')}</button></div>
    </li>)}</ul>}
    {editor && <MemoryEditor lang={lang} target={target} memory={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={changed} />}
    {deleting && <dialog ref={confirmDialog} className="student-modal" aria-labelledby="memory-delete-title" onCancel={(event) => { if (inFlight.current) event.preventDefault(); else setDeleting(null); }}>
      <h2 id="memory-delete-title">{t('memory.delete')}</h2><p>{t('memory.deleteHint')}</p><p className="student-memory-content">{deleting.content}</p>
      {error && <p className="student-error" role="alert">{t(`errors.${error}`)}</p>}
      <div className="student-actions"><button disabled={busy} onClick={() => setDeleting(null)}>{t('cancel')}</button><button className="student-primary" disabled={busy} onClick={async () => {
        if (inFlight.current) return; inFlight.current = true; setBusy(true); setError('');
        try { await deleteMemory(deleting.id, target); setDeleting(null); changed(); }
        catch (err) { setError(err instanceof AcademicApiError ? err.message : 'network'); }
        finally { inFlight.current = false; setBusy(false); }
      }}>{t(busy ? 'working' : 'confirm')}</button></div>
    </dialog>}
  </div>;
}
