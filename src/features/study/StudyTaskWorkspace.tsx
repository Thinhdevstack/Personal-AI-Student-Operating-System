'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { StudyTask, StudyTaskGroup, TaskPriority, TaskSuggestion } from './types';
import * as api from './api';
import StudyReminderBanner from './StudyReminderBanner';

interface StudyTaskWorkspaceProps {
  lang?: string;
  courses: { id: string; name: string; code?: string }[];
}

const PRIORITY_LABELS = {
  vi: { low: 'Thấp', medium: 'Trung bình', high: 'Cao' },
  en: { low: 'Low', medium: 'Medium', high: 'High' },
};

const PRIORITY_BADGES: Record<TaskPriority, string> = {
  high: 'student-badge-danger',
  medium: 'student-badge-amber',
  low: 'student-badge-gray',
};

export default function StudyTaskWorkspace({ lang = 'vi', courses }: StudyTaskWorkspaceProps) {
  const isVi = lang === 'vi';
  const pLabels = isVi ? PRIORITY_LABELS.vi : PRIORITY_LABELS.en;

  const [taskData, setTaskData] = useState<StudyTaskGroup | null>(null);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<StudyTask | null>(null);
  const [completingTask, setCompletingTask] = useState<StudyTask | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  // Create / Edit Form
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium');
  const [formCourseId, setFormCourseId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState('');

  // Complete Form
  const [compActualMinutes, setCompActualMinutes] = useState('');
  const [compLearned, setCompLearned] = useState('');
  const [compDifficulties, setCompDifficulties] = useState('');
  const [compNextSteps, setCompNextSteps] = useState('');
  const [compActivity, setCompActivity] = useState('practice');
  const [compError, setCompError] = useState('');

  const todayBangkok = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [res, suggRes] = await Promise.all([
          api.listTasks(),
          api.getSuggestions({ date: todayBangkok }),
        ]);
        if (active) {
          setTaskData(res);
          setSuggestions(suggRes.suggestions || []);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : '';
          setError(msg || (isVi ? 'Không thể tải danh sách kế hoạch.' : 'Failed to load study tasks.'));
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [todayBangkok, revision, isVi]);

  function openCreateModal(initialTitle = '', initialCourseId = '') {
    setEditingTask(null);
    setFormTitle(initialTitle);
    setFormDate(todayBangkok);
    setFormTime('');
    setFormDuration('');
    setFormPriority('medium');
    setFormCourseId(initialCourseId);
    setFormNotes('');
    setFormError('');
    setCreateModalOpen(true);
  }

  function openEditModal(task: StudyTask) {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDate(task.plannedDate || task.targetDate || todayBangkok);
    setFormTime(task.plannedTime || task.reminderTime || '');
    setFormDuration(task.estimatedDuration ? String(task.estimatedDuration) : '');
    setFormPriority(task.priority);
    setFormCourseId(task.courseId || '');
    setFormNotes(task.notes || '');
    setFormError('');
    setCreateModalOpen(true);
  }

  function openCompleteModal(task: StudyTask) {
    setCompletingTask(task);
    setCompActualMinutes(''); // Strict rule: User enters actual duration; do not copy estimated
    setCompLearned(task.notes ? `Hoàn thành: ${task.notes}` : `Hoàn thành việc: ${task.title}`);
    setCompDifficulties('');
    setCompNextSteps('');
    setCompActivity('practice');
    setCompError('');
  }

  async function handleSaveTask(e: FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !formDate) return;

    setSaving(true);
    setFormError('');
    try {
      if (editingTask) {
        await api.updateTask(editingTask.id, {
          title: formTitle.trim(),
          plannedDate: formDate,
          plannedTime: formTime || null,
          estimatedDuration: formDuration ? Number(formDuration) : null,
          priority: formPriority,
          courseId: formCourseId || null,
          notes: formNotes.trim(),
        });
      } else {
        await api.createTask({
          title: formTitle.trim(),
          plannedDate: formDate,
          plannedTime: formTime || null,
          estimatedDuration: formDuration ? Number(formDuration) : null,
          priority: formPriority,
          courseId: formCourseId || null,
          notes: formNotes.trim(),
          requestId: crypto.randomUUID(),
        });
      }
      setCreateModalOpen(false);
      setRevision((r) => r + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setFormError(msg || (isVi ? 'Lỗi khi lưu.' : 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCompleteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!completingTask) return;

    setSaving(true);
    setCompError('');
    try {
      await api.completeTask(completingTask.id, {
        actualMinutes: compActualMinutes ? Number(compActualMinutes) : undefined,
        learnedContent: compLearned.trim(),
        difficulties: compDifficulties.trim(),
        nextSteps: compNextSteps.trim(),
        activityType: compActivity,
        studyDate: todayBangkok,
        requestId: crypto.randomUUID(),
      });
      setCompletingTask(null);
      setRevision((r) => r + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setCompError(msg || (isVi ? 'Lỗi khi hoàn thành việc.' : 'Failed to complete task.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen(taskId: string) {
    try {
      await api.reopenTask(taskId);
      setRevision((r) => r + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg || (isVi ? 'Lỗi khi mở lại.' : 'Failed to reopen.'));
    }
  }

  async function handleDeleteTask(taskId: string) {
    try {
      await api.deleteTask(taskId);
      setDeletingId(null);
      setRevision((r) => r + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg || (isVi ? 'Lỗi khi xóa.' : 'Failed to delete.'));
    }
  }

  const allActiveTasks = [
    ...(taskData?.overdue || []),
    ...(taskData?.today || []),
    ...(taskData?.upcoming || []),
  ];

  return (
    <div className="student-tasks-workspace">
      {/* In-app reminder banner */}
      <StudyReminderBanner
        tasks={allActiveTasks}
        lang={lang}
        onCompleteTask={openCompleteModal}
        onRefresh={() => setRevision((r) => r + 1)}
      />

      {/* Suggestions section */}
      {suggestions.length > 0 && (
        <section className="student-suggestions-panel">
          <div className="student-suggestions-header">
            <h3>💡 {isVi ? 'Gợi ý kế hoạch hôm nay' : 'Suggestions for Today'}</h3>
          </div>
          <div className="student-suggestions-chips">
            {suggestions.map((s, idx) => (
              <div key={idx} className="student-suggestion-chip">
                <span className="student-sugg-title">
                  {s.reason === 'overdue' ? '⚠️ Quá hạn: ' : '🎯 Bước tiếp: '}
                  {s.title}
                </span>
                {s.courseName && <span className="student-sugg-course">({s.courseName})</span>}
                <button
                  type="button"
                  className="student-btn-sm student-primary"
                  onClick={() => openCreateModal(s.title, s.courseId || '')}
                >
                  + {isVi ? 'Thêm' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="student-error" role="alert">{error}</div>}

      <div className="student-section-heading" style={{ marginTop: 12 }}>
        <h2>📝 {isVi ? 'Kế hoạch học tập' : 'Study Plan'}</h2>
        <button type="button" className="student-primary" onClick={() => openCreateModal()}>
          + {isVi ? 'Thêm việc học mới' : 'Add Study Task'}
        </button>
      </div>

      {loading ? (
        <p>{isVi ? 'Đang tải danh sách...' : 'Loading tasks...'}</p>
      ) : (
        <div className="student-tasks-grid">
          {/* 1. Overdue Section */}
          {taskData && taskData.overdue.length > 0 && (
            <section className="student-task-section student-task-section-overdue">
              <h3 className="student-task-section-title">
                ⚠️ {isVi ? 'Việc quá hạn' : 'Overdue Tasks'}{' '}
                <span className="student-count-pill">{taskData.overdue.length}</span>
              </h3>
              <div className="student-task-list">
                {taskData.overdue.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isVi={isVi}
                    pLabels={pLabels}
                    onComplete={() => openCompleteModal(task)}
                    onEdit={() => openEditModal(task)}
                    onDelete={() => setDeletingId(task.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 2. Today Section */}
          <section className="student-task-section">
            <h3 className="student-task-section-title">
              📅 {isVi ? 'Hôm nay' : 'Today'}{' '}
              <span className="student-count-pill">{taskData?.today.length || 0}</span>
            </h3>
            {taskData?.today.length === 0 ? (
              <div className="student-empty" style={{ padding: '20px 0' }}>
                <p>{isVi ? 'Hôm nay chưa có việc nào được lên kế hoạch.' : 'No tasks scheduled for today.'}</p>
                <button type="button" className="student-primary" onClick={() => openCreateModal()}>
                  + {isVi ? 'Lên kế hoạch ngay' : 'Plan a task'}
                </button>
              </div>
            ) : (
              <div className="student-task-list">
                {taskData?.today.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isVi={isVi}
                    pLabels={pLabels}
                    onComplete={() => openCompleteModal(task)}
                    onEdit={() => openEditModal(task)}
                    onDelete={() => setDeletingId(task.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* 3. Upcoming Section */}
          {taskData && taskData.upcoming.length > 0 && (
            <section className="student-task-section">
              <h3 className="student-task-section-title">
                🔜 {isVi ? 'Sắp tới' : 'Upcoming'}{' '}
                <span className="student-count-pill">{taskData.upcoming.length}</span>
              </h3>
              <div className="student-task-list">
                {taskData.upcoming.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isVi={isVi}
                    pLabels={pLabels}
                    onComplete={() => openCompleteModal(task)}
                    onEdit={() => openEditModal(task)}
                    onDelete={() => setDeletingId(task.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 4. Completed Section (Collapsible) */}
          {taskData && taskData.completed.length > 0 && (
            <section className="student-task-section">
              <div
                className="student-task-section-title student-collapsible-title"
                onClick={() => setShowCompleted(!showCompleted)}
              >
                <span>
                  ✓ {isVi ? 'Đã hoàn thành' : 'Completed'}{' '}
                  <span className="student-count-pill">{taskData.completed.length}</span>
                </span>
                <span>{showCompleted ? '▲ Thu gọn' : '▼ Mở rộng'}</span>
              </div>
              {showCompleted && (
                <div className="student-task-list">
                  {taskData.completed.map((task) => (
                    <div key={task.id} className="student-task-card student-task-completed">
                      <div className="student-task-card-main">
                        <span className="student-task-check">✓</span>
                        <div className="student-task-info">
                          <h4 className="student-task-title">{task.title}</h4>
                          <div className="student-task-meta">
                            {task.courseName && <span>📚 {task.courseName}</span>}
                            {task.actualMinutes && <span>⏱️ Thực tế: {task.actualMinutes}m</span>}
                            {task.completedAt && <span>📅 {task.completedAt.slice(0, 10)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="student-task-actions">
                        <button
                          type="button"
                          className="student-btn-subtle"
                          onClick={() => handleReopen(task.id)}
                        >
                          ↩️ {isVi ? 'Mở lại' : 'Reopen'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Complete Task Modal */}
      {completingTask && (
        <div className="student-modal-backdrop" role="dialog" aria-modal="true">
          <div className="student-modal-dialog">
            <div className="student-modal-header">
              <h2>✓ {isVi ? 'Hoàn thành việc & Ghi nhật ký' : 'Complete Task & Record Log'}</h2>
              <button type="button" className="student-modal-close" onClick={() => setCompletingTask(null)}>✕</button>
            </div>
            <p className="student-footnote" style={{ margin: '0 0 12px' }}>
              <strong>{completingTask.title}</strong>
              {completingTask.estimatedDuration ? ` (Dự tính: ${completingTask.estimatedDuration} phút)` : ''}
            </p>

            <form onSubmit={handleCompleteSubmit} className="student-modal-form">
              {compError && <div className="student-error" role="alert">{compError}</div>}

              <div className="student-form-row">
                <label style={{ flex: 1 }}>
                  <span>
                    {isVi ? 'Thời gian học thực tế (phút)' : 'Actual study time (minutes)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    placeholder="Ví dụ: 45"
                    value={compActualMinutes}
                    onChange={(e) => setCompActualMinutes(e.target.value)}
                  />
                  <small style={{ color: '#666', fontSize: '11px', marginTop: 2 }}>
                    {isVi ? 'Vui lòng nhập thời gian thực tế đã học' : 'Enter actual duration spent'}
                  </small>
                </label>

                <label style={{ flex: 1 }}>
                  <span>{isVi ? 'Loại hoạt động' : 'Activity Type'}</span>
                  <select value={compActivity} onChange={(e) => setCompActivity(e.target.value)}>
                    <option value="practice">{isVi ? 'Thực hành code' : 'Practice'}</option>
                    <option value="read">{isVi ? 'Đọc tài liệu' : 'Reading'}</option>
                    <option value="assignment">{isVi ? 'Làm bài tập' : 'Assignment'}</option>
                    <option value="review">{isVi ? 'Ôn tập' : 'Review'}</option>
                    <option value="other">{isVi ? 'Khác' : 'Other'}</option>
                  </select>
                </label>
              </div>

              <label>
                <span>{isVi ? 'Nội dung đã học / kết quả đạt được' : 'What you learned'}</span>
                <textarea
                  rows={3}
                  maxLength={5000}
                  value={compLearned}
                  onChange={(e) => setCompLearned(e.target.value)}
                />
              </label>

              <label>
                <span>{isVi ? 'Điều còn vướng / khó khăn (nếu có)' : 'Blockers / Difficulties (optional)'}</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  placeholder={isVi ? 'Điểm nào chưa hiểu rõ...' : 'Any challenges encountered...'}
                  value={compDifficulties}
                  onChange={(e) => setCompDifficulties(e.target.value)}
                />
              </label>

              <label>
                <span>{isVi ? 'Bước tiếp theo dự kiến' : 'Next steps'}</span>
                <input
                  type="text"
                  maxLength={2000}
                  placeholder={isVi ? 'Ví dụ: Ôn tập lại lý thuyết...' : 'e.g. Review theory...'}
                  value={compNextSteps}
                  onChange={(e) => setCompNextSteps(e.target.value)}
                />
              </label>

              <div className="student-modal-actions">
                <button type="button" disabled={saving} onClick={() => setCompletingTask(null)}>
                  {isVi ? 'Hủy' : 'Cancel'}
                </button>
                <button type="submit" className="student-primary" disabled={saving}>
                  {saving ? (isVi ? 'Đang lưu...' : 'Saving...') : (isVi ? 'Xác nhận hoàn thành' : 'Confirm Complete')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Task Modal */}
      {createModalOpen && (
        <div className="student-modal-backdrop" role="dialog" aria-modal="true">
          <div className="student-modal-dialog">
            <div className="student-modal-header">
              <h2>
                {editingTask
                  ? (isVi ? '✏️ Chỉnh sửa việc học' : '✏️ Edit Study Task')
                  : (isVi ? '📝 Lên kế hoạch việc học' : '📝 Plan Study Task')}
              </h2>
              <button type="button" className="student-modal-close" onClick={() => setCreateModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleSaveTask} className="student-modal-form">
              {formError && <div className="student-error" role="alert">{formError}</div>}

              <label>
                <span>{isVi ? 'Tên việc học' : 'Task title'} <span className="student-req">*</span></span>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder={isVi ? 'Ví dụ: Đọc chương 3 và làm bài tập 1' : 'e.g. Read chapter 3 and do exercise 1'}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </label>

              <div className="student-form-row">
                <label>
                  <span>{isVi ? 'Ngày dự kiến' : 'Planned date'} <span className="student-req">*</span></span>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </label>

                <label>
                  <span>{isVi ? 'Giờ nhắc nhở (HH:mm)' : 'Reminder time'}</span>
                  <input
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                  />
                </label>

                <label>
                  <span>{isVi ? 'Ước tính (phút)' : 'Est. minutes'}</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    placeholder="45"
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)}
                  />
                </label>
              </div>

              <div className="student-form-row">
                <label style={{ flex: 1 }}>
                  <span>{isVi ? 'Môn học' : 'Course'}</span>
                  <select value={formCourseId} onChange={(e) => setFormCourseId(e.target.value)}>
                    <option value="">{isVi ? '— Học cá nhân / Tiếng Nhật / Không môn —' : '— Self-study / General —'}</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.code ? `(${c.code})` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ flex: 1 }}>
                  <span>{isVi ? 'Mức độ ưu tiên' : 'Priority'}</span>
                  <select value={formPriority} onChange={(e) => setFormPriority(e.target.value as TaskPriority)}>
                    <option value="high">{pLabels.high} (Cao)</option>
                    <option value="medium">{pLabels.medium} (Trung bình)</option>
                    <option value="low">{pLabels.low} (Thấp)</option>
                  </select>
                </label>
              </div>

              <label>
                <span>{isVi ? 'Ghi chú / Mục tiêu cụ thể' : 'Notes / Objectives'}</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  placeholder={isVi ? 'Ghi chú thêm...' : 'Additional notes...'}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                />
              </label>

              <div className="student-modal-actions">
                <button type="button" disabled={saving} onClick={() => setCreateModalOpen(false)}>
                  {isVi ? 'Hủy' : 'Cancel'}
                </button>
                <button type="submit" className="student-primary" disabled={saving || !formTitle.trim()}>
                  {saving ? (isVi ? 'Đang lưu...' : 'Saving...') : (isVi ? 'Lưu việc học' : 'Save Task')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="student-modal-backdrop" role="dialog" aria-modal="true">
          <div className="student-modal-dialog" style={{ maxWidth: 400 }}>
            <h3>⚠️ {isVi ? 'Xác nhận xóa việc học?' : 'Confirm delete task?'}</h3>
            <p>{isVi ? 'Hành động này sẽ xóa việc học khỏi kế hoạch.' : 'This will remove the task from your plan.'}</p>
            <div className="student-modal-actions">
              <button type="button" onClick={() => setDeletingId(null)}>
                {isVi ? 'Hủy' : 'Cancel'}
              </button>
              <button
                type="button"
                className="student-btn-danger"
                onClick={() => handleDeleteTask(deletingId)}
              >
                {isVi ? 'Xóa' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  isVi,
  pLabels,
  onComplete,
  onEdit,
  onDelete,
}: {
  task: StudyTask;
  isVi: boolean;
  pLabels: Record<TaskPriority, string>;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const priorityClass = PRIORITY_BADGES[task.priority] || 'student-badge-gray';

  return (
    <div className="student-task-card">
      <div className="student-task-card-main">
        <button
          type="button"
          className="student-task-check-btn"
          onClick={onComplete}
          title={isVi ? 'Đánh dấu hoàn thành' : 'Mark as complete'}
        >
          ◯
        </button>

        <div className="student-task-info">
          <h4 className="student-task-title">{task.title}</h4>
          <div className="student-task-meta">
            <span className={`student-priority-badge ${priorityClass}`}>
              {pLabels[task.priority] || task.priority}
            </span>
            {task.plannedTime && <span>⏰ {task.plannedTime}</span>}
            {task.estimatedDuration && <span>⏱️ ~{task.estimatedDuration}m</span>}
            {task.courseName && <span>📚 {task.courseName}</span>}
            {task.plannedDate && <span className="student-task-date">📅 {task.plannedDate}</span>}
          </div>
          {task.notes && <p className="student-task-notes">{task.notes}</p>}
        </div>
      </div>

      <div className="student-task-actions">
        <button
          type="button"
          className="student-primary student-btn-sm"
          onClick={onComplete}
        >
          ✓ {isVi ? 'Xong' : 'Done'}
        </button>
        <button
          type="button"
          className="student-btn-subtle"
          onClick={onEdit}
          title={isVi ? 'Chỉnh sửa' : 'Edit'}
        >
          ✏️
        </button>
        <button
          type="button"
          className="student-btn-subtle student-btn-danger"
          onClick={onDelete}
          title={isVi ? 'Xóa' : 'Delete'}
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
