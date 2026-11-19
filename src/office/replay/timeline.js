// The study dashboard: 12-month GitHub-style contribution heatmap, study streak, and daily planner.
// Powered by local SQLite backend (/api/student/study-logs and /api/student/study-tasks).
import { $, el } from '../core/env.js';
import { state } from '../core/state.js';
import { toast } from '../ui/activity.js';
import { closePlace } from '../interact/place-cards.js';
import { renderBell } from '../ui/topbar.js';
import { DEMO, connect, startDemo } from '../demo/demo.js';

// Recorder stubs kept for compatibility with other modules
export const recAuto = false;
export const recorder = null;
export function stopRecording() {}

function getBangkokDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

const studyState = {
  courseId: '',
  selectedDate: getBangkokDate(),
  courses: [],
  summary: null,
  tasks: [],
  dayLogs: [],
  modalMode: 'log', // 'log' | 'complete_task' | 'create_task'
  activeTaskId: null,
};

export function closeTimeline() {
  state.paused3d = false;
  const tl = $('tl');
  if (tl) tl.hidden = true;
  const modal = $('tl-modal');
  if (modal) modal.hidden = true;
}

export function openTimeline() {
  state.paused3d = true;
  const tl = $('tl');
  if (!tl) return;
  tl.hidden = false;
  closePlace();
  loadStudyDashboard();
  $('tl-close')?.focus({ preventScroll: true });
}

