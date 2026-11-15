import { getLang } from '@/i18n/server';
import StudentPreview from '@/features/student-preview/StudentPreview';

export const metadata = {
  title: 'Student OS · Bản xem trước P5',
  description: 'Bản xem trước thiết kế lại giao diện Student OS (Hôm nay & Trợ lý học tập)',
};

export default async function StudentPreviewPage() {
  const lang = await getLang();
  return <StudentPreview lang={lang} />;
}

