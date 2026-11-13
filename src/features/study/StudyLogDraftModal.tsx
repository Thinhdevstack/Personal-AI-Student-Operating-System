'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ActivityType } from './types';
import * as api from './api';

export interface DraftLogData {
  courseId?: string | null;
  title: string;
  activityType?: ActivityType;
  durationMinutes?: number | null;
  learnedContent: string;
  difficulties?: string;
  nextSteps?: string;
  sourceTurnId?: string;
  sourceConversationId?: string;
}

interface StudyLogDraftModalProps {
  draft: DraftLogData;
  courses: { id: string; name: string; code?: string }[];
  todayDate: string;
  lang?: string;
  onSaved: () => void;
  onClose: () => void;
}

const ACTIVITY_LABELS = {
  vi: {
    read: 'Đọc tài liệu',
    assignment: 'Làm bài tập',
    review: 'Ôn tập kiến thức',
    practice: 'Thực hành code',
    other: 'Khác',
  },
  en: {
    read: 'Reading materials',
    assignment: 'Assignment / Homework',
    review: 'Reviewing concepts',
    practice: 'Coding practice',
    other: 'Other',
  },
};

export default function StudyLogDraftModal({
  draft,
  courses,
  todayDate,
  lang = 'vi',
  onSaved,
  onClose,
}: StudyLogDraftModalProps) {
  const isVi = lang === 'vi';
  const labels = isVi ? ACTIVITY_LABELS.vi : ACTIVITY_LABELS.en;

  const [courseId, setCourseId] = useState(draft.courseId || '');
  const [studyDate, setStudyDate] = useState(todayDate);
  const [title, setTitle] = useState(draft.title || '');
  const [activityType, setActivityType] = useState<ActivityType>(draft.activityType || 'review');
  const [durationMinutes, setDurationMinutes] = useState<string>(
    draft.durationMinutes ? String(draft.durationMinutes) : ''
  );
  const [learnedContent, setLearnedContent] = useState(draft.learnedContent || '');
  const [difficulties, setDifficulties] = useState(draft.difficulties || '');
  const [nextSteps, setNextSteps] = useState(draft.nextSteps || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !studyDate) return;
    if (studyDate > todayDate) {
      setError(isVi ? 'Không thể ghi nhật ký cho ngày tương lai.' : 'Cannot log for a future date.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await api.createLog({
        courseId: courseId || null,
        studyDate,
        title: title.trim(),
        activityType,
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        learnedContent: learnedContent.trim(),
        difficulties: difficulties.trim(),
        nextSteps: nextSteps.trim(),
        sourceTurnId: draft.sourceTurnId || null,
        sourceConversationId: draft.sourceConversationId || null,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg || (isVi ? 'Có lỗi khi lưu nhật ký.' : 'Failed to save log.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="student-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="draft-modal-title">
      <div className="student-modal-dialog">
        <div className="student-modal-header">
          <h2 id="draft-modal-title">
            📝 {isVi ? 'Ghi vào nhật ký học tập' : 'Save to Study Diary'}
          </h2>
          <button type="button" className="student-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="student-modal-form">
          {error && <div className="student-error" role="alert">{error}</div>}

          <div className="student-form-row">
            <label>
              <span>{isVi ? 'Ngày học' : 'Study Date'} <span className="student-req">*</span></span>
              <input
                type="date"
                required
                max={todayDate}
                value={studyDate}
                onChange={(e) => setStudyDate(e.target.value)}
              />
            </label>

            <label>
              <span>{isVi ? 'Môn học' : 'Course'}</span>
              <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">{isVi ? '— Học cá nhân / Tiếng Nhật / Không môn —' : '— Self-study / General —'}</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.code ? `(${c.code})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="student-form-row">
            <label style={{ flex: 2 }}>
              <span>{isVi ? 'Tiêu đề' : 'Title'} <span className="student-req">*</span></span>
              <input
                type="text"
                required
                maxLength={120}
                placeholder={isVi ? 'Ví dụ: Ôn tập thuật toán đồ thị' : 'e.g. Graph algorithms review'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            <label style={{ flex: 1 }}>
              <span>{isVi ? 'Loại hoạt động' : 'Activity Type'}</span>
              <select value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
                {(Object.keys(labels) as ActivityType[]).map((act) => (
                  <option key={act} value={act}>{labels[act]}</option>
                ))}
              </select>
            </label>

            <label style={{ flex: 1 }}>
              <span>{isVi ? 'Thời gian (phút)' : 'Duration (min)'}</span>
              <input
                type="number"
                min={0}
                max={1440}
                placeholder="45"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              />
            </label>
          </div>

          <label>
            <span>{isVi ? 'Nội dung đã học' : 'What you learned'}</span>
            <textarea
              rows={4}
              maxLength={5000}
              placeholder={isVi ? 'Tóm tắt kiến thức đã hiểu...' : 'Key takeaways and concepts...'}
              value={learnedContent}
              onChange={(e) => setLearnedContent(e.target.value)}
            />
          </label>

          <label>
            <span>{isVi ? 'Điều còn vướng / khó khăn' : 'Blockers / Difficulties'}</span>
            <textarea
              rows={2}
              maxLength={2000}
              placeholder={isVi ? 'Phần nào chưa rõ hoặc cần đào sâu thêm...' : 'What was confusing or needs more practice...'}
              value={difficulties}
              onChange={(e) => setDifficulties(e.target.value)}
            />
          </label>

          <label>
            <span>{isVi ? 'Bước tiếp theo dự kiến' : 'Next steps'}</span>
            <input
              type="text"
              maxLength={2000}
              placeholder={isVi ? 'Ví dụ: Làm bài tập 3 và 4 chương 2' : 'e.g. Solve exercises 3 and 4 in chapter 2'}
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
            />
          </label>

          <div className="student-modal-actions">
            <button type="button" disabled={submitting} onClick={onClose}>
              {isVi ? 'Hủy' : 'Cancel'}
            </button>
            <button type="submit" className="student-primary" disabled={submitting || !title.trim()}>
              {submitting ? (isVi ? 'Đang lưu...' : 'Saving...') : (isVi ? 'Lưu vào nhật ký' : 'Save to diary')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
