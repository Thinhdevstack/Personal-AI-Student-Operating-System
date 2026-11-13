import { randomUUID } from 'node:crypto';
import { StudentError } from './storage.mjs';

export function getTodayInBangkok(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function text(value, max, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new StudentError('invalidInput');
    return '';
  }
  if (typeof value !== 'string') throw new StudentError('invalidInput');
  const trimmed = value.trim();
  if (required && !trimmed) throw new StudentError('invalidInput');
  if (trimmed.length > max) throw new StudentError('invalidInput');
  return trimmed;
}

function dateString(value, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new StudentError('invalidDate');
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StudentError('invalidDate');
  const parsed = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed)) throw new StudentError('invalidDate');
  const iso = new Date(parsed).toISOString().slice(0, 10);
  if (iso !== value) throw new StudentError('invalidDate');
  return value;
}

function timeString(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new StudentError('invalidInput');
  return value;
}

function integer(value, min, max, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new StudentError('invalidInput');
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new StudentError('invalidInput');
  return n;
}

const ACTIVITY_MAP = {
  read: 'read',
  reading: 'read',
  assignment: 'assignment',
  exercise: 'assignment',
  homework: 'assignment',
  review: 'review',
  practice: 'practice',
  other: 'other',
};

const PRIORITY_MAP = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  urgent: 'high',
};

const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'];

const now = () => new Date().toISOString();

