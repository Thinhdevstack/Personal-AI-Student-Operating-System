'use client';

import { useEffect, useRef, useState } from 'react';
import { createT } from '@/i18n/index.js';
import { AcademicApiError, mutate, snapshot } from './api';
import type { AcademicSnapshot } from './types';
import LocalAIStatus from '@/features/ai/LocalAIStatus';

export default function StudentDemoPanel({ lang, office = false, local = false, onSeed }: { lang: string; office?: boolean; local?: boolean; onSeed?: (data: AcademicSnapshot) => void }) {
  const translate = createT(lang);
  const t = (key: string) => String(translate('student.' + (local && ['title', 'explanation', 'storage', 'step1', 'step2', 'step3', 'emptyCourses'].includes(key) ? 'local.' : 'demo.') + key));
  const [data, setData] = useState<AcademicSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState('');
  const [token, setToken] = useState('');
  const picker = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const refresh = () => {
      if (loading || controller.signal.aborted) return;
      loading = true;
      snapshot(controller.signal).then((result) => {
        if (!controller.signal.aborted) { setData(result); setToken(new URLSearchParams(location.search).get('k') || ''); setError(''); }
      }).catch((err) => { if (!controller.signal.aborted) setError(err instanceof AcademicApiError ? err.message : 'network'); }).finally(() => { loading = false; });
    };
    if (office) { refresh(); window.addEventListener('focus', refresh); }
    const focus = () => { picker.current?.focus(); picker.current?.scrollIntoView({ block: 'nearest' }); };
    if (office) document.getElementById('btn-chat')?.addEventListener('click', focus);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); document.getElementById('btn-chat')?.removeEventListener('click', focus); };
  }, [office]);
  const courses = data?.courses.filter((course) => course.status === 'active' && data.semesters.some((semester) => semester.id === course.semesterId && semester.status === 'active')) || [];
  const selectedId = courses.find((course) => course.id === selected)?.id || courses[0]?.id;
  const href = new URLSearchParams({ lang, ...(token && { k: token }), ...(selectedId && { course: selectedId, tab: 'chat' }) });
  async function seed() {
    if (busy) return;
    setBusy(true); setError(''); setDone(false);
    try { const result = await mutate<AcademicSnapshot>('demo/seed', 'POST'); setData(result); onSeed?.(result); setDone(true); }
    catch (err) { setError(err instanceof AcademicApiError ? err.message : 'serverError'); }
    finally { setBusy(false); }
  }
  return <section className={`student-demo-panel${office ? ' student-demo-office' : ''}`} aria-label={t('title')}>
    <strong className="student-demo-badge">{t('title')}</strong>
    <p className="student-demo-explanation">{t('explanation')}</p>
    <p className="student-demo-storage">{t('storage')}</p>
    {local ? <LocalAIStatus lang={lang} /> : <button type="button" className="student-demo-seed" disabled={busy} onClick={() => void seed()}>{t(busy ? 'seeding' : 'seed')}</button>}
    {done && <p role="status">{t('seeded')}</p>}
    {error && <p role="alert">{String(translate('student.errors.' + error))}</p>}
    <ol><li>{t('step1')}</li><li>{t('step2')}</li><li>{t('step3')}</li></ol>
    {office && <div className="student-demo-courses" id="student-demo-courses">
      <label htmlFor="demo-course-picker">{t('chooseCourse')}</label>
      <select ref={picker} id="demo-course-picker" value={selectedId || ''} onChange={(event) => setSelected(event.target.value)}>
        {!courses.length && <option value="">{t('emptyCourses')}</option>}
        {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select>
      <small>{t('courseCount').replace('{n}', String(courses.length))}</small>
      <a className="student-demo-open" href={`/student?${href}`} target="_blank" rel="noopener">{t(selectedId ? 'openChat' : 'openAcademic')} ↗</a>
    </div>}
  </section>;
}
