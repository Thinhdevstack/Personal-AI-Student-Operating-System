import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { StudentError } from '../student/storage.mjs';

let pdfjsLib;

async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const require = createRequire(import.meta.url);
  const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib = await import(pathToFileURL(pdfjsPath).href);
  return pdfjsLib;
}

/**
 * Extract text per page from a PDF file on disk.
 *
 * @param {string | Uint8Array | Buffer} input Absolute file path or raw PDF bytes.
 * @returns {Promise<{ pageCount: number; pages: { pageNumber: number; page: number; text: string }[] }>}
 */
export async function extractPdf(input) {
  const pdfjs = await loadPdfjs();
  let data;
  if (typeof input === 'string') {
    try {
      data = new Uint8Array(fs.readFileSync(input));
    } catch (err) {
      if (err.code === 'ENOENT') throw new StudentError('fileMissing', 404);
      throw new StudentError('corruptedPdf', 422);
    }
  } else if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    data = new Uint8Array(input);
  } else {
    throw new StudentError('invalidInput', 400);
  }

  let doc;
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
    });
    doc = await loadingTask.promise;
  } catch (err) {
    if (err?.name === 'PasswordException' || /password/i.test(err?.message || '')) {
      throw new StudentError('encryptedPdf', 422);
    }
    if (err?.name === 'InvalidPDFException' || /format|corrupt|stream|header/i.test(err?.message || '')) {
      throw new StudentError('corruptedPdf', 422);
    }
    throw new StudentError('corruptedPdf', 422);
  }

  try {
    const pageCount = doc.numPages;
    if (!pageCount || pageCount < 1) {
      throw new StudentError('noTextExtracted', 422);
    }

    const pages = [];
    let totalTextLength = 0;

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str === 'string') {
          text += item.str + (item.hasEOL ? '\n' : ' ');
        }
      }
      // Normalize whitespace while preserving paragraphs
      text = text.replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
      if (text) {
        totalTextLength += text.length;
        pages.push({ pageNumber: i, page: i, text });
      }
    }

    if (totalTextLength === 0 || pages.length === 0) {
      throw new StudentError('noTextExtracted', 422);
    }

    return { pageCount, pages };
  } finally {
    if (doc) {
      if (typeof doc.destroy === 'function') {
        await doc.destroy();
      } else if (typeof doc.cleanup === 'function') {
        await doc.cleanup();
      }
    }
  }
}

// Alias for compatibility with previous partial implementation
export const extractPages = extractPdf;
