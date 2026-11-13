'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { ActivityType, StudyLog, StudySummary } from './types';
import * as api from './api';
import StudyHeatmap from './StudyHeatmap';

interface StudyLogWorkspaceProps {
  lang?: string;
  courses: { id: string; name: string; code?: string }[];
  initialCourseId?: string;
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

const ACTIVITY_BADGE_CLASSES: Record<ActivityType, string> = {
  read: 'student-badge-blue',
  assignment: 'student-badge-purple',
  review: 'student-badge-amber',
  practice: 'student-badge-emerald',
  other: 'student-badge-gray',
};

export default function StudyLogWorkspace({ lang = 'vi', courses, initialCourseId }: StudyLogWorkspaceProps) {
  const isVi = lang === 'vi';
  const labels = isVi ? ACTIVITY_LABELS.vi : ACTIVITY_LABELS.en;

  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(initialCourseId || '');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<string>('');
  const [revision, setRevision] = useState(0);

  // Dialog & modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<StudyLog | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formDate, setFormDate] = useState('');
  const [formCourseId, setFormCourseId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formActivity, setFormActivity] = useState<ActivityType>('practice');
  const [formDuration, setFormDuration] = useState('');
  const [formLearned, setFormLearned] = useState('');
  const [formDifficulties, setFormDifficulties] = useState('');
  const [formNextSteps, setFormNextSteps] = useState('');
  const [formError, setFormError] = useState('');

  // Compute today in Bangkok (en-CA -> YYYY-MM-DD)
  const todayDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [summaryRes, logsRes] = await Promise.all([
          api.getSummary({ courseId: selectedCourseId || undefined }),
          api.listLogs({
            courseId: selectedCourseId || undefined,
            studyDate: selectedDate || undefined,
          }),
        ]);
        if (active) {
          setSummary(summaryRes);
          setLogs(logsRes.logs || logsRes.items || []);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : '';
          setError(msg || (isVi ? 'Không thể tải nhật ký học tập.' : 'Failed to load study logs.'));
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedCourseId, selectedDate, revision, isVi]);

  function openCreateModal() {
    setEditingLog(null);
    setFormDate(selectedDate || todayDate);
    setFormCourseId(selectedCourseId || '');
    setFormTitle('');
    setFormActivity('practice');
    setFormDuration('');
    setFormLearned('');
    setFormDifficulties('');
    setFormNextSteps('');
    setFormError('');
    setModalOpen(true);
  }

