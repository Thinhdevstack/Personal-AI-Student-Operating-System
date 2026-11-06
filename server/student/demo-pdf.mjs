// Small, downloadable teaching PDFs with extractable ASCII text; no network or external asset dependency.
export function demoPdf(lines) {
  // Courier at 12pt is 7.2pt per character: 72 columns fit inside the 532pt text area.
  // Text outside a PDF page can be discarded by extractors, so never let sample lines overflow.
  const wrapped = lines.flatMap((line) => {
    let text = line.replace(/[^\x20-\x7e]/g, ' ').trim();
    const result = [];
    while (text.length > 72) {
      const space = text.lastIndexOf(' ', 72), cut = space > 0 ? space : 72;
      result.push(text.slice(0, cut)); text = text.slice(cut).trimStart();
    }
    result.push(text); return result;
  });
  if (wrapped.length > 40) throw new Error('Teaching PDF exceeds one page');
  const escaped = wrapped.map((line) => line.replace(/[\\()]/g, '\\$&'));
  const stream = 'BT /F1 12 Tf 40 740 Td 18 TL ' + escaped.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n') + '\nET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(text + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
