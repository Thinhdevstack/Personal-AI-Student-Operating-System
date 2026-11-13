'use client';

import { useEffect, useState } from 'react';
import type { StudyTask } from './types';
import * as api from './api';

interface StudyReminderBannerProps {
  tasks: StudyTask[];
  lang?: string;
  onCompleteTask: (task: StudyTask) => void;
  onRefresh: () => void;
}

export default function StudyReminderBanner({
  tasks,
  lang = 'vi',
  onCompleteTask,
  onRefresh,
}: StudyReminderBannerProps) {
  const isVi = lang === 'vi';
  const [activeTask, setActiveTask] = useState<StudyTask | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function checkReminders() {
      const now = new Date();
      // Format current time in Bangkok (HH:mm)
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const currentTimeStr = formatter.format(now);
      const todayBangkok = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);

      const dueTask = tasks.find((t) => {
        if (t.status === 'completed' || t.status === 'skipped') return false;
        if (t.reminderDismissed) return false;
        if (t.reminderSnoozed) return false;
        if (t.plannedDate > todayBangkok) return false;
        if (!t.plannedTime) return false;
        // Either overdue from earlier or past reminder time today
        return t.plannedDate < todayBangkok || t.plannedTime <= currentTimeStr;
      });

      setActiveTask(dueTask || null);
    }

    checkReminders();
    const interval = setInterval(checkReminders, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [tasks]);

  if (!activeTask) return null;

  async function handleDismiss() {
    if (!activeTask || busy) return;
    setBusy(true);
    try {
      await api.updateReminder(activeTask.id, { action: 'dismiss' });
      setActiveTask(null);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSnooze() {
    if (!activeTask || busy) return;
    setBusy(true);
    try {
      await api.updateReminder(activeTask.id, { action: 'snooze', snoozeMinutes: 15 });
      setActiveTask(null);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="student-reminder-banner" role="alert" aria-live="polite">
      <div className="student-reminder-content">
        <span className="student-reminder-icon" aria-hidden="true">🔔</span>
        <div className="student-reminder-text">
          <strong>{isVi ? 'Nhắc nhở học tập:' : 'Study Reminder:'}</strong> {activeTask.title}
          {activeTask.plannedTime && (
            <span className="student-reminder-time">
              {' · '}
              {isVi ? `Đã lên lịch: ${activeTask.plannedTime}` : `Scheduled: ${activeTask.plannedTime}`}
            </span>
          )}
          {activeTask.courseName && (
            <span className="student-reminder-course"> · {activeTask.courseName}</span>
          )}
        </div>
      </div>

      <div className="student-reminder-actions">
        <button
          type="button"
          className="student-primary student-btn-sm"
          disabled={busy}
          onClick={() => onCompleteTask(activeTask)}
        >
          ✓ {isVi ? 'Hoàn thành' : 'Complete'}
        </button>
        <button
          type="button"
          className="student-btn-sm"
          disabled={busy}
          onClick={handleSnooze}
        >
          ⏱️ {isVi ? 'Nhắc lại 15p' : 'Snooze 15m'}
        </button>
        <button
          type="button"
          className="student-btn-sm student-btn-subtle"
          disabled={busy}
          onClick={handleDismiss}
          title={isVi ? 'Bỏ qua nhắc nhở' : 'Dismiss reminder'}
        >
          ✕ {isVi ? 'Bỏ qua' : 'Dismiss'}
        </button>
      </div>
    </aside>
  );
}

