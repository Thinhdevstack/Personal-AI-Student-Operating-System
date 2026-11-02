import { test, expect } from '@playwright/test';

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