function calculateStreak(days, todayStr) {
  if (!days || !days.length) return 0;
  // Sort or find today index
  const map = new Map();
  for (const d of days) map.set(d.date, d);

  let streak = 0;
  const cur = new Date(todayStr + 'T00:00:00Z');

  // Check today: if 0 logs today, streak might still be alive from yesterday
  const todayEntry = map.get(todayStr);
  if (todayEntry && (todayEntry.count > 0 || todayEntry.totalMinutes > 0)) {
    streak++;
  }

  // Count backwards from yesterday
  cur.setUTCDate(cur.getUTCDate() - 1);
  while (true) {
    const dStr = cur.toISOString().slice(0, 10);
    const e = map.get(dStr);
    if (e && (e.count > 0 || e.totalMinutes > 0)) {
      streak++;
      cur.setUTCDate(cur.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function calculateWeekHours(days, todayStr) {
  if (!days || !days.length) return '0';
  const cur = new Date(todayStr + 'T00:00:00Z');
  let mins = 0;
  for (let i = 0; i < 7; i++) {
    const dStr = cur.toISOString().slice(0, 10);
    const match = days.find((d) => d.date === dStr);
    if (match) mins += (match.totalMinutes || 0);
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return (mins / 60).toFixed(1);
}

async function fetchCourses() {
  try {
    const res = await fetch('/api/student/courses');
    if (!res.ok) return [];
    const data = await res.json();
    return data.courses || data.items || [];
  } catch {
    return [];
  }
}

async function fetchSummary(courseId) {
  try {
    const url = '/api/student/study-logs/summary' + (courseId ? `?courseId=${encodeURIComponent(courseId)}` : '');
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTasks(courseId) {
  try {
    const url = '/api/student/study-tasks?status=pending' + (courseId ? `&courseId=${encodeURIComponent(courseId)}` : '');
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.tasks || data.items || [];
  } catch {
    return [];
  }
}

async function fetchDayLogs(dateStr, courseId) {
  try {
    const url = `/api/student/study-logs?studyDate=${encodeURIComponent(dateStr)}` + (courseId ? `&courseId=${encodeURIComponent(courseId)}` : '');
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.logs || data.items || [];
  } catch {
    return [];
  }
}

export async function loadStudyDashboard(courseId = studyState.courseId) {
  studyState.courseId = courseId;
  const todayStr = getBangkokDate();

  // 1. Fetch courses if empty
  if (!studyState.courses.length) {
    studyState.courses = await fetchCourses();
  }

  // 2. Fetch summary & tasks
  const [summary, tasks] = await Promise.all([
    fetchSummary(courseId),
    fetchTasks(courseId),
  ]);
  studyState.summary = summary;
  studyState.tasks = tasks;

  // 3. Render course filter tabs
  renderCourseTabs();

  // 4. Render KPIs
  renderKPIs(summary, tasks, todayStr);

  // 5. Render Heatmap Matrix
  renderHeatmap(summary, todayStr);

  // 6. Render Day logs & Today tasks
  await refreshDayLogs(studyState.selectedDate || todayStr);
  renderTodayTasks(tasks);
}

function renderCourseTabs() {
  const container = $('tl-courses-filter');
  if (!container) return;
  container.replaceChildren();

  const allBtn = el('button', null, 'Tất cả môn');
  allBtn.type = 'button';
  allBtn.setAttribute('aria-pressed', String(!studyState.courseId));
  allBtn.addEventListener('click', () => loadStudyDashboard(''));
  container.append(allBtn);

  for (const c of studyState.courses) {
    const btn = el('button', null, c.code || c.name);
    btn.type = 'button';
    btn.title = c.name;
    btn.setAttribute('aria-pressed', String(studyState.courseId === c.id));
    btn.addEventListener('click', () => loadStudyDashboard(c.id));
    container.append(btn);
  }
}

function renderKPIs(summary, tasks, todayStr) {
  const kpis = $('tl-kpis');
  if (!kpis) return;

  const days = summary?.days || [];
  const streak = calculateStreak(days, todayStr);
  const weekHours = calculateWeekHours(days, todayStr);
  const totalHours = ((summary?.totalMinutes || 0) / 60).toFixed(1);

  const kpiCard = (icon, val, lbl, sub) => {
    const card = el('div', 'tl-kpi');
    const b = el('b', null, val);
    const span = el('span', null, `${icon} ${lbl}`);
    card.append(b, span);
    if (sub) card.title = sub;
    return card;
  };

  kpis.replaceChildren(
    kpiCard('🔥', `${streak} ngày`, 'Streak liên tục', 'Chuỗi ngày có học tập ghi nhận trên hệ thống'),
    kpiCard('⏱️', `${weekHours} giờ`, 'Tuần này', 'Tổng số giờ học thực tế trong 7 ngày gần nhất'),
    kpiCard('📚', `${totalHours} giờ`, 'Tổng tích lũy 12 tháng', `Tổng cộng ${summary?.totalLogs || 0} lần ghi nhật ký`),
    kpiCard('🎯', `${tasks.length} việc`, 'Cần làm hôm nay', 'Số lượng công việc đang chờ hoàn thành'),
  );
}

function renderHeatmap(summary, todayStr) {
  const grid = $('tl-heatmap-grid');
  const monthLabels = $('tl-month-labels');
  const info = $('tl-heatmap-info');
  if (!grid || !summary?.days) return;

  grid.replaceChildren();

  // Render Month labels across 12 months
  if (monthLabels) {
    monthLabels.replaceChildren();
    const months = ['T12', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11'];
    for (const m of months) {
      const sp = el('span', null, m);
      monthLabels.append(sp);
    }
  }

  const days = summary.days;
  for (const d of days) {
    const cell = el('div', `tl-cell lvl-${d.level || 0}`);
    cell.dataset.date = d.date;
    cell.dataset.minutes = String(d.totalMinutes || 0);
    cell.dataset.count = String(d.count || 0);

    if (d.date === studyState.selectedDate) {
      cell.style.outline = '2px solid var(--accent)';
    }

    cell.addEventListener('mouseenter', () => {
      if (info) {
        const isToday = d.date === todayStr ? ' (Hôm nay)' : '';
        const mins = d.totalMinutes || 0;
        const text = mins > 0
          ? `${d.date}${isToday}: ${mins} phút học tập · ${d.count} bài học (Level ${d.level}/4)`
          : `${d.date}${isToday}: Chưa có nhật ký học tập (0 phút)`;
        info.textContent = text;
      }
    });

    cell.addEventListener('click', () => {
      studyState.selectedDate = d.date;
      for (const c of grid.querySelectorAll('.tl-cell')) {
        c.style.outline = '';
      }
      cell.style.outline = '2px solid var(--accent)';
      refreshDayLogs(d.date);
    });

    grid.append(cell);
  }
}

async function refreshDayLogs(dateStr) {
  studyState.selectedDate = dateStr;
  const title = $('tl-selected-date-text');
  if (title) title.textContent = dateStr === getBangkokDate() ? `${dateStr} (Hôm nay)` : dateStr;

  const container = $('tl-day-logs-list');
  if (!container) return;
  container.replaceChildren(el('p', 'tl-empty', 'Đang tải nhật ký…'));

  const logs = await fetchDayLogs(dateStr, studyState.courseId);
  studyState.dayLogs = logs;

  container.replaceChildren();
  if (!logs.length) {
    const empty = el('p', 'tl-empty', 'Chưa có nhật ký học tập nào trong ngày này.');
    container.append(empty);
    return;
  }

  for (const log of logs) {
    const item = el('div', 'tl-item');
    const left = el('div', 'tl-item-left');
    const courseCode = log.courseCode || (studyState.courses.find((c) => c.id === log.courseId)?.code) || 'Tự học';
    const titleEl = el('span', 'tl-item-title', `[${courseCode}] ${log.title || 'Buổi học'}`);
    const sub = el('span', 'tl-item-sub', log.learnedContent ? ` — ${log.learnedContent.slice(0, 60)}…` : '');
    left.append(titleEl, sub);

    const badge = el('span', 'tl-item-badge badge-green', `${log.durationMinutes || 0} phút`);
    item.append(left, badge);
    container.append(item);
  }
}

function renderTodayTasks(tasks) {
  const container = $('tl-today-tasks-list');
  const counter = $('tl-plan-counter');
  if (!container) return;

  if (counter) {
    const done = tasks.filter((t) => t.status === 'completed').length;
    counter.textContent = `${done}/${tasks.length}`;
  }

  container.replaceChildren();
  if (!tasks.length) {
    container.append(el('p', 'tl-empty', 'Hôm nay chưa có việc nào. Bấm "+ Thêm việc" để lập kế hoạch!'));
    return;
  }

  for (const task of tasks) {
    const item = el('div', 'tl-item');
    const left = el('div', 'tl-item-left');

    const check = el('input', 'tl-item-check');
    check.type = 'checkbox';
    check.checked = task.status === 'completed';

    check.addEventListener('change', () => {
      if (check.checked) {
        check.checked = false; // keep state until confirmed
        openModalForTaskComplete(task);
      }
    });

    const courseCode = task.courseCode || (studyState.courses.find((c) => c.id === task.courseId)?.code) || '';
    const prefix = courseCode ? `[${courseCode}] ` : '';
    const titleEl = el('span', 'tl-item-title', `${prefix}${task.title}`);
    if (task.status === 'completed') titleEl.style.textDecoration = 'line-through';

    left.append(check, titleEl);

    const estMins = task.estimatedDuration || task.estimatedMinutes || 45;
    const badge = el('span', 'tl-item-badge', `Ước tính: ${estMins}p`);
    item.append(left, badge);
    container.append(item);
  }
}

function openModalForTaskComplete(task) {
  studyState.modalMode = 'complete_task';
  studyState.activeTaskId = task.id;

  const modal = $('tl-modal');
  if (!modal) return;
  modal.hidden = false;

  $('tl-modal-title').textContent = `Hoàn thành việc: ${task.title}`;
  populateCourseSelect(task.courseId);
  $('tl-form-title').value = task.title;
  $('tl-form-title').disabled = true;
  $('tl-form-minutes').value = String(task.estimatedDuration || 45);
  $('tl-form-notes').value = task.notes || '';
}

function openModalForAddLog() {
  studyState.modalMode = 'log';
  studyState.activeTaskId = null;

  const modal = $('tl-modal');
  if (!modal) return;
  modal.hidden = false;

  $('tl-modal-title').textContent = 'Ghi nhật ký học tập (100% Offline)';
  populateCourseSelect(studyState.courseId);
  $('tl-form-title').value = '';
  $('tl-form-title').disabled = false;
  $('tl-form-title').placeholder = 'Ví dụ: Ôn tập Tính Đóng Gói (OOP)...';
  $('tl-form-minutes').value = '45';
  $('tl-form-notes').value = '';
}

function openModalForAddTask() {
  studyState.modalMode = 'create_task';
  studyState.activeTaskId = null;

  const modal = $('tl-modal');
  if (!modal) return;
  modal.hidden = false;

  $('tl-modal-title').textContent = 'Thêm việc cần làm hôm nay';
  populateCourseSelect(studyState.courseId);
  $('tl-form-title').value = '';
  $('tl-form-title').disabled = false;
  $('tl-form-title').placeholder = 'Ví dụ: Làm bài tập 3 trang 45 sách Database...';
  $('tl-form-minutes').value = '45';
  $('tl-form-notes').value = '';
}

function populateCourseSelect(selectedId) {
  const sel = $('tl-form-course');
  if (!sel) return;
  sel.replaceChildren();

  const optNone = el('option', null, '-- Tự học tự do --');
  optNone.value = '';
  sel.append(optNone);

  for (const c of studyState.courses) {
    const opt = el('option', null, `${c.code ? `[${c.code}] ` : ''}${c.name}`);
    opt.value = c.id;
    if (c.id === selectedId) opt.selected = true;
    sel.append(opt);
  }
}

async function handleModalSubmit(e) {
  e.preventDefault();
  const courseId = $('tl-form-course')?.value || null;
  const title = $('tl-form-title')?.value.trim();
  const minutes = Number($('tl-form-minutes')?.value) || 30;
  const notes = $('tl-form-notes')?.value.trim();
  const todayStr = getBangkokDate();

  if (!title) return;

  try {
    if (studyState.modalMode === 'complete_task') {
      // Rule 4: Must pass actualMinutes when completing task
      const res = await fetch(`/api/student/study-tasks/${encodeURIComponent(studyState.activeTaskId)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualMinutes: minutes, notes, studyDate: todayStr }),
      });
      if (!res.ok) throw new Error('Failed to complete task');
      toast(`✓ Đã hoàn thành công việc và ghi nhận ${minutes} phút vào Heatmap!`);
    } else if (studyState.modalMode === 'log') {
      const res = await fetch('/api/student/study-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          title,
          activityType: 'practice',
          durationMinutes: minutes,
          learnedContent: notes,
          studyDate: todayStr,
        }),
      });
      if (!res.ok) throw new Error('Failed to create log');
      toast(`✓ Đã lưu nhật ký: ${minutes} phút học tập`);
    } else if (studyState.modalMode === 'create_task') {
      const res = await fetch('/api/student/study-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          title,
          estimatedDuration: minutes,
          notes,
          plannedDate: todayStr,
        }),
      });
      if (!res.ok) throw new Error('Failed to create task');
      toast('✓ Đã thêm công việc vào kế hoạch hôm nay');
    }

    closeModal();
    await loadStudyDashboard();
  } catch (err) {
    toast(`Lỗi: ${err.message}`);
  }
}

function closeModal() {
  const modal = $('tl-modal');
  if (modal) modal.hidden = true;
}

export function setup() {
  // Bind open buttons
  $('tl-open')?.addEventListener('click', openTimeline);
  $('btn-study-heatmap')?.addEventListener('click', openTimeline);
  $('tl-close')?.addEventListener('click', closeTimeline);

  // Add action buttons
  $('tl-add-log-btn')?.addEventListener('click', openModalForAddLog);
  $('tl-day-add-btn')?.addEventListener('click', openModalForAddLog);
  $('tl-add-task-btn')?.addEventListener('click', openModalForAddTask);
  $('tl-plan-add-btn')?.addEventListener('click', openModalForAddTask);

  // Modal handlers
  $('tl-modal-close')?.addEventListener('click', closeModal);
  $('tl-modal-cancel')?.addEventListener('click', closeModal);
  $('tl-modal-form')?.addEventListener('submit', handleModalSubmit);

  // Quick minute chips
  document.querySelectorAll('.tl-quick-minutes button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.m;
      if (m && $('tl-form-minutes')) $('tl-form-minutes').value = m;
    });
  });

  // Keybindings
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('tl-modal');
      if (modal && !modal.hidden) {
        closeModal();
        e.stopPropagation();
        return;
      }
      const tl = $('tl');
      if (tl && !tl.hidden) {
        closeTimeline();
      }
    }
  });

  if (DEMO) startDemo(); else connect();
  renderBell();
}
