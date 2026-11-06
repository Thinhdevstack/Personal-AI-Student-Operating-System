import { getLang, getT } from '@/i18n/server';
import StudentWorkspace from '@/features/academic/StudentWorkspace';
import '@/styles/student.css';
import { getStudentDemo, getStudentLocal } from '@/features/academic/server-mode';

export default async function StudentPage() {
  if (process.env.OFFICE_STATIC === '1') {
    const t = await getT();
    return <main className="student-static"><h1>{t('student.title')}</h1><p>{t('student.staticOnly')}</p></main>;
  }
  return <StudentWorkspace lang={await getLang()} studentDemo={await getStudentDemo()} studentLocal={await getStudentLocal()} />;
}
