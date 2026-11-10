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
export async function extractPdf(input, { ocr, onOcr, forceOcrPages = [], extractorVersion = 'b4-v1' } = {}) {
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
    const pageDiagnostics = [];
    let totalTextLength = 0;
    let lastOcrError = null;
    const forceSet = new Set(Array.isArray(forceOcrPages) ? forceOcrPages.map(Number) : []);

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let nativeText = '';
      for (const item of content.items) {
        if (typeof item.str === 'string') {
          nativeText += item.str + (item.hasEOL ? '\n' : ' ');
        }
      }
      nativeText = nativeText.replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

      const shouldForceOcr = forceSet.has(i);
      let hasImage = false;
      let ocrRan = false;
      let ocrSuccess = false;
      let ocrFailed = false;
      let ocrText = '';
      let ocrLanguage = null;
      let ocrEngine = null;

      if (ocr) {
        if (shouldForceOcr) {
          hasImage = true;
        } else if (nativeText.length < 250) {
          const operators = await page.getOperatorList();
          const imageOps = [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageXObjectRepeat];
          hasImage = operators.fnArray.some((op) => imageOps.includes(op));
        }

        if (hasImage) {
          ocrRan = true;
          onOcr?.(i, pageCount);
          try {
            const rawOcr = await ocr(page);
            if (rawOcr && typeof rawOcr === 'object') {
              ocrText = String(rawOcr.text || '').trim();
              ocrLanguage = rawOcr.language || null;
              ocrEngine = rawOcr.engine || 'Windows.Media.Ocr';
            } else if (typeof rawOcr === 'string') {
              ocrText = rawOcr.trim();
              ocrEngine = 'Windows.Media.Ocr';
            }
            ocrSuccess = true;
          } catch (err) {
            console.warn(`[OCR Warning] Page ${i}/${pageCount} OCR failed:`, err?.message || err);
            ocrFailed = true;
            lastOcrError = err;
          }
        }
      }

      let finalText = nativeText;
      let method = nativeText.length > 0 ? 'native' : 'none';
      let status = nativeText.length > 0 ? 'extracted' : 'empty';
      let warningCode = null;

      if (ocrRan) {
        if (ocrSuccess && ocrText.length > 0) {
          method = nativeText.length > 0 ? 'combined' : 'ocr';
          status = 'ocr_applied';
          finalText = [nativeText, '[OCR: text recognized from page image; may contain errors]', ocrText].filter(Boolean).join('\n');
        } else if (ocrFailed) {
          status = 'ocr_failed';
          warningCode = 'ocrPageFailed';
        }
      }

      if (finalText.length === 0) {
        method = 'none';
        if (status !== 'ocr_failed') status = 'empty';
        if (!warningCode) warningCode = 'emptyPage';
      }

      pageDiagnostics.push({
        pageNumber: i,
        method,
        status,
        charCount: finalText.length,
        warningCode,
        ocrLanguage,
        ocrEngine,
      });

      if (finalText.length > 0) {
        totalTextLength += finalText.length;
        pages.push({ pageNumber: i, page: i, text: finalText });
      }
    }

    if (totalTextLength === 0 || pages.length === 0) {
      if (lastOcrError) throw lastOcrError;
      throw new StudentError('noTextExtracted', 422);
    }

    const pagesWithText = pageDiagnostics.filter((p) => p.charCount > 0).length;
    const pagesOcr = pageDiagnostics.filter((p) => ['ocr', 'combined'].includes(p.method) || p.status === 'ocr_applied').length;
    const pagesWarning = pageDiagnostics.filter((p) => p.warningCode !== null).length;

    let coverageStatus = 'full';
    if (pagesWarning > 0 || pagesWithText < pageCount) {
      coverageStatus = 'partial';
    } else if (pagesOcr > 0) {
      coverageStatus = 'ocr_fallback';
    }

    const coverage = {
      extractorVersion,
      pagesWithText,
      pagesOcr,
      pagesWarning,
      coverageStatus,
    };

    return { pageCount, pages, pageDiagnostics, coverage };
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
