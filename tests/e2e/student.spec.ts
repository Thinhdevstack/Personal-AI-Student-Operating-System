import { test, expect } from '@playwright/test';
import { studentPdf } from '../fixtures/student-pdf.mjs';

function createPdfBuffer(pagesText: string[]): Buffer {
  let out = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const pageCount = pagesText.length;
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');
  out += `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`;

  const fontObjId = 3 + pageCount;
  const contentStartId = fontObjId + 1;

  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i;
    const contentId = contentStartId + i;
    out += `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`;
  }

  out += `${fontObjId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  for (let i = 0; i < pageCount; i++) {
    const contentId = contentStartId + i;
    const cleanText = pagesText[i].replace(/[()\\\\]/g, '');
    const stream = `BT\n/F1 12 Tf\n100 700 Td\n(${cleanText}) Tj\nET\n`;
    out += `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`;
  }

  out += `xref\n0 ${contentStartId + pageCount}\n0000000000 65535 f \n`;
  out += `trailer\n<< /Size ${contentStartId + pageCount} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(out)}\n%%EOF\n`;
  return Buffer.from(out);
}

test('@smoke student semester, course, PDF and archive survive reload', async ({ page }) => {
  const suffix = Date.now().toString();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  expect((await page.goto('/student'))?.status()).toBe(200);
  await page.getByRole('button', { name: '+ Create semester', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(`Semester ${suffix}`);
  await dialog.getByLabel('Academic year').fill('2026–2027');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '+ Create course', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(`OOP ${suffix}`);
  await dialog.getByLabel('Course code').fill('OOP');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByLabel('Add PDF', { exact: true }).setInputFiles({ name: 'Exception.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n') });
  await expect(page.getByText('Exception.pdf', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Exception.pdf', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('student-desktop.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Delete empty course' })).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('Exception.pdf');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText('Archived workspace.', { exact: false })).toBeVisible();
  await expect(page.getByText('Exception.pdf', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.student-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('student-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('@smoke student document processing and semantic retrieval flow', async ({ page }) => {
  const suffix = Date.now().toString();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  expect((await page.goto('/student'))?.status()).toBe(200);

  // 1. Create semester
  await page.getByRole('button', { name: '+ Create semester', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(`HK ${suffix}`);
  await dialog.getByLabel('Academic year').fill('2026–2027');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // 2. Create OOP course
  await page.getByRole('button', { name: '+ Create course', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(`OOP ${suffix}`);
  await dialog.getByLabel('Course code').fill('CS102');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // 3. Navigate to Materials
  await page.getByRole('button', { name: 'Materials', exact: true }).click();

  // 4. Upload valid PDF with text
  const pdfBytes = createPdfBuffer([
    'Aggregation and composition in Object Oriented Programming Java.',
    'Inheritance and polymorphism are fundamental object concepts.',
  ]);
  await page.getByLabel('Add PDF', { exact: true }).setInputFiles({
    name: 'ObjectRelation.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });

  await expect(page.getByText('ObjectRelation.pdf', { exact: true })).toBeVisible();

  // 5. Wait for processing to complete and reach 'Ready'
  await expect(page.getByText('Ready', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('2 pages', { exact: false })).toBeVisible();

  // 6. Search for aggregation composition
  await page.getByPlaceholder('e.g. aggregation and composition').fill('aggregation composition');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  // 7. Verify expected document and page returned
  await expect(page.getByText('Search results')).toBeVisible();
  await expect(page.getByText('ObjectRelation.pdf — Page 1', { exact: false })).toBeVisible();

  // 8. Reload and check persistence
  await page.reload();
  await expect(page.getByText('ObjectRelation.pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('Ready', { exact: false })).toBeVisible();

  // 9. Search again after reload
  await page.getByPlaceholder('e.g. aggregation and composition').fill('inheritance polymorphism');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('ObjectRelation.pdf — Page 2', { exact: false })).toBeVisible();

  expect(errors).toEqual([]);
});

test('@smoke course tutor uses scoped sources, persists history, retries and works on mobile', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const semester = await (await request.post('/api/student/semesters', { data: { name: 'Tutor semester', academicYear: '2026–2027' } })).json();
  const createCourse = async (name: string) => (await request.post('/api/student/courses', { data: { semesterId: semester.id, name } })).json();
  const course = await createCourse('OOP Tutor');
  const other = await createCourse('Database Tutor');
  const upload = await request.post(`/api/student/courses/${course.id}/materials?filename=ObjectRelation.pdf`, { headers: { 'Content-Type': 'application/pdf' }, data: studentPdf() });
  const doc = await upload.json();
  expect((await request.post(`/api/student/documents/${doc.id}/process?sync=true`)).ok()).toBe(true);
  await page.goto(`/student?course=${course.id}&tab=chat`);
  await expect(page.getByRole('heading', { name: 'Course Tutor', exact: true })).toBeVisible();
  await expect(page.getByText('Offline test mode', { exact: false })).toBeVisible();
  const input = page.getByLabel('Your question', { exact: true });
  await input.fill('Explain aggregation and composition');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const answers = page.locator('.student-chat-assistant');
  await expect(answers).toHaveCount(1);
  await expect(answers.getByRole('link', { name: 'ObjectRelation.pdf · Page 1' })).toBeVisible();
  await expect(answers).toContainText('Based on retrieved course excerpts');
  const download = page.waitForEvent('download');
  await answers.getByRole('link').click();
  expect((await download).suggestedFilename()).toBe('ObjectRelation.pdf');
  await page.reload();
  await expect(answers).toHaveCount(1);
  await input.fill('Give another example');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(answers).toHaveCount(2);
  // Lose one HTTP response before the server sees it, then retry with the same request ID.
  await page.route('**/api/student/chat', (route) => route.abort('failed'), { times: 1 });
  await input.fill('Explain composition once more');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.course-chat').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry this question', exact: true }).click();
  await expect(answers).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.student-chat-user')).toHaveCount(3);
  // The server completes the next question, but its response never reaches the page.
  await page.route('**/api/student/chat', async (route) => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await input.fill('What is aggregation?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(answers).toHaveCount(4);
  await expect(page.locator('.student-chat-user')).toHaveCount(4);
  await expect(page.locator('.course-chat').getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('course-chat-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await answers.last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('course-chat-mobile.png'), fullPage: true });
  await page.goto(`/student?course=${other.id}&tab=chat&lang=vi`);
  await expect(page.getByRole('heading', { name: 'Trợ giảng môn học', exact: true })).toBeVisible();
  await expect(page.locator('.student-chat-user')).toHaveCount(0);
  await expect(page.getByText('Thêm và xử lý PDF', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('@smoke memory is explicit, scoped, persistent and reflected in tutor context snapshots', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const semester = await (await request.post('/api/student/semesters', { data: { name: 'Memory semester', academicYear: '2026' } })).json();
  const createCourse = async (name: string) => (await request.post('/api/student/courses', { data: { semesterId: semester.id, name } })).json();
  const course = await createCourse('Memory OOP'), other = await createCourse('Memory Database');
  for (const item of [course, other]) {
    const doc = await (await request.post(`/api/student/courses/${item.id}/materials?filename=MemoryLecture.pdf`, { headers: { 'Content-Type': 'application/pdf' }, data: studentPdf() })).json();
    expect((await request.post(`/api/student/documents/${doc.id}/process?sync=true`)).ok()).toBe(true);
  }
  const memories = async (scope: string, id?: string) => (await request.get(`/api/student/memories?scope=${scope}${id ? `&courseId=${id}` : ''}`)).json();
  await page.goto('/student?view=memory');
  await page.getByRole('button', { name: '+ Add memory', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Memory content', { exact: true }).fill('Use brief examples.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.student-memory-list')).toContainText('Use brief examples.');

  await page.goto(`/student?course=${course.id}&tab=memory`);
  await page.getByRole('button', { name: '+ Add memory', exact: true }).click();
  await dialog.getByLabel('Memory content', { exact: true }).fill('Composition is difficult for me.');
  // Persist the save but lose its response. Retrying must keep the original request ID.
  await page.route('**/api/student/memories', async (route) => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await memories('course', course.id)).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Delete empty course', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const ask = async (question: string) => {
    await expect(page.getByLabel('Your question', { exact: true })).toBeVisible();
    const count = await page.locator('.student-chat-assistant').count();
    await page.getByLabel('Your question', { exact: true }).fill(question);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.student-chat-assistant')).toHaveCount(count + 1);
  };
  await ask('Explain aggregation and composition');
  const answers = page.locator('.student-chat-assistant');
  await answers.last().getByText('Memory shared with the tutor', { exact: false }).click();
  await expect(answers.last().locator('.student-chat-memories')).toContainText('Composition is difficult for me.');
  await expect(answers.last().locator('.student-chat-memories')).toContainText('Use brief examples.');
  expect((await memories('course', course.id)).length, 'chat alone must not create notes').toBe(1);
  await page.reload();
  await expect(answers).toHaveCount(1);
  await answers.first().getByRole('button', { name: 'Save to memory', exact: true }).click();
  await expect(dialog.getByLabel('Save scope')).toHaveValue('course');
  await dialog.getByLabel('Memory content', { exact: true }).fill('Aggregation needs a diagram.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await memories('course', course.id)).length).toBe(2);
  expect((await memories('global')).length).toBe(1);

  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  const initial = page.locator('.student-memory-list > li').filter({ hasText: 'Composition is difficult for me.' });
  await initial.getByRole('button', { name: 'Edit memory', exact: true }).click();
  await dialog.getByLabel('Memory content', { exact: true }).fill('Composition now needs a small example.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await ask('Explain composition again');
  await answers.last().locator('summary').click();
  await expect(answers.last().locator('.student-chat-memories')).toContainText('Composition now needs a small example.');
  await answers.first().locator('summary').click();
  await expect(answers.first().locator('.student-chat-memories')).toContainText('Composition is difficult for me.');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.locator('.student-memory-list > li').first().getByRole('button', { name: 'Delete memory', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.student-memory-list > li')).toHaveCount(1 - i);
  }
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await ask('Explain composition after deleting the notes');
  await answers.last().locator('summary').click();
  await expect(answers.last().locator('.student-chat-memories')).not.toContainText('Composition now needs a small example.');
  await expect(answers.last().locator('.student-chat-memories li')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('memory-chat-desktop.png'), fullPage: true });

  await page.goto(`/student?course=${other.id}&tab=chat`);
  await ask('Explain composition for this course');
  await answers.last().locator('summary').click();
  await expect(answers.last().locator('.student-chat-memories li')).toHaveCount(1);
  await expect(answers.last().locator('.student-chat-memories')).toContainText('Use brief examples.');
  // Global save from chat requires an explicit scope change and keeps its source course.
  await answers.last().getByRole('button', { name: 'Save to memory', exact: true }).click();
  await expect(dialog.getByLabel('Save scope')).toHaveValue('course');
  await dialog.getByLabel('Save scope').selectOption('global');
  await dialog.getByLabel('Memory content', { exact: true }).fill('Ask a short check question.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const savedGlobal = (await memories('global')).find((note: { content: string }) => note.content === 'Ask a short check question.');
  expect(savedGlobal.sourceCourseId).toBe(other.id);
  expect((await memories('course', other.id)).length).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/student?view=memory&lang=vi');
  await expect(page.getByRole('heading', { name: 'Sở thích chung', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.student-memory-list > li')).toHaveCount(2);
  await page.locator('.memory-workspace').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('memory-mobile-vi.png'), fullPage: true });
  await page.locator('.student-memory-list > li').first().getByRole('button', { name: 'Sửa bộ nhớ', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('memory-editor-mobile-vi.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  expect(errors).toEqual([]);
});
