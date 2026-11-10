import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StudentError } from '../student/storage.mjs';

const run = promisify(execFile);
const script = fs.readFileSync(new URL('./windows-ocr.ps1', import.meta.url), 'utf8');

// Restore table rows: the recognizer otherwise emits an entire left column before the right column.
export function ocrLinesToText(lines) {
  const valid = lines.filter((line) => typeof line.text === 'string' && line.text.length < 10000 && [line.x, line.y, line.height].every(Number.isFinite));
  const rows = [];
  for (const line of valid.sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2)) {
    const center = line.y + line.height / 2;
    const row = rows.at(-1);
    if (row && Math.abs(row.center - center) < Math.min(row.height, line.height) * 0.6) row.lines.push(line);
    else rows.push({ center, height: line.height, lines: [line] });
  }
  return rows.map((row) => row.lines.sort((a, b) => a.x - b.x).map((line) => line.text.trim()).join(' | ')).join('\n').slice(0, 100000);
}

export async function recognizePdfPageWithMeta(page) {
  if (process.platform !== 'win32') throw new StudentError('ocrUnavailable', 503);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-ocr-'));
  try {
    const { createCanvas } = await import('@napi-rs/canvas');
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(original.width, original.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const filename = path.join(dir, 'page.png');
    fs.writeFileSync(filename, canvas.toBuffer('image/png'));
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      // No filename or document text is interpolated into shell code.
      env: { ...process.env, STUDENT_OCR_IMAGE: filename }, encoding: 'utf8',
    });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (!Array.isArray(result.lines)) throw new Error('Invalid OCR result');
    return {
      text: ocrLinesToText(result.lines),
      language: result.language || 'en-US',
      engine: 'Windows.Media.Ocr',
    };
  } catch (error) {
    if (error instanceof StudentError) throw error;
    throw new StudentError('ocrUnavailable', 503);
  } finally {
    // mkdtemp creates this exact child inside the system temp directory.
    if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('student-ocr-')) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function recognizePdfImage(page) {
  const result = await recognizePdfPageWithMeta(page);
  return result.text;
}
