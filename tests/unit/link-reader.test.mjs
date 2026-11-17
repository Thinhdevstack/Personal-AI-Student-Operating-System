import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls } from '../../server/documents/link-reader.mjs';

test('extractUrls detects HTTP and HTTPS urls correctly', () => {
  const text = 'Xem link này nhé: https://docs.google.com/document/d/12345/edit và http://example.com/info.html!';
  const urls = extractUrls(text);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], 'https://docs.google.com/document/d/12345/edit');
  assert.equal(urls[1], 'http://example.com/info.html');
});

test('extractUrls handles text without urls', () => {
  const text = 'Tính đóng gói trong OOP là gì thế trợ giảng?';
  const urls = extractUrls(text);
  assert.equal(urls.length, 0);
});
