import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createStudentService } from '../../server/student/service.mjs';
import { createStudentRoutes } from '../../server/student/routes.mjs';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
import { getTodayInBangkok } from '../../server/student/study.mjs';

test('P3: study logs CRUD, validation, future date restriction, and 12-month summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-logs-test-'));
  const service = createStudentService(dir, { aiProvider: createMockAIProvider() });
  try {
    const today = getTodayInBangkok();
    const semester = service.createSemester({ name: 'Spring 2026', academicYear: '2025-2026' });
    const course = service.createCourse({ semesterId: semester.id, name: 'Data Structures' });

    // 1. Cannot create log in the future
    const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
    assert.throws(() => {
      service.createStudyLog({
        title: 'Future log',
        studyDate: tomorrow,
        activityType: 'reading',
      });
    }, (err) => err.code === 'futureDateNotAllowed');

    // 2. Can create log for today with full details
    const log1 = service.createStudyLog({
      courseId: course.id,
      title: 'Graph algorithms review',
      activityType: 'review',
      studyDate: today,
      durationMinutes: 90,
      content: 'Reviewed Dijkstra and A* search algorithms.',
      blockers: 'Confused about admissible vs consistent heuristics.',
      nextSteps: 'Implement PriorityQueue and solve 3 LeetCode problems.',
    });
    assert.ok(log1.id);
    assert.equal(log1.courseId, course.id);
    assert.equal(log1.courseName, 'Data Structures');
    assert.equal(log1.title, 'Graph algorithms review');
    assert.equal(log1.durationMinutes, 90);
    assert.equal(log1.activityType, 'review');

    // 3. Can create log for a past date without course (e.g. Japanese study)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const logPast = service.createStudyLog({
      title: 'Kanji practice N3',
      activityType: 'practice',
      studyDate: yesterday,
      durationMinutes: 45,
      content: 'Practiced 30 kanji characters.',
    });
    assert.ok(logPast.id);
    assert.equal(logPast.courseId, null);
    assert.equal(logPast.courseName, null);

    // 4. List logs with filters
    const allLogs = service.studyLogs();
    assert.equal(allLogs.total, 2);
    assert.equal(allLogs.logs.length, 2);

    const courseLogs = service.studyLogs({ courseId: course.id });
    assert.equal(courseLogs.total, 1);
    assert.equal(courseLogs.logs[0].id, log1.id);

    // 5. Update log
    const updated = service.updateStudyLog(log1.id, {
      title: 'Graph algorithms review (Complete)',
      durationMinutes: 120,
    });
    assert.equal(updated.title, 'Graph algorithms review (Complete)');
    assert.equal(updated.durationMinutes, 120);

    // Cannot update date to future
    assert.throws(() => {
      service.updateStudyLog(log1.id, { studyDate: tomorrow });
    }, (err) => err.code === 'futureDateNotAllowed');

    // 6. 12-month summary / heatmap
    const summary = service.studySummary();
    assert.ok(summary.days.length >= 365, 'Continuous 12 months date range');
    assert.equal(summary.stats.totalLogs, 2);
    assert.equal(summary.stats.totalMinutes, 165); // 120 + 45
    assert.equal(summary.stats.activeDays, 2);

    // Check level calculations:
    // 0: 0 logs, 1: 1 log, 2: 2-3 logs, 3: 4-5 logs, 4: >= 6 logs
    const todayCell = summary.days.find((d) => d.date === today);
    assert.ok(todayCell);
    assert.equal(todayCell.count, 1);
    assert.equal(todayCell.level, 1);
    assert.equal(todayCell.totalMinutes, 120);

    // Add 5 more logs for today to test level 4 (>=6 logs)
    for (let i = 0; i < 5; i++) {
      service.createStudyLog({
        title: `Extra log ${i}`,
        activityType: 'exercise',
        studyDate: today,
        durationMinutes: 10,
      });
    }
    const updatedSummary = service.studySummary();
    const updatedTodayCell = updatedSummary.days.find((d) => d.date === today);
    assert.equal(updatedTodayCell.count, 6);
    assert.equal(updatedTodayCell.level, 4);

    // 7. Delete log
    service.deleteStudyLog(logPast.id);
    assert.throws(() => service.studyLog(logPast.id), (err) => err.code === 'notFound');
  } finally {
    service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P4: study tasks CRUD, planning sections, transactional complete, reopen and suggestions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-tasks-test-'));
  const service = createStudentService(dir, { aiProvider: createMockAIProvider() });
  try {
    const today = getTodayInBangkok();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const semester = service.createSemester({ name: 'Fall 2026', academicYear: '2026-2027' });
    const course = service.createCourse({ semesterId: semester.id, name: 'Computer Networks' });

    // 1. Create tasks with requestId idempotency
    const reqId = randomUUID();
    const taskToday = service.createStudyTask({
      courseId: course.id,
      title: 'Read chapter 3 - Transport Layer',
      targetDate: today,
      estimatedMinutes: 60,
      priority: 'high',
      scope: 'course',
      reminderTime: '14:00',
      requestId: reqId,
    });
    assert.ok(taskToday.id);
    assert.equal(taskToday.priority, 'high');
    assert.equal(taskToday.status, 'pending');

    // Duplicate create with same requestId returns existing task
    const duplicate = service.createStudyTask({
      courseId: course.id,
      title: 'Should be ignored',
      targetDate: today,
      requestId: reqId,
    });
    assert.equal(duplicate.id, taskToday.id);
    assert.equal(duplicate.title, 'Read chapter 3 - Transport Layer');

    // Create an overdue task
    const taskOverdue = service.createStudyTask({
      courseId: course.id,
      title: 'Finish lab 1',
      targetDate: yesterday,
      priority: 'urgent',
    });

    // Create an upcoming task
    const taskUpcoming = service.createStudyTask({
      title: 'Prep presentation',
      targetDate: tomorrow,
      priority: 'medium',
    });

    // 2. List tasks verifies grouping
    const taskList = service.studyTasks();
    assert.equal(taskList.overdue.length, 1);
    assert.equal(taskList.overdue[0].id, taskOverdue.id);
    assert.equal(taskList.today.length, 1);
    assert.equal(taskList.today[0].id, taskToday.id);
    assert.equal(taskList.upcoming.length, 1);
    assert.equal(taskList.upcoming[0].id, taskUpcoming.id);
    assert.equal(taskList.completed.length, 0);

    // 3. Complete task with transactional study log creation
    const completeReqId = randomUUID();
    const completed = service.completeStudyTask(taskToday.id, {
      actualMinutes: 75, // User specifies actual duration
      content: 'Understood TCP 3-way handshake and congestion control.',
      blockers: 'Fast retransmit vs fast recovery.',
      nextSteps: 'Packet capture wireshark exercise.',
      requestId: completeReqId,
    });
    assert.equal(completed.task.status, 'completed');
    assert.equal(completed.task.actualMinutes, 75);
    assert.ok(completed.task.completedAt);
    assert.ok(completed.task.studyLogId);
    assert.ok(completed.studyLog);
    assert.equal(completed.studyLog.durationMinutes, 75);
    assert.equal(completed.studyLog.studyDate, today);
    assert.equal(completed.studyLog.content, 'Understood TCP 3-way handshake and congestion control.');

    // Duplicate complete with same requestId is idempotent
    const reCompleted = service.completeStudyTask(taskToday.id, {
      actualMinutes: 999,
      requestId: completeReqId,
    });
    assert.equal(reCompleted.task.actualMinutes, 75);

    // 4. Reopen task
    const reopened = service.reopenStudyTask(taskToday.id);
    assert.equal(reopened.status, 'pending');
    assert.equal(reopened.completedAt, null);
    // Old study log is still preserved in DB
    const preservedLog = service.studyLog(completed.studyLog.id);
    assert.ok(preservedLog);

    // 5. Re-completing task updates the existing linked study log
    const reCompleteNew = service.completeStudyTask(taskToday.id, {
      actualMinutes: 80,
      content: 'Updated content after review.',
    });
    assert.equal(reCompleteNew.studyLog.id, completed.studyLog.id);
    assert.equal(reCompleteNew.studyLog.durationMinutes, 80);
    assert.equal(reCompleteNew.studyLog.content, 'Updated content after review.');

    // 6. Reminder actions: snooze and dismiss
    const snoozed = service.updateStudyReminder(taskOverdue.id, { action: 'snooze', snoozeMinutes: 15 });
    assert.ok(snoozed.reminderTime, 'Reminder time was snoozed');

    const dismissed = service.updateStudyReminder(taskOverdue.id, { action: 'dismiss' });
    assert.equal(dismissed.reminderDismissed, true);

    // 7. Suggestions: based on overdue tasks and previous log nextSteps
    const suggestions = service.studySuggestions({ date: today });
    assert.ok(suggestions.suggestions.length > 0);
    const hasOverdueSuggestion = suggestions.suggestions.some((s) => s.reason === 'overdue');
    assert.ok(hasOverdueSuggestion, 'Suggests finishing overdue task');

    // 8. Cascade safety: deleting study log clears task's studyLogId without breaking task
    service.deleteStudyLog(completed.studyLog.id);
    const taskAfterLogDelete = service.studyTask(taskToday.id);
    assert.equal(taskAfterLogDelete.studyLogId, null);
    assert.equal(taskAfterLogDelete.status, 'completed');

    // 9. Course deletion restriction: course with tasks cannot be deleted
    assert.throws(() => service.deleteCourse(course.id), (err) => err.code === 'courseNotEmpty');
  } finally {
    service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P3-P4: HTTP endpoints for study-logs and study-tasks', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-http-test-'));
  const service = createStudentService(dir, { aiProvider: createMockAIProvider() });
  const handler = createStudentRoutes({
    service,
    authorized: () => true,
    sameOrigin: () => true,
  });
  const server = http.createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    service.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json' };
  const today = getTodayInBangkok();

  // Create log via POST
  const resLog = await fetch(`${base}/api/student/study-logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'HTTP Study Log',
      studyDate: today,
      activityType: 'read',
      durationMinutes: 45,
    }),
  });
  assert.equal(resLog.status, 201);
  const createdLog = await resLog.json();
  assert.equal(createdLog.title, 'HTTP Study Log');

  // GET logs
  const resLogs = await fetch(`${base}/api/student/study-logs`);
  assert.equal(resLogs.status, 200);
  const listLogs = await resLogs.json();
  assert.equal(listLogs.total, 1);

  // GET summary
  const resSummary = await fetch(`${base}/api/student/study-logs/summary`);
  assert.equal(resSummary.status, 200);
  const summary = await resSummary.json();
  assert.ok(summary.days.length >= 365);

  // Create task via POST
  const resTask = await fetch(`${base}/api/student/study-tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'HTTP Study Task',
      plannedDate: today,
      priority: 'high',
      estimatedDuration: 30,
    }),
  });
  assert.equal(resTask.status, 201);
  const createdTask = await resTask.json();
  assert.equal(createdTask.title, 'HTTP Study Task');

  // Complete task via POST
  const resComplete = await fetch(`${base}/api/student/study-tasks/${createdTask.id}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      actualMinutes: 40,
      content: 'Finished HTTP task cleanly',
    }),
  });
  assert.equal(resComplete.status, 200);
  const completed = await resComplete.json();
  assert.equal(completed.task.status, 'completed');
  assert.equal(completed.task.actualMinutes, 40);

  // Reopen task
  const resReopen = await fetch(`${base}/api/student/study-tasks/${createdTask.id}/reopen`, {
    method: 'POST',
    headers,
  });
  assert.equal(resReopen.status, 200);
  const reopened = await resReopen.json();
  assert.equal(reopened.status, 'pending');

  // Reminder snooze
  const resSnooze = await fetch(`${base}/api/student/study-tasks/${createdTask.id}/reminder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'snooze', snoozeMinutes: 15 }),
  });
  assert.equal(resSnooze.status, 200);
  const snoozed = await resSnooze.json();
  assert.ok(snoozed.reminderTime);

  // Suggestions endpoint
  const resSuggestions = await fetch(`${base}/api/student/study-tasks/suggestions`);
  assert.equal(resSuggestions.status, 200);
});