export function createStudyService({ db }) {
  function courseExists(courseId) {
    if (!courseId) return true;
    return !!db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
  }

  // --- Study Logs (P3) ---

  function formatLog(row) {
    if (!row) return row;
    return {
      ...row,
      content: row.learnedContent,
      blockers: row.difficulties,
    };
  }

  function getLog(id) {
    if (!id || typeof id !== 'string') throw new StudentError('notFound', 404);
    const row = db.prepare(`
      SELECT l.*, c.name AS courseName, c.code AS courseCode, c.status AS courseStatus
      FROM study_logs l
      LEFT JOIN courses c ON c.id = l.courseId
      WHERE l.id = ?
    `).get(id);
    if (!row) throw new StudentError('notFound', 404);
    return formatLog(row);
  }

  function listLogs({ courseId, studyDate, startDate, endDate, fromDate, toDate, limit = 100, offset = 0 } = {}) {
    const conditions = [];
    const params = [];

    if (courseId) {
      conditions.push('l.courseId = ?');
      params.push(courseId);
    }
    if (studyDate) {
      conditions.push('l.studyDate = ?');
      params.push(dateString(studyDate));
    }
    const from = fromDate || startDate;
    if (from) {
      conditions.push('l.studyDate >= ?');
      params.push(dateString(from));
    }
    const to = toDate || endDate;
    if (to) {
      conditions.push('l.studyDate <= ?');
      params.push(dateString(to));
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const safeLimit = Math.min(Math.max(integer(limit, 1, 500) || 100, 1), 500);
    const safeOffset = Math.max(integer(offset, 0, 100000) || 0, 0);

    const rows = db.prepare(`
      SELECT l.*, c.name AS courseName, c.code AS courseCode, c.status AS courseStatus
      FROM study_logs l
      LEFT JOIN courses c ON c.id = l.courseId
      ${where}
      ORDER BY l.studyDate DESC, l.createdAt DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset).map(formatLog);

    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM study_logs l
      ${where}
    `).get(...params)?.count || 0;

    return { items: rows, logs: rows, total, limit: safeLimit, offset: safeOffset };
  }

  function createLog(input) {
    const studyDate = dateString(input.studyDate, true);
    const today = getTodayInBangkok();
    if (studyDate > today) {
      throw new StudentError('futureDateNotAllowed', 400);
    }

    const courseId = input.courseId ? String(input.courseId) : null;
    if (courseId && !courseExists(courseId)) throw new StudentError('notFound', 404);

    const title = text(input.title, 120, true);
    const actInput = (input.activityType || 'practice').toLowerCase();
    const activityType = ACTIVITY_MAP[actInput];
    if (!activityType) throw new StudentError('invalidInput');

    const durationMinutes = integer(input.durationMinutes ?? input.actualMinutes ?? input.actualDuration, 0, 1440, false);
    const learnedContent = text(input.learnedContent ?? input.content, 5000, false);
    const difficulties = text(input.difficulties ?? input.blockers, 2000, false);
    const nextSteps = text(input.nextSteps, 2000, false);
    const sourceTurnId = input.sourceTurnId ? text(input.sourceTurnId, 120, false) : null;
    const sourceConversationId = input.sourceConversationId ? text(input.sourceConversationId, 120, false) : null;

    const id = input.id || randomUUID();
    const time = now();

    db.prepare(`
      INSERT INTO study_logs (
        id, studyDate, courseId, title, activityType, durationMinutes,
        learnedContent, difficulties, nextSteps, sourceTurnId, sourceConversationId,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, studyDate, courseId, title, activityType, durationMinutes,
      learnedContent, difficulties, nextSteps, sourceTurnId, sourceConversationId,
      time, time
    );

    return getLog(id);
  }

  function updateLog(id, input) {
    const existing = getLog(id);

    let studyDate = existing.studyDate;
    if (input.studyDate !== undefined) {
      studyDate = dateString(input.studyDate, true);
      const today = getTodayInBangkok();
      if (studyDate > today) throw new StudentError('futureDateNotAllowed', 400);
    }

    let courseId = existing.courseId;
    if (input.courseId !== undefined) {
      courseId = input.courseId ? String(input.courseId) : null;
      if (courseId && !courseExists(courseId)) throw new StudentError('notFound', 404);
    }

    const title = input.title !== undefined ? text(input.title, 120, true) : existing.title;
    let activityType = existing.activityType;
    if (input.activityType !== undefined) {
      const mapped = ACTIVITY_MAP[String(input.activityType).toLowerCase()];
      if (!mapped) throw new StudentError('invalidInput');
      activityType = mapped;
    }

    const durationMinutes = (input.durationMinutes !== undefined || input.actualMinutes !== undefined)
      ? integer(input.durationMinutes ?? input.actualMinutes, 0, 1440, false)
      : existing.durationMinutes;

    const learnedContent = (input.learnedContent !== undefined || input.content !== undefined)
      ? text(input.learnedContent ?? input.content, 5000, false)
      : existing.learnedContent;

    const difficulties = (input.difficulties !== undefined || input.blockers !== undefined)
      ? text(input.difficulties ?? input.blockers, 2000, false)
      : existing.difficulties;

    const nextSteps = input.nextSteps !== undefined
      ? text(input.nextSteps, 2000, false)
      : existing.nextSteps;

    const time = now();

    db.prepare(`
      UPDATE study_logs
      SET studyDate = ?, courseId = ?, title = ?, activityType = ?, durationMinutes = ?,
          learnedContent = ?, difficulties = ?, nextSteps = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      studyDate, courseId, title, activityType, durationMinutes,
      learnedContent, difficulties, nextSteps, time, id
    );

    return getLog(id);
  }

  function deleteLog(id) {
    getLog(id);
    db.prepare('DELETE FROM study_logs WHERE id = ?').run(id);
    return { ok: true, id };
  }

  function getSummary({ courseId, startDate, endDate } = {}) {
    const today = getTodayInBangkok();
    const end = endDate ? dateString(endDate) : today;
    let start = startDate ? dateString(startDate) : null;
    if (!start) {
      const d = new Date(end + 'T00:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      d.setUTCDate(d.getUTCDate() + 1);
      start = d.toISOString().slice(0, 10);
    }

    const conditions = ['studyDate >= ?', 'studyDate <= ?'];
    const params = [start, end];

    if (courseId) {
      conditions.push('courseId = ?');
      params.push(courseId);
    }

    const rows = db.prepare(`
      SELECT studyDate, COUNT(*) AS count, SUM(COALESCE(durationMinutes, 0)) AS totalMinutes
      FROM study_logs
      WHERE ${conditions.join(' AND ')}
      GROUP BY studyDate
      ORDER BY studyDate ASC
    `).all(...params);

    const dailyMap = new Map();
    let totalLogs = 0;
    let totalMinutes = 0;

    for (const r of rows) {
      const count = Number(r.count || 0);
      const mins = Number(r.totalMinutes || 0);
      dailyMap.set(r.studyDate, { count, totalMinutes: mins });
      totalLogs += count;
      totalMinutes += mins;
    }

    const days = [];
    const cur = new Date(start + 'T00:00:00Z');
    const stop = new Date(end + 'T00:00:00Z');

    while (cur <= stop) {
      const dateStr = cur.toISOString().slice(0, 10);
      const entry = dailyMap.get(dateStr) || { count: 0, totalMinutes: 0 };
      const count = entry.count;
      let level = 0;
      if (count >= 6) level = 4;
      else if (count >= 4) level = 3;
      else if (count >= 2) level = 2;
      else if (count === 1) level = 1;

      days.push({
        date: dateStr,
        count,
        totalMinutes: entry.totalMinutes,
        level,
      });

      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return {
      startDate: start,
      endDate: end,
      days,
      totalLogs,
      totalMinutes,
      stats: {
        totalLogs,
        totalMinutes,
        activeDays: rows.filter((r) => (r.count || 0) > 0).length,
      },
    };
  }

  // --- Study Tasks (P4) ---

  function formatTask(row) {
    if (!row) return row;
    return {
      ...row,
      targetDate: row.plannedDate,
      reminderTime: row.plannedTime,
      estimatedMinutes: row.estimatedDuration,
      actualMinutes: row.logDurationMinutes ?? null,
      reminderDismissed: Boolean(row.reminderDismissedAt),
      reminderSnoozed: Boolean(row.reminderSnoozedUntil && row.reminderSnoozedUntil > now()),
    };
  }

  function getTask(id) {
    if (!id || typeof id !== 'string') throw new StudentError('notFound', 404);
    const row = db.prepare(`
      SELECT t.*, c.name AS courseName, c.code AS courseCode, c.status AS courseStatus,
             l.title AS logTitle, l.studyDate AS logStudyDate, l.durationMinutes AS logDurationMinutes
      FROM study_tasks t
      LEFT JOIN courses c ON c.id = t.courseId
      LEFT JOIN study_logs l ON l.id = t.studyLogId
      WHERE t.id = ?
    `).get(id);
    if (!row) throw new StudentError('notFound', 404);
    return formatTask(row);
  }

  function listTasks({ date, courseId, status } = {}) {
    const conditions = [];
    const params = [];

    if (courseId) {
      conditions.push('t.courseId = ?');
      params.push(courseId);
    }
    if (status) {
      if (!TASK_STATUSES.includes(status)) throw new StudentError('invalidInput');
      conditions.push('t.status = ?');
      params.push(status);
    }
    if (date) {
      conditions.push('t.plannedDate = ?');
      params.push(dateString(date));
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const rows = db.prepare(`
      SELECT t.*, c.name AS courseName, c.code AS courseCode, c.status AS courseStatus,
             l.title AS logTitle, l.studyDate AS logStudyDate, l.durationMinutes AS logDurationMinutes
      FROM study_tasks t
      LEFT JOIN courses c ON c.id = t.courseId
      LEFT JOIN study_logs l ON l.id = t.studyLogId
      ${where}
      ORDER BY
        CASE WHEN t.plannedDate < date('now', 'localtime') AND t.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END,
        CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.plannedTime ASC,
        t.createdAt ASC
    `).all(...params).map((r) => ({
      ...r,
      actualMinutes: r.logDurationMinutes ?? null,
      reminderDismissed: Boolean(r.reminderDismissedAt),
      reminderSnoozed: Boolean(r.reminderSnoozedUntil && r.reminderSnoozedUntil > now()),
    }));

    const today = getTodayInBangkok();
    const overdue = [];
    const todayTasks = [];
    const upcoming = [];
    const completed = [];
    const other = [];

    for (const item of rows) {
      if (item.status === 'completed') {
        completed.push(item);
      } else if (item.plannedDate < today && ['pending', 'in_progress'].includes(item.status)) {
        overdue.push(item);
      } else if (item.plannedDate === today) {
        todayTasks.push(item);
      } else if (item.plannedDate > today && ['pending', 'in_progress'].includes(item.status)) {
        upcoming.push(item);
      } else {
        other.push(item);
      }
    }

    return {
      items: rows,
      tasks: rows,
      overdue,
      today: todayTasks,
      upcoming,
      completed,
      other,
      todayDate: today,
    };
  }

  function createTask(input) {
    if (input.requestId) {
      const existing = db.prepare('SELECT id FROM study_tasks WHERE requestId = ?').get(String(input.requestId));
      if (existing) return getTask(existing.id);
    }

    const title = text(input.title, 120, true);
    const dateVal = input.plannedDate ?? input.targetDate ?? input.date;
    const plannedDate = dateString(dateVal, true);
    const plannedTime = timeString(input.plannedTime ?? input.reminderTime ?? input.time);
    const estimatedDuration = integer(input.estimatedDuration ?? input.estimatedMinutes, 0, 1440, false);
    const priorityInput = (input.priority || 'medium').toLowerCase();
    const priority = PRIORITY_MAP[priorityInput] || 'medium';
    const notes = text(input.notes, 2000, false);
    const courseId = input.courseId ? String(input.courseId) : null;
    if (courseId && !courseExists(courseId)) throw new StudentError('notFound', 404);

    const id = randomUUID();
    const time = now();
    const requestId = input.requestId ? String(input.requestId) : null;

    db.prepare(`
      INSERT INTO study_tasks (
        id, courseId, title, plannedDate, plannedTime, estimatedDuration,
        priority, notes, status, requestId, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id, courseId, title, plannedDate, plannedTime, estimatedDuration,
      priority, notes, requestId, time, time
    );

    return getTask(id);
  }

  function updateTask(id, input) {
    const existing = getTask(id);

    const title = input.title !== undefined ? text(input.title, 120, true) : existing.title;
    const dateVal = input.plannedDate ?? input.targetDate ?? input.date;
    const plannedDate = dateVal !== undefined
      ? dateString(dateVal, true)
      : existing.plannedDate;
    const timeVal = input.plannedTime ?? input.reminderTime ?? input.time;
    const plannedTime = timeVal !== undefined
      ? timeString(timeVal)
      : existing.plannedTime;
    const durationVal = input.estimatedDuration ?? input.estimatedMinutes;
    const estimatedDuration = durationVal !== undefined
      ? integer(durationVal, 0, 1440, false)
      : existing.estimatedDuration;

    let priority = existing.priority;
    if (input.priority !== undefined) {
      const mapped = PRIORITY_MAP[String(input.priority).toLowerCase()];
      if (!mapped) throw new StudentError('invalidInput');
      priority = mapped;
    }

    const notes = input.notes !== undefined ? text(input.notes, 2000, false) : existing.notes;
    let courseId = existing.courseId;
    if (input.courseId !== undefined) {
      courseId = input.courseId ? String(input.courseId) : null;
      if (courseId && !courseExists(courseId)) throw new StudentError('notFound', 404);
    }

    let status = existing.status;
    let completedAt = existing.completedAt;
    if (input.status !== undefined) {
      if (!TASK_STATUSES.includes(input.status)) throw new StudentError('invalidInput');
      status = input.status;
      if (status === 'completed' && !completedAt) completedAt = now();
      if (status !== 'completed') completedAt = null;
    }

    const time = now();

    db.prepare(`
      UPDATE study_tasks
      SET title = ?, plannedDate = ?, plannedTime = ?, estimatedDuration = ?,
          priority = ?, notes = ?, courseId = ?, status = ?, completedAt = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      title, plannedDate, plannedTime, estimatedDuration,
      priority, notes, courseId, status, completedAt, time, id
    );

    return getTask(id);
  }

  function deleteTask(id) {
    getTask(id);
    db.prepare('DELETE FROM study_tasks WHERE id = ?').run(id);
    return { ok: true, id };
  }

  function completeTask(id, logInput = {}, options = {}) {
    const existing = getTask(id);
    const reqId = options.requestId || logInput?.requestId;
    if (reqId && existing.status === 'completed' && existing.requestId === String(reqId)) {
      const log = existing.studyLogId ? getLog(existing.studyLogId) : null;
      return { task: existing, log, studyLog: log };
    }

    return db.transaction(() => {
      let logId = existing.studyLogId;
      let log;

      const studyDate = logInput?.studyDate ? dateString(logInput.studyDate, true) : getTodayInBangkok();
      const today = getTodayInBangkok();
      if (studyDate > today) throw new StudentError('futureDateNotAllowed', 400);

      const durationMinutes = integer(logInput?.durationMinutes ?? logInput?.actualMinutes ?? logInput?.actualDuration, 0, 1440, false);
      const learnedContent = text(logInput?.learnedContent ?? logInput?.content ?? `Hoàn thành việc: ${existing.title}`, 5000, false);
      const difficulties = text(logInput?.difficulties ?? logInput?.blockers ?? '', 2000, false);
      const nextSteps = text(logInput?.nextSteps ?? '', 2000, false);

      const logPayload = {
        studyDate,
        courseId: logInput?.courseId !== undefined ? logInput.courseId : existing.courseId,
        title: logInput?.title ? text(logInput.title, 120, true) : existing.title,
        activityType: logInput?.activityType || 'practice',
        durationMinutes,
        learnedContent,
        difficulties,
        nextSteps,
      };

      if (logId) {
        log = updateLog(logId, logPayload);
      } else {
        log = createLog(logPayload);
        logId = log.id;
      }

      const time = now();
      db.prepare(`
        UPDATE study_tasks
        SET status = 'completed', completedAt = ?, studyLogId = ?, requestId = COALESCE(?, requestId), updatedAt = ?
        WHERE id = ?
      `).run(time, logId, reqId ? String(reqId) : null, time, id);

      const task = getTask(id);
      return {
        task: {
          ...task,
          actualMinutes: log.durationMinutes,
        },
        log,
        studyLog: log,
      };
    })();
  }

  function reopenTask(id) {
    getTask(id);
    const time = now();
    db.prepare(`
      UPDATE study_tasks
      SET status = 'pending', completedAt = NULL, updatedAt = ?
      WHERE id = ?
    `).run(time, id);
    return getTask(id);
  }

  function updateReminder(id, { action, snoozeMinutes = 15 } = {}) {
    getTask(id);
    const time = now();
    if (action === 'dismiss') {
      db.prepare('UPDATE study_tasks SET reminderDismissedAt = ?, updatedAt = ? WHERE id = ?').run(time, time, id);
    } else if (action === 'snooze') {
      const snoozedUntil = new Date(Date.now() + (snoozeMinutes || 15) * 60000).toISOString();
      const nextTime = new Date(Date.now() + (snoozeMinutes || 15) * 60000).toTimeString().slice(0, 5);
      db.prepare('UPDATE study_tasks SET reminderSnoozedUntil = ?, plannedTime = ?, updatedAt = ? WHERE id = ?').run(snoozedUntil, nextTime, time, id);
    } else {
      throw new StudentError('invalidInput');
    }
    return getTask(id);
  }

  function getSuggestions({ limit = 5 } = {}) {
    const today = getTodayInBangkok();

    // 1. Next steps from recent study logs (last 30 days) that have nextSteps text
    const recentLogsWithSteps = db.prepare(`
      SELECT id, title, nextSteps, courseId, studyDate
      FROM study_logs
      WHERE nextSteps IS NOT NULL AND trim(nextSteps) != ''
      ORDER BY studyDate DESC, createdAt DESC
      LIMIT ?
    `).all(limit * 2);

    // 2. Overdue tasks
    const overdueTasks = db.prepare(`
      SELECT t.*, c.name AS courseName
      FROM study_tasks t
      LEFT JOIN courses c ON c.id = t.courseId
      WHERE t.plannedDate < ? AND t.status IN ('pending', 'in_progress')
      ORDER BY t.plannedDate ASC, t.priority DESC
      LIMIT ?
    `).all(today, limit);

    const suggestions = [];

    for (const t of overdueTasks) {
      suggestions.push({
        type: 'overdue_task',
        reason: 'overdue',
        taskId: t.id,
        title: t.title,
        courseId: t.courseId,
        courseName: t.courseName,
        priority: t.priority,
      });
    }

    for (const l of recentLogsWithSteps) {
      suggestions.push({
        type: 'log_next_step',
        reason: 'next_steps',
        logId: l.id,
        title: l.nextSteps,
        originalTitle: l.title,
        courseId: l.courseId,
      });
    }

    return {
      nextSteps: recentLogsWithSteps.slice(0, limit),
      overdueTasks,
      suggestions: suggestions.slice(0, limit * 2),
    };
  }

  return {
    getTodayInBangkok,
    // Logs (P3)
    listLogs,
    getLog,
    createLog,
    updateLog,
    deleteLog,
    getSummary,
    // Tasks (P4)
    listTasks,
    getTask,
    createTask,
    updateTask,
    deleteTask,
    completeTask,
    reopenTask,
    updateReminder,
    getSuggestions,
  };
}
