import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { studentPdf } from '../fixtures/student-pdf.mjs';
import { officeStartTimeout } from './browser-options';

type Actor = { courseId: string; actorId: string; attemptId: string; status: string; current: string | null; inScene: boolean; anim: string; phase: string; history: string[]; position: { x: number; z: number }; home: { x: number; z: number } };
type DebugWindow = Window & { __studentOffice?: { ready: () => boolean; inspect: () => Actor[] } };
const inspect = (page: Page, courseId: string) => page.evaluate((id) => (window as DebugWindow).__studentOffice?.inspect().find((item) => item.courseId === id), courseId);

test('@smoke Student Tutor drives independent 3D actors across two tabs, failure/retry and refresh', async ({ page: student, context, request }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  const office = await context.newPage();
  for (const page of [student, office]) page.on('pageerror', (error) => errors.push(error.message));
  await office.addInitScript(() => { localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-quality', 'low'); });
  await office.goto('/?layout=cozy&debug');
  await expect(office.locator('#stage canvas')).toBeVisible({ timeout: officeStartTimeout });
  await office.waitForFunction(() => (window as DebugWindow).__studentOffice?.ready());
  const semester = await (await request.post('/api/student/semesters', { data: { name: 'Office adapter semester', academicYear: '2026' } })).json();
  const course = await (await request.post('/api/student/courses', { data: { semesterId: semester.id, name: 'Office OOP' } })).json();
  const other = await (await request.post('/api/student/courses', { data: { semesterId: semester.id, name: 'Office Database' } })).json();
  const ready = async (courseId: string) => {
    const doc = await (await request.post(`/api/student/courses/${courseId}/materials?filename=PrivateLecture.pdf`, { headers: { 'Content-Type': 'application/pdf' }, data: studentPdf() })).json();
    expect((await request.post(`/api/student/documents/${doc.id}/process?sync=true`)).ok()).toBe(true);
  };
  await ready(course.id);
  expect((await request.post('/api/student/memories', { data: { scope: 'course', courseId: course.id, content: 'Aggregation is hard PRIVATE_MEMORY_CONTENT', requestId: randomUUID() } })).ok()).toBe(true);
  await student.goto(`/student?course=${course.id}&tab=chat`);
  await student.getByLabel('Your question', { exact: true }).fill('Explain aggregation PRIVATE_QUESTION_CONTENT');
  await student.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(student.locator('.student-chat-assistant')).toHaveCount(1);
  const card = office.locator(`.student-office-card[data-course-id="${course.id}"]`);
  await expect(card).toHaveAttribute('data-status', 'completed');
  await expect(office.locator('#empty')).toBeHidden();
  await expect(card).toContainText('Simulated');
  await expect(card).toContainText('Selecting saved memory: Done');
  await office.bringToFront();
  // These diagnostics describe the actual scene object and animation, not just receipt of an event.
  await expect.poll(async () => {
    const actor = await inspect(office, course.id);
    return !!actor?.inScene && Math.hypot(actor.position.x - actor.home.x, actor.position.z - actor.home.z) > 0.2;
  }, { timeout: 15000 }).toBe(true);
  await office.screenshot({ path: test.info().outputPath('student-tutor-walking.png'), fullPage: true });
  await expect.poll(async () => (await inspect(office, course.id))?.history, { timeout: 45000 }).toEqual(['library.search', 'memory.search', 'ai.respond']);
  await expect.poll(async () => (await inspect(office, course.id))?.current, { timeout: 15000 }).toBeNull();
  const actor = (await inspect(office, course.id))!;
  expect(actor.actorId).toBe('student:tutor:' + course.id);
  expect(actor.anim).toBe('idle'); expect(actor.inScene).toBe(true);
  expect(Math.hypot(actor.position.x - actor.home.x, actor.position.z - actor.home.z)).toBeLessThan(0.05);
  await office.screenshot({ path: test.info().outputPath('student-tutor-completed.png'), fullPage: true });

  const failure = { courseId: other.id, message: 'Explain aggregation and composition', language: 'en', requestId: randomUUID() };
  expect((await request.post('/api/student/chat', { data: failure })).status()).toBe(409);
  const failedCard = office.locator(`.student-office-card[data-course-id="${other.id}"]`);
  await expect(failedCard).toHaveAttribute('data-status', 'failed');
  const failedAttempt = (await inspect(office, other.id))!.attemptId;
  expect((await inspect(office, other.id))!.current).toBeNull();
  await ready(other.id);
  await student.goto(`/student?course=${other.id}&tab=chat`);
  await student.getByRole('button', { name: 'Retry this question', exact: true }).click();
  await expect(student.locator('.student-chat-assistant')).toHaveCount(1);
  await expect(failedCard).toHaveAttribute('data-status', 'completed');
  expect((await inspect(office, other.id))!.attemptId).not.toBe(failedAttempt);
  expect((await inspect(office, course.id))!.attemptId).toBe(actor.attemptId);

  const snapshot = async () => {
    const live = await (await request.get('/api/live')).json();
    return live.msgs.find((message: { k: string }) => message.k === 'snap').student;
  };
  const before = await snapshot();
  expect(JSON.stringify(before)).not.toContain('PRIVATE_QUESTION_CONTENT');
  expect(JSON.stringify(before)).not.toContain('PRIVATE_MEMORY_CONTENT');
  expect(JSON.stringify(before)).not.toContain('PrivateLecture.pdf');
  const oldEvent = before.courses.find((row: { event: { courseId: string } }) => row.event.courseId === other.id).event;
  expect((await request.post('/api/student/chat', { data: failure })).ok()).toBe(true);
  const after = await snapshot();
  expect(after.courses.find((row: { event: { courseId: string } }) => row.event.courseId === other.id).event.seq).toBe(oldEvent.seq);
  // A full reload restores final state at rest, without replaying old movements.
  await office.goto('/?layout=pro&debug&lang=vi');
  await office.waitForFunction(() => (window as DebugWindow).__studentOffice?.ready());
  await expect(office.locator(`.student-office-card[data-course-id="${course.id}"]`)).toContainText('Đã lưu câu trả lời');
  await expect.poll(async () => (await inspect(office, course.id))?.history).toEqual([]);
  expect((await inspect(office, course.id))!.anim).toBe('idle');
  await office.screenshot({ path: test.info().outputPath('student-tutor-pro-vi.png'), fullPage: true });
  expect(errors).toEqual([]);
});
