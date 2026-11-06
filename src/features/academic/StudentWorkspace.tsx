'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createT } from '@/i18n/index.js';
import type { AcademicSnapshot, Course, Material, SearchResult, Semester } from './types';
import * as api from './api';
import CourseChat from '@/features/ai/CourseChat';
import MemoryWorkspace from '@/features/ai/MemoryWorkspace';
import StudentDemoPanel from './StudentDemoPanel';

type Tab = 'overview' | 'materials' | 'chat' | 'memory' | 'progress';
type Editor = { kind: 'semester' | 'course'; action: 'create' | 'rename' | 'archive' | 'delete'; id?: string; name?: string };
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export default function StudentWorkspace({ lang, studentDemo = false, studentLocal = false }: { lang: string; studentDemo?: boolean; studentLocal?: boolean }) {
  const translate = createT(lang);
  const t = (key: string) => String(translate(`student.${key}`));
  const [data, setData] = useState<AcademicSnapshot | null>(null);
  const [semesterId, setSemesterId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [view, setView] = useState<'today' | 'academic' | 'memory'>('today');
  const [tab, setTab] = useState<Tab>('overview');
  const [showArchived, setShowArchived] = useState(false);
  const [library, setLibrary] = useState<{ courseId: string; items: Material[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [officeHref, setOfficeHref] = useState('/');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadLock = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native modal dialogs provide keyboard focus containment and restore focus on close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (editor && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [editor]);

  useEffect(() => {
    const controller = new AbortController();
    api.snapshot(controller.signal).then((result) => {
      setData(result);
      const params = new URLSearchParams(window.location.search);
      const selected = result.courses.find((c) => c.id === params.get('course'));
      setSemesterId(selected?.semesterId || result.semesters.find((s) => s.isActive)?.id || result.semesters.find((s) => s.status === 'active')?.id || '');
      if (selected) {
        setCourseId(selected.id); setView('academic'); setTab(params.get('tab') === 'chat' ? 'chat' : params.get('tab') === 'memory' ? 'memory' : 'materials');
        setShowArchived(selected.status === 'archived');
      }
      if (params.get('view') === 'memory') setView('memory');
      const officeParams = new URLSearchParams();
      for (const key of ['k', 'lang']) if (params.get(key)) officeParams.set(key, params.get(key)!);
      setOfficeHref(`/${officeParams.size ? `?${officeParams}` : ''}`);
    }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof api.AcademicApiError ? err.message : 'network'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!courseId) return;
    const controller = new AbortController();
    api.materials(courseId, controller.signal).then((items) => setLibrary({ courseId, items })).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof api.AcademicApiError ? err.message : 'network');
    });
    return () => controller.abort();
  }, [courseId, revision]);

  // Auto-refresh when any document is in processing state
  useEffect(() => {
    const hasProcessing = library?.items.some((m) => m.status === 'processing');
    if (!hasProcessing) return;
    const timer = setTimeout(() => {
      setRevision((r) => r + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [library?.items]);

  const semester = data?.semesters.find((s) => s.id === semesterId);
  const course = data?.courses.find((c) => c.id === courseId);
  const current = data?.semesters.find((s) => s.isActive);
  const courses = data?.courses.filter((c) => c.semesterId === semesterId && (showArchived || c.status === 'active')) || [];
  const courseMaterials = library?.courseId === courseId ? library.items : null;

  function chooseTab(value: Tab) {
    setTab(value);
    const url = new URL(window.location.href); url.searchParams.set('tab', value); window.history.replaceState(null, '', url);
  }

  function chooseCourse(item: Course) {
    setSemesterId(item.semesterId); setCourseId(item.id); setView('academic'); setTab('overview'); setError(''); setNotice('');
    setSearchQuery(''); setSearchResults(null);
    const url = new URL(window.location.href); url.searchParams.set('course', item.id); url.searchParams.delete('view'); url.searchParams.delete('tab'); window.history.replaceState(null, '', url);
  }
  function chooseSemester(id: string) {
    setSemesterId(id); setCourseId(''); setView('academic');
    setSearchQuery(''); setSearchResults(null);
    const url = new URL(window.location.href); url.searchParams.delete('course'); url.searchParams.delete('view'); url.searchParams.delete('tab'); window.history.replaceState(null, '', url);
  }
  function chooseView(next: 'today' | 'academic' | 'memory') {
    setView(next);
    const url = new URL(window.location.href);
    if (next === 'memory') url.searchParams.set('view', 'memory'); else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }
  function refreshSnapshot() { void api.snapshot().then(setData).catch(() => setError('network')); }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await action();
      const result = await api.snapshot(); setData(result); setRevision((value) => value + 1);
      setNotice('success'); setEditor(null);
    } catch (err) { setError(err instanceof api.AcademicApiError ? err.message : 'network'); }
    finally { setBusy(false); }
  }
  function uploadFiles(files: File[]) {
    if (busy || uploadLock.current || !course || course.status !== 'active') return;
    if (files.length !== 1) { setError('onePdf'); return; }
    const file = files[0];
    if (!/\.pdf$/i.test(file.name)) { setError('invalidFile'); return; }
    if (!file.size || file.size > MAX_PDF_BYTES) { setError('fileTooLarge'); return; }
    const target = course.id;
    uploadLock.current = true;
    void run(async () => {
      const uploaded = await api.upload(target, file);
      void api.processDocument(uploaded.id).finally(() => setRevision((r) => r + 1)).catch(() => {});
    }).finally(() => { uploadLock.current = false; });
  }
  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      const base = editor.kind === 'semester' ? 'semesters' : 'courses';
      if (editor.action === 'create') {
        if (editor.kind === 'semester') {
          const item = await api.mutate<Semester>(base, 'POST', values); chooseSemester(item.id);
        } else {
          const item = await api.mutate<Course>(base, 'POST', { ...values, semesterId }); chooseCourse(item);
        }
      } else if (editor.action === 'delete') {
        await api.mutate(`${base}/${editor.id}`, 'DELETE'); chooseSemester(semesterId);
      } else {
        await api.mutate(`${base}/${editor.id}`, 'PATCH', { action: editor.action, ...values });
        if (editor.action === 'archive') { setShowArchived(true); }
      }
    });
  }
  function actions(kind: 'semester' | 'course', item: Semester | Course) {
    return <div className="student-actions">
      <button disabled={busy} onClick={() => setEditor({ kind, action: 'rename', id: item.id, name: item.name })}>{t('rename')}</button>
      {item.status === 'active' && <button disabled={busy} onClick={() => setEditor({ kind, action: 'archive', id: item.id })}>{t('archive')}</button>}
      {kind === 'semester' && item.status === 'active' && !(item as Semester).isActive && <button disabled={busy} onClick={() => void run(async () => { await api.mutate(`semesters/${item.id}`, 'PATCH', { action: 'activate' }); })}>{t('activate')}</button>}
      {kind === 'course' && <button disabled={busy || !!(item as Course).hasData || courseMaterials === null || courseMaterials.length > 0} onClick={() => setEditor({ kind, action: 'delete', id: item.id })}>{t('delete')}</button>}
    </div>;
  }
  function materialList(items: Material[]) {
    return <ul className="student-materials">{items.map((item) => <li key={item.id}>
      <span className="student-file-icon" aria-hidden="true">PDF</span>
      <div>
        <strong>{item.originalFilename}</strong>
        <small>
          {(item.sizeBytes / 1024).toFixed(1)} KiB · {new Date(item.uploadedAt).toLocaleDateString(lang)} ·{' '}
          <span className={`student-status-badge student-status-${item.status}`}>
            {t(`status.${item.status}`)}
          </span>
          {item.status === 'ready' && item.indexReady === false && <span className="student-index-hint">{t('local.reindexHint')}</span>}
          {item.processingError && item.status === 'ready' && <span>{t(`errors.${item.processingError}`)}</span>}
          {item.status === 'ready' && item.pageCount && ` · ${item.pageCount} ${t('pages')}`}
          {item.status === 'ready' && typeof item.chunkCount === 'number' && ` · ${item.chunkCount} ${t('chunks')}`}
          {item.status === 'failed' && item.processingError && ` (${t(`errors.${item.processingError}`) || item.processingError})`}
        </small>
      </div>
      <div className="student-material-actions">
        {item.status === 'uploaded' && course?.status === 'active' && (
          <button disabled={busy} onClick={() => void run(async () => { await api.processDocument(item.id); })}>
            {t('process')}
          </button>
        )}
        {item.status === 'failed' && course?.status === 'active' && (
          <button disabled={busy} onClick={() => void run(async () => { await api.processDocument(item.id); })}>
            {t('processRetry')}
          </button>
        )}
        {item.status === 'ready' && course?.status === 'active' && <button disabled={busy} onClick={() => void run(async () => { await api.processDocument(item.id); })}>{t('reprocess')}</button>}
        <a href={api.apiUrl(`documents/${item.id}/file`)}>{t('download')}</a>
      </div>
    </li>)}</ul>;
  }
  return <div className="student-shell">
    <aside className="student-sidebar">
      <a className="student-brand" href={officeHref}>◈ {t('office')}</a>
      <p className="student-eyebrow">{t('title')}</p>
      <nav aria-label={t('title')}>
        <button aria-current={view === 'today' ? 'page' : undefined} onClick={() => chooseView('today')}>{t('today')}</button>
        <button aria-current={view === 'academic' ? 'page' : undefined} onClick={() => chooseView('academic')}>{t('academic')}</button>
        <button aria-current={view === 'memory' ? 'page' : undefined} onClick={() => chooseView('memory')}>{t('memory.global')}</button>
        <a href={officeHref}>{t('projects')}</a>
      </nav>
      <div className="student-sidebar-section">
        <label htmlFor="semester-picker">{t('semester')}</label>
        <select id="semester-picker" value={semesterId} onChange={(event) => chooseSemester(event.target.value)}>
          <option value="">—</option>
          {data?.semesters.filter((s) => showArchived || s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.academicYear} · {s.name}{s.isActive ? ` · ${t('current')}` : ''}{s.status === 'archived' ? ` · ${t('archived')}` : ''}</option>)}
        </select>
        <label className="student-check"><input type="checkbox" checked={showArchived} onChange={(event) => {
          setShowArchived(event.target.checked);
          if (!event.target.checked && semester?.status === 'archived') chooseSemester(current?.id || '');
          else if (!event.target.checked && course?.status === 'archived') chooseSemester(semesterId);
        }} />{t('showArchived')}</label>
        <button disabled={busy || !data} onClick={() => setEditor({ kind: 'semester', action: 'create' })}>+ {t('createSemester')}</button>
      </div>
      <div className="student-course-links">{courses.map((item) => <button key={item.id} aria-current={view === 'academic' && courseId === item.id ? 'page' : undefined} onClick={() => chooseCourse(item)}><span>{item.name}</span><small>{item.code || t(`status.${item.status}`)}</small></button>)}</div>
    </aside>
    <main className="student-main" aria-busy={busy}>
      <header className="student-page-heading"><div><p className="student-eyebrow">{t('title')}</p><h1>{view === 'memory' ? t('memory.global') : view === 'today' ? t('today') : course?.name || semester?.name || t('academic')}</h1><p>{view === 'memory' ? t('memory.globalHint') : view === 'today' ? t('subtitle') : course?.code || semester?.academicYear}</p></div><a href={officeHref} target="_blank" rel="noopener" title={t('officeActivity.open')}>{t('office')} ↗</a></header>
      {error && <div role="alert" className="student-error">{t(`errors.${error}`)} <button onClick={() => window.location.reload()}>{t('retry')}</button></div>}
      <div role="status" className="student-notice">{busy ? t('working') : notice ? t(notice) : ''}</div>
      {(studentDemo || studentLocal) && <StudentDemoPanel lang={lang} local={studentLocal} onSeed={(result) => {
        setData(result); setSemesterId((value) => value || result.semesters.find((item) => item.isActive)?.id || result.semesters[0]?.id || ''); setRevision((value) => value + 1);
      }} />}
      {!data ? <p>{t('loading')}</p> : view === 'memory' ? <section className="student-panel"><MemoryWorkspace lang={lang} target={{ scope: 'global' }} /></section> : view === 'today' ? <>
        <section className="student-hero"><p className="student-eyebrow">{t('activeSemester')}</p><h2>{current?.name || t('noActive')}</h2><p>{current?.academicYear || t('todayHint')}</p>
          <button className="student-primary" onClick={() => current ? chooseSemester(current.id) : setEditor({ kind: 'semester', action: 'create' })}>{current ? t('academic') : t('createSemester')} →</button>
        </section>
        <section><h2>{t('courses')}</h2><div className="student-cards">{data.courses.filter((c) => c.semesterId === current?.id && c.status === 'active').map((item) => <button className="student-card" key={item.id} onClick={() => chooseCourse(item)}><small>{item.code || t('academic')}</small><h3>{item.name}</h3><span>{t('overview')} →</span></button>)}</div></section>
        <section className="student-panel"><h2>{t('recentMaterials')}</h2>{data.recentMaterials.length ? materialList(data.recentMaterials) : <p>{t('noRecent')}</p>}</section>
      </> : <>
        {!semester ? <section className="student-panel"><p>{t('noSemester')}</p><button onClick={() => setEditor({ kind: 'semester', action: 'create' })}>{t('createSemester')}</button></section> : !course ? <>
          {actions('semester', semester)}
          <section className="student-panel"><div className="student-section-heading"><h2>{t('courses')}</h2>{semester.status === 'active' && <button className="student-primary" disabled={busy} onClick={() => setEditor({ kind: 'course', action: 'create' })}>+ {t('createCourse')}</button>}</div>
            <div className="student-cards">{courses.map((item) => <button className="student-card" key={item.id} onClick={() => chooseCourse(item)}><small>{item.code || t(`status.${item.status}`)}</small><h3>{item.name}</h3><span>{t('overview')} →</span></button>)}</div>{!courses.length && <p>{t('emptyCourses')}</p>}
          </section>
        </> : <>
          <button className="student-breadcrumb" onClick={() => chooseSemester(semester.id)}>← {semester.name}</button>
          {actions('course', course)}
          <div className="student-tabs" role="group" aria-label={course.name}>{(['overview', 'materials', 'chat', 'memory', 'progress'] as Tab[]).map((item) => <button key={item} aria-pressed={tab === item} onClick={() => chooseTab(item)}>{t(item === 'memory' ? 'memory.tab' : item)}</button>)}</div>
          <section className="student-panel">
            {course.status === 'archived' && <p className="student-archive-note">{t('archivedHint')}</p>}
            {tab === 'overview' && <><h2>{course.name}</h2><p>{course.description || t('selectCourse')}</p><p>{t('semester')}: {semester.name} · {semester.academicYear}</p><p>{t(`status.${course.status}`)}</p><button onClick={() => setTab('materials')}>{t('materials')} →</button></>}
            {tab === 'materials' && <><div className="student-section-heading"><h2>{t('materials')}</h2>{course.status === 'active' && <label className={`student-upload ${busy ? 'is-disabled' : ''}`}>{t('upload')}<input aria-label={t('upload')} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => {
              const files = Array.from(event.target.files || []); event.target.value = '';
              if (files.length) uploadFiles(files);
            }} /></label>}</div><p>{t('pdfHint')}</p>
              {course.status === 'active' && <div className={`student-dropzone${dragging ? ' is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); uploadFiles(Array.from(event.dataTransfer.files)); }} aria-busy={busy}>{t(busy ? 'local.uploading' : 'local.dropPdf')}</div>}
              {courseMaterials === null ? <p>{t('loading')}</p> : courseMaterials.length ? materialList(courseMaterials) : <div className="student-empty">{t('emptyMaterials')}</div>}
              <p className="student-footnote">{t('uploadedHint')}</p>

              {/* Course-scoped search testing UI */}
              <div className="student-search-panel">
                <h3>{t('searchMaterials')}</h3>
                <form className="student-search-form" onSubmit={async (e) => {
                  e.preventDefault();
                  if (!searchQuery.trim() || searching) return;
                  setSearching(true);
                  setError('');
                  try {
                    const res = await api.searchCourse(course.id, searchQuery);
                    setSearchResults(res.results);
                  } catch (err) {
                    setError(err instanceof api.AcademicApiError ? err.message : 'network');
                  } finally {
                    setSearching(false);
                  }
                }}>
                  <input
                    type="text"
                    placeholder={t('searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <button type="submit" disabled={searching || !searchQuery.trim()}>
                    {searching ? t('searching') : t('searchButton')}
                  </button>
                </form>
                {searchResults !== null && (
                  <div style={{ marginTop: '16px' }}>
                    <h4>{t('searchResults')}</h4>
                    {searchResults.length === 0 ? (
                      <p>{t('noResults')}</p>
                    ) : (
                      <ul className="student-search-results">
                        {searchResults.map((r, i) => (
                          <li key={i}>
                            <strong>{r.documentName}</strong> — {t('page')} {r.pageNumber} <small>({t('score')}: {r.score})</small>
                            <div className="student-search-snippet">{r.content}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>}
            {tab === 'chat' && <CourseChat key={course.id} courseId={course.id} lang={lang} hasReadyMaterials={!!courseMaterials?.some((item) => item.status === 'ready')} onMemoryChange={refreshSnapshot} />}
            {tab === 'memory' && <MemoryWorkspace key={course.id} lang={lang} target={{ scope: 'course', courseId: course.id }} onChange={refreshSnapshot} />}
            {tab === 'progress' && <p>{t('progressPending')}</p>}
          </section>
        </>}
      </>}
    </main>
    {editor && <dialog ref={dialogRef} className="student-modal" aria-labelledby="student-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else { setEditor(null); setError(''); } }}>
      <form onSubmit={saveEditor}><h2 id="student-editor-title">{t(editor.action === 'create' ? editor.kind === 'semester' ? 'createSemester' : 'createCourse' : editor.action)}</h2>
        {error && <p role="alert" className="student-error">{t(`errors.${error}`)}</p>}
        {['create', 'rename'].includes(editor.action) && <label>{t('name')}<input name="name" autoFocus required maxLength={120} defaultValue={editor.name || ''} /></label>}
        {editor.action === 'create' && editor.kind === 'semester' && <><label>{t('academicYear')}<input name="academicYear" required maxLength={60} placeholder="2026–2027" /></label><div className="student-dates"><label>{t('startDate')}<input type="date" name="startDate" /></label><label>{t('endDate')}<input type="date" name="endDate" /></label></div></>}
        {editor.action === 'create' && editor.kind === 'course' && <><label>{t('code')}<input name="code" maxLength={40} /></label><label>{t('description')}<textarea name="description" maxLength={2000} rows={3} /></label></>}
        {editor.action === 'archive' && <p>{t('archiveConfirm')}</p>}{editor.action === 'delete' && <p>{t('deleteConfirm')}</p>}
        <div className="student-actions"><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>{t('cancel')}</button><button className="student-primary" disabled={busy} type="submit">{busy ? t('working') : t(['archive', 'delete'].includes(editor.action) ? 'confirm' : 'save')}</button></div>
      </form>
    </dialog>}
  </div>;
}
