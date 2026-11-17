// Lightweight document & link content extractor for academic chat assistance.
// Uses native Node.js fetch and built-in regex-based HTML text extraction.

const URL_REGEX = /https?:\/\/[^\s<>"'{}|\\^`]+/gi;

export function extractUrls(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(URL_REGEX) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;!?)]+$/, '')))];
}

function cleanHtmlToText(html) {
  if (!html) return '';
  return html
    // Remove scripts and styles
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove navigation, headers, footers
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    // Replace block tags with newlines
    .replace(/<(?:p|div|h[1-6]|li|tr|br)\b[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse excess spaces and newlines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export async function fetchDocContent(url) {
  try {
    let targetUrl = url;
    // Special handling for Google Docs
    const gDocMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (gDocMatch) {
      targetUrl = `https://docs.google.com/document/d/${gDocMatch[1]}/export?format=txt`;
    }

    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,text/plain,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok && gDocMatch && targetUrl !== url) {
      // Fallback to original URL if export failed
      return fetchDocContent(url);
    }

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();

    let text = '';
    if (contentType.includes('text/plain')) {
      text = raw.trim();
    } else {
      text = cleanHtmlToText(raw);
    }

    // Limit text to 6,000 characters to fit nicely in LLM prompt context
    return {
      url,
      text: text.slice(0, 6000),
      length: text.length,
    };
  } catch {
    return null;
  }
}

export async function extractLinksContext(text) {
  const urls = extractUrls(text);
  if (!urls.length) return { urls: [], contextText: '' };

  const fetched = await Promise.all(
    urls.slice(0, 2).map((u) => fetchDocContent(u))
  );

  const valid = fetched.filter(Boolean);
  if (!valid.length) return { urls, contextText: '' };

  const parts = valid.map((item, idx) => {
    return `--- [TÀI LIỆU THAM KHẢO TỪ LINK #${idx + 1}: ${item.url}] ---\n${item.text}\n--- [HẾT TÀI LIỆU LINK #${idx + 1}] ---`;
  });

  return {
    urls,
    contextText: parts.join('\n\n'),
  };
}
