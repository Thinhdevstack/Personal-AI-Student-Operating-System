import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { extractPdf } from '../../server/documents/pdf.mjs';
import { ocrLinesToText, recognizePdfImage } from '../../server/documents/ocr.mjs';

async function imagePdf() {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(1000, 180), context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 1000, 180);
  context.fillStyle = 'black'; context.font = '42px Arial';
  context.fillText('WSClock Working set Clock', 30, 70);
  context.fillText('LRU Least Recently Used', 30, 135);
  const pixels = context.getImageData(0, 0, 1000, 180).data;
  const rgb = Buffer.alloc(1000 * 180 * 3);
  for (let i = 0, j = 0; i < pixels.length; i += 4) { rgb[j++] = pixels[i]; rgb[j++] = pixels[i + 1]; rgb[j++] = pixels[i + 2]; }
  const compressed = deflateSync(rgb);
  const stream = 'q 540 0 0 98 30 500 cm /Im1 Do Q\n';
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`), compressed, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`),
  ];
  let bytes = Buffer.from('%PDF-1.4\n'); const offsets = [0];
  objects.forEach((object, i) => { offsets.push(bytes.length); bytes = Buffer.concat([bytes, Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); });
  const xref = bytes.length;
  return Buffer.concat([bytes, Buffer.from('xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
}

test('OCR reconstructs table rows across columns and rejects malformed line coordinates', () => {
  assert.equal(ocrLinesToText([
    { text: 'LRU', x: 0, y: 20, height: 12 }, { text: 'WSClock', x: 0, y: 40, height: 12 },
    { text: 'Least recently used', x: 200, y: 20, height: 12 }, { text: 'Working set Clock', x: 200, y: 41, height: 12 },
    { text: 'invalid', x: NaN, y: 0, height: 12 },
  ]), 'LRU | Least recently used\nWSClock | Working set Clock');
});

test('image-only PDFs request OCR, retain original page numbers and make recognized text searchable', async () => {
  const bytes = await imagePdf();
  await assert.rejects(extractPdf(bytes), /noTextExtracted/);
  const progress = [];
  const result = await extractPdf(bytes, { ocr: async () => 'WSClock Working set Clock', onOcr: (...args) => progress.push(args) });
  assert.equal(result.pageCount, 1); assert.equal(result.pages[0].pageNumber, 1);
  assert.match(result.pages[0].text, /OCR.*may contain errors/);
  assert.match(result.pages[0].text, /WSClock/);
  assert.deepEqual(progress, [[1, 1]]);
  await assert.rejects(extractPdf(bytes, { ocr: async () => { throw new Error('ocrUnavailable'); } }), /ocrUnavailable/);
});

test('real Windows OCR reads the raster PDF without a vision model or paid API', { skip: process.platform !== 'win32' || process.env.STUDENT_REAL_OCR !== '1' }, async () => {
  const result = await extractPdf(await imagePdf(), { ocr: recognizePdfImage });
  assert.match(result.pages[0].text, /WSClock/i);
  assert.match(result.pages[0].text, /Recently Used/i);
});
