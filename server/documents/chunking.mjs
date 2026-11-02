/**
 * Split page-aware text into chunks suitable for embedding and retrieval.
 *
 * Each chunk carries its source pageNumber and sequential chunkIndex within that page.
 * Target chunk size is configurable (defaults to ~500 tokens, ~15% overlap).
 */

const DEFAULT_TARGET_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 75;
const TOKEN_RATIO = 1.3; // ~1.3 tokens per whitespace-delimited word in English / multilingual mixed text

export function estimateTokens(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * TOKEN_RATIO));
}

/**
 * Split a single page's text into token-bounded chunks with overlap.
 *
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} options
 * @returns {{ pageNumber: number; page: number; chunkIndex: number; content: string; tokenCount: number }[]}
 */
function splitPage(text, pageNumber, targetWords, overlapWords) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  // If page text is within target, return a single chunk
  if (words.length <= targetWords) {
    const content = words.join(' ');
    return [{
      pageNumber,
      page: pageNumber,
      chunkIndex: 0,
      content,
      tokenCount: estimateTokens(content),
    }];
  }

  const chunks = [];
  const step = Math.max(1, targetWords - overlapWords);
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(start + targetWords, words.length);
    const content = words.slice(start, end).join(' ');
    chunks.push({
      pageNumber,
      page: pageNumber,
      chunkIndex,
      content,
      tokenCount: estimateTokens(content),
    });
    chunkIndex++;
    if (end >= words.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Create page-aware chunks from an array of extracted PDF pages.
 *
 * @param {{ pageNumber?: number; page?: number; text: string }[]} pages
 * @param {{ targetTokens?: number; overlapTokens?: number }} [options]
 * @returns {{ pageNumber: number; page: number; chunkIndex: number; content: string; tokenCount: number }[]}
 */
export function createChunks(pages, options = {}) {
  const targetTokens = options.targetTokens || DEFAULT_TARGET_TOKENS;
  const overlapTokens = options.overlapTokens || DEFAULT_OVERLAP_TOKENS;

  const targetWords = Math.max(10, Math.floor(targetTokens / TOKEN_RATIO));
  const overlapWords = Math.max(2, Math.floor(overlapTokens / TOKEN_RATIO));

  const allChunks = [];
  let prevPageTail = '';

  for (const pageItem of pages) {
    const pageNumber = Number(pageItem.pageNumber ?? pageItem.page ?? 1);
    const text = (pageItem.text || '').trim();
    if (!text) continue;

    const pageChunks = splitPage(text, pageNumber, targetWords, overlapWords);
    if (!pageChunks.length) continue;

    // If there was text on previous page, attach bounded overlap (at most 20% of previous page)
    if (prevPageTail && pageChunks.length > 0) {
      const prevWordsAll = prevPageTail.split(/\s+/).filter(Boolean);
      const allowedOverlap = Math.min(overlapWords, Math.max(2, Math.floor(prevWordsAll.length * 0.2)));
      const prevWords = prevWordsAll.slice(-allowedOverlap);
      if (prevWords.length > 0) {
        const first = pageChunks[0];
        first.content = prevWords.join(' ') + ' ' + first.content;
        first.tokenCount = estimateTokens(first.content);
      }
    }

    allChunks.push(...pageChunks);
    prevPageTail = text;
  }

  return allChunks;
}
