// A tiny valid PDF fixture with real xref offsets, shared by API and browser tests.
export function studentPdf(pages = ['Aggregation and composition describe object relationships in OOP.']) {
  const font = 3 + pages.length, streamStart = font + 1;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [' + pages.map((_, i) => (i + 3) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>',
    ...pages.map((_, i) => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + font + ' 0 R >> >> /Contents ' + (streamStart + i) + ' 0 R >>'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.map((text) => {
      const stream = 'BT /F1 12 Tf 40 740 Td (' + text.replace(/[()\\]/g, '') + ') Tj ET\n';
      return '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream';
    }),
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(content);
  content += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n';
  content += offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  content += 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(content);
}
