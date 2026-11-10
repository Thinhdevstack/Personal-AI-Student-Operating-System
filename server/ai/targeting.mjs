import { StudentError } from '../student/storage.mjs';

function stripAccents(str) {
  return str.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

/**
 * Resolves a specific document and page target from an explicit selection or from natural language mentions
 * (e.g., "giải thích chương 5 trang 37", "slide 12", "page 4").
 */
export function resolveSourceTarget({ db, courseId, message, explicitTarget, lang = 'vi' }) {
  if (typeof message !== 'string') return null;

  const docs = db.prepare("SELECT * FROM documents WHERE courseId = ? AND status = 'ready' ORDER BY uploadedAt ASC").all(courseId);
  if (!docs.length) return null;

  let targetDoc = null;
  let targetPage = null;

  // 1. Explicit target from UI
  if (explicitTarget?.documentId) {
    targetDoc = docs.find((d) => d.id === explicitTarget.documentId);
    if (!targetDoc) throw new StudentError('notFound', 404);
  }
  if (Number.isInteger(explicitTarget?.pageNumber) && explicitTarget.pageNumber > 0) {
    targetPage = explicitTarget.pageNumber;
  }

  // 2. Parse from message text
  if (!targetPage) {
    const pageMatch = message.match(/(?:trang|slide|page|p\.)\s*(\d{1,4})\b/i);
    if (pageMatch) {
      targetPage = parseInt(pageMatch[1], 10);
    }
  }

  if (!targetDoc) {
    const chapterMatch = message.match(/(?:chương|chuong|chapter|chap|bài|bai)\s*(\d{1,3})\b/i);
    if (chapterMatch) {
      const chapterNum = parseInt(chapterMatch[1], 10);
      const chapterPattern = new RegExp(`(?:chuong|chapter|chap|bai)[-_ ]*0*${chapterNum}(?:[^a-zA-Z0-9]|$)`, 'i');
      const matched = docs.filter((d) => chapterPattern.test(stripAccents(d.originalFilename || d.filename)));
      if (matched.length === 1) {
        targetDoc = matched[0];
      } else if (matched.length > 1) {
        return {
          ambiguous: true,
          matchedDocs: matched.map((d) => ({ id: d.id, name: d.originalFilename })),
          explanation: lang === 'vi'
            ? `Tìm thấy nhiều tài liệu phù hợp cho chương/bài ${chapterNum} (${matched.map((d) => d.originalFilename).join(', ')}). Vui lòng chọn tài liệu cụ thể.`
            : `Multiple materials found for chapter ${chapterNum} (${matched.map((d) => d.originalFilename).join(', ')}). Please select a specific material.`,
        };
      }
    }
    // If there is only one document in the course and user specified a page, bind to it
    if (!targetDoc && targetPage && docs.length === 1) {
      targetDoc = docs[0];
    }
  }

  if (!targetDoc || !targetPage) {
    if (targetDoc) {
      return { targetDoc, targetPage: null };
    }
    return null;
  }

  const target = {
    documentId: targetDoc.id,
    documentName: targetDoc.originalFilename,
    pageNumber: targetPage,
  };

  // 3. Validate target page bounds
  if (targetDoc.pageCount && targetPage > targetDoc.pageCount) {
    return {
      target,
      valid: false,
      reason: 'pageOutOfRange',
      explanation: lang === 'vi'
        ? `Trang ${targetPage} vượt quá tổng số trang (${targetDoc.pageCount}) của tài liệu "${targetDoc.originalFilename}".`
        : `Page ${targetPage} exceeds the total page count (${targetDoc.pageCount}) of "${targetDoc.originalFilename}".`,
    };
  }

  // 4. Validate per-page diagnostic status if available
  const pageDiag = db.prepare('SELECT * FROM document_pages WHERE documentId = ? AND pageNumber = ?').get(targetDoc.id, targetPage);
  if (pageDiag) {
    if (pageDiag.status === 'ocr_failed') {
      return {
        target,
        valid: false,
        reason: 'ocrFailed',
        explanation: lang === 'vi'
          ? `Trang ${targetPage} của tài liệu "${targetDoc.originalFilename}" bị lỗi khi đọc ảnh OCR. Bạn có thể mở chi tiết tài liệu để đọc lại trang này.`
          : `Page ${targetPage} of "${targetDoc.originalFilename}" failed OCR extraction. Open material details to retry this page.`,
      };
    }
    if (pageDiag.status === 'empty' || pageDiag.charCount === 0) {
      return {
        target,
        valid: false,
        reason: 'emptyPage',
        explanation: lang === 'vi'
          ? `Trang ${targetPage} của tài liệu "${targetDoc.originalFilename}" không có chữ nào (trang trống hoặc chỉ có hình chưa OCR).`
          : `Page ${targetPage} of "${targetDoc.originalFilename}" contains no extractable text.`,
      };
    }
  }

  // 5. Query chunks on this page
  const pageChunks = db.prepare(`
    SELECT c.id AS chunkId, c.documentId, c.pageNumber, c.chunkIndex, c.content, d.originalFilename AS documentName, 1.0 AS score
    FROM document_chunks c
    JOIN documents d ON d.id = c.documentId
    WHERE c.documentId = ? AND c.pageNumber = ?
    ORDER BY c.chunkIndex ASC
  `).all(targetDoc.id, targetPage);

  if (!pageChunks.length) {
    return {
      target,
      valid: false,
      reason: 'noChunks',
      explanation: lang === 'vi'
        ? `Trang ${targetPage} của tài liệu "${targetDoc.originalFilename}" chưa có đoạn văn bản nào được lập chỉ mục.`
        : `No text chunks indexed for page ${targetPage} of "${targetDoc.originalFilename}".`,
    };
  }

  return {
    target,
    valid: true,
    pageChunks,
    targetDoc,
  };
}