  function openEditModal(log: StudyLog) {
    setEditingLog(log);
    setFormDate(log.studyDate);
    setFormCourseId(log.courseId || '');
    setFormTitle(log.title);
    setFormActivity(log.activityType);
    setFormDuration(log.durationMinutes ? String(log.durationMinutes) : '');
    setFormLearned(log.learnedContent || log.content || '');
    setFormDifficulties(log.difficulties || log.blockers || '');
    setFormNextSteps(log.nextSteps || '');
    setFormError('');
    setModalOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !formDate) return;
    if (formDate > todayDate) {
      setFormError(isVi ? 'Không thể ghi nhật ký cho ngày tương lai.' : 'Cannot log for a future date.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      if (editingLog) {
        await api.updateLog(editingLog.id, {
          studyDate: formDate,
          courseId: formCourseId || null,
          title: formTitle.trim(),
          activityType: formActivity,
          durationMinutes: formDuration ? Number(formDuration) : null,
          learnedContent: formLearned.trim(),
          difficulties: formDifficulties.trim(),
          nextSteps: formNextSteps.trim(),
        });
      } else {
        await api.createLog({
          studyDate: formDate,
          courseId: formCourseId || null,
          title: formTitle.trim(),
          activityType: formActivity,
          durationMinutes: formDuration ? Number(formDuration) : null,
          learnedContent: formLearned.trim(),
          difficulties: formDifficulties.trim(),
          nextSteps: formNextSteps.trim(),
        });
      }
      setModalOpen(false);
      setRevision((r) => r + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setFormError(msg || (isVi ? 'Lỗi khi lưu.' : 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteLog(id);
      setDeletingId(null);
      setRevision((r) => r + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg || (isVi ? 'Lỗi khi xóa.' : 'Failed to delete.'));
    }
  }

  const filteredLogs = selectedActivity
    ? logs.filter((l) => l.activityType === selectedActivity)
    : logs;

  return (
    <div className="student-logs-workspace">
      {/* 12-month GitHub-like Heatmap */}
      <section className="student-panel" style={{ marginBottom: 20 }}>
        <div className="student-section-heading">
          <h2>📊 {isVi ? 'Tiến độ học tập 12 tháng' : '12-Month Study Progress'}</h2>
          <button type="button" className="student-primary" onClick={openCreateModal}>
            + {isVi ? 'Ghi nhật ký mới' : 'Add Study Log'}
          </button>
        </div>
        <StudyHeatmap
          summary={summary}
          selectedDate={selectedDate}
          onSelectDate={(d) => setSelectedDate(d)}
          lang={lang}
        />
      </section>

      {/* Filters bar */}
      <div className="student-logs-filters">
        <label>
          <span>{isVi ? 'Lọc theo môn:' : 'Filter by course:'}</span>
          <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
            <option value="">{isVi ? 'Tất cả môn học' : 'All courses'}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.code ? `(${c.code})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{isVi ? 'Lọc theo hoạt động:' : 'Filter by activity:'}</span>
          <select value={selectedActivity} onChange={(e) => setSelectedActivity(e.target.value)}>
            <option value="">{isVi ? 'Tất cả hoạt động' : 'All activities'}</option>
            {(Object.keys(labels) as ActivityType[]).map((act) => (
              <option key={act} value={act}>{labels[act]}</option>
            ))}
          </select>
        </label>

        {selectedDate && (
          <div className="student-active-filter-badge">
            <span>📅 {selectedDate}</span>
            <button type="button" onClick={() => setSelectedDate(null)} aria-label="Clear date">✕</button>
          </div>
        )}

        {(selectedCourseId || selectedActivity || selectedDate) && (
          <button
            type="button"
            className="student-filter-reset"
            onClick={() => {
              setSelectedCourseId('');
              setSelectedActivity('');
              setSelectedDate(null);
            }}
          >
            {isVi ? 'Xóa bộ lọc' : 'Reset filters'}
          </button>
        )}
      </div>

      {error && <div className="student-error" role="alert">{error}</div>}

      {/* Logs List */}
      <section className="student-panel">
        <div className="student-section-heading">
          <h2>
            📖 {isVi ? 'Danh sách bản ghi học tập' : 'Study Logs'}{' '}
            <small style={{ fontWeight: 400, fontSize: '14px', color: '#666' }}>
              ({filteredLogs.length} {isVi ? 'bản ghi' : 'entries'})
            </small>
          </h2>
        </div>

        {loading ? (
          <p>{isVi ? 'Đang tải bản ghi...' : 'Loading logs...'}</p>
        ) : filteredLogs.length === 0 ? (
          <div className="student-empty">
            <p>{isVi ? 'Chưa có bản ghi nào phù hợp.' : 'No study logs found.'}</p>
            <button type="button" className="student-primary" onClick={openCreateModal}>
              + {isVi ? 'Thêm bản ghi đầu tiên' : 'Add first log'}
            </button>
          </div>
        ) : (
          <div className="student-log-cards">
            {filteredLogs.map((log) => (
              <article key={log.id} className="student-log-card">
                <header className="student-log-card-header">
                  <div className="student-log-card-meta">
                    <span className="student-log-date">📅 {log.studyDate}</span>
                    <span className={`student-activity-badge ${ACTIVITY_BADGE_CLASSES[log.activityType] || ''}`}>
                      {labels[log.activityType] || log.activityType}
                    </span>
                    {log.durationMinutes !== null && log.durationMinutes !== undefined && (
                      <span className="student-log-duration">⏱️ {log.durationMinutes} {isVi ? 'phút' : 'min'}</span>
                    )}
                    {log.courseName && (
                      <span className="student-log-course">📚 {log.courseName}</span>
                    )}
                  </div>
                  <div className="student-log-card-actions">
                    <button
                      type="button"
                      className="student-btn-subtle"
                      onClick={() => openEditModal(log)}
                      title={isVi ? 'Chỉnh sửa' : 'Edit'}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="student-btn-subtle student-btn-danger"
                      onClick={() => setDeletingId(log.id)}
                      title={isVi ? 'Xóa' : 'Delete'}
                    >
                      🗑️
                    </button>
                  </div>
                </header>

                <h3 className="student-log-title">{log.title}</h3>

                {(log.learnedContent || log.content) && (
                  <div className="student-log-section">
                    <strong>{isVi ? 'Nội dung đã học:' : 'Learned content:'}</strong>
                    <p>{log.learnedContent || log.content}</p>
                  </div>
                )}

                {(log.difficulties || log.blockers) && (
                  <div className="student-log-section student-log-difficulties">
                    <strong>⚠️ {isVi ? 'Điểm còn vướng / khó khăn:' : 'Blockers / Difficulties:'}</strong>
                    <p>{log.difficulties || log.blockers}</p>
                  </div>
                )}

                {log.nextSteps && (
                  <div className="student-log-section student-log-nextsteps">
                    <strong>🎯 {isVi ? 'Bước tiếp theo:' : 'Next steps:'}</strong>
                    <p>{log.nextSteps}</p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="student-modal-backdrop" role="dialog" aria-modal="true">
          <div className="student-modal-dialog" style={{ maxWidth: 400 }}>
            <h3>⚠️ {isVi ? 'Xác nhận xóa bản ghi?' : 'Confirm delete?'}</h3>
            <p>{isVi ? 'Hành động này không thể hoàn tác. Bản ghi học tập sẽ bị xóa vĩnh viễn.' : 'This action cannot be undone. The study log will be deleted permanently.'}</p>
            <div className="student-modal-actions">
              <button type="button" onClick={() => setDeletingId(null)}>
                {isVi ? 'Hủy' : 'Cancel'}
              </button>
              <button
                type="button"
                className="student-btn-danger"
                onClick={() => handleDelete(deletingId)}
              >
                {isVi ? 'Xóa vĩnh viễn' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="student-modal-backdrop" role="dialog" aria-modal="true">
          <div className="student-modal-dialog">
            <div className="student-modal-header">
              <h2>
                {editingLog
                  ? (isVi ? '✏️ Chỉnh sửa bản ghi học tập' : '✏️ Edit Study Log')
                  : (isVi ? '📝 Thêm bản ghi học tập' : '📝 Add Study Log')}
              </h2>
              <button type="button" className="student-modal-close" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSave} className="student-modal-form">
              {formError && <div className="student-error" role="alert">{formError}</div>}

              <div className="student-form-row">
                <label>
                  <span>{isVi ? 'Ngày học' : 'Study date'} <span className="student-req">*</span></span>
                  <input
                    type="date"
                    required
                    max={todayDate}
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </label>

                <label>
                  <span>{isVi ? 'Môn học' : 'Course'}</span>
                  <select value={formCourseId} onChange={(e) => setFormCourseId(e.target.value)}>
                    <option value="">{isVi ? '— Học cá nhân / Tiếng Nhật / Không theo môn —' : '— Self-study / General —'}</option>
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
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                  />
                </label>

                <label style={{ flex: 1 }}>
                  <span>{isVi ? 'Loại hoạt động' : 'Activity Type'}</span>
                  <select value={formActivity} onChange={(e) => setFormActivity(e.target.value as ActivityType)}>
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
                    placeholder="60"
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)}
                  />
                </label>
              </div>

              <label>
                <span>{isVi ? 'Nội dung đã học' : 'What you learned'}</span>
                <textarea
                  rows={4}
                  maxLength={5000}
                  placeholder={isVi ? 'Tóm tắt nội dung trọng tâm...' : 'Summary of what you covered...'}
                  value={formLearned}
                  onChange={(e) => setFormLearned(e.target.value)}
                />
              </label>

              <label>
                <span>{isVi ? 'Điều còn vướng / khó khăn' : 'Blockers / Difficulties'}</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  placeholder={isVi ? 'Phần nào chưa hiểu rõ, lỗi chưa giải quyết...' : 'Unclear points, unresolved bugs...'}
                  value={formDifficulties}
                  onChange={(e) => setFormDifficulties(e.target.value)}
                />
              </label>

              <label>
                <span>{isVi ? 'Bước tiếp theo dự kiến' : 'Next steps'}</span>
                <input
                  type="text"
                  maxLength={2000}
                  placeholder={isVi ? 'Ví dụ: Cài đặt Dijkstra và giải bài tập LeetCode' : 'e.g. Implement Dijkstra and solve LeetCode'}
                  value={formNextSteps}
                  onChange={(e) => setFormNextSteps(e.target.value)}
                />
              </label>

              <div className="student-modal-actions">
                <button type="button" disabled={saving} onClick={() => setModalOpen(false)}>
                  {isVi ? 'Hủy' : 'Cancel'}
                </button>
                <button type="submit" className="student-primary" disabled={saving || !formTitle.trim()}>
                  {saving ? (isVi ? 'Đang lưu...' : 'Saving...') : (isVi ? 'Lưu bản ghi' : 'Save Log')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
