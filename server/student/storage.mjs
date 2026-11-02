import fs from 'node:fs';
import path from 'node:path';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export class StudentError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function validatePdf(bytes, filename, mimeType) {
  if (typeof filename !== 'string' || filename.length > 240) throw new StudentError('invalidFile');
  // Names are display metadata only. Both slash styles are handled regardless of the host OS.
  const name = filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim();
  if (!name || !/\.pdf$/i.test(name) || mimeType !== 'application/pdf') throw new StudentError('invalidFile', 415);
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new StudentError('fileTooLarge', 413);
  if (!/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('ascii')) || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) throw new StudentError('invalidFile', 415);
  return name;
}

export function documentStorage(dir) {
  const root = path.resolve(dir, 'documents');
  function location(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new StudentError('notFound', 404);
    return path.join(root, id, 'source.pdf');
  }
  return {
    write(id, bytes) {
      const file = location(id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
      catch (error) { fs.rmSync(path.dirname(file), { recursive: true, force: true }); throw error; }
      return `documents/${id}/source.pdf`;
    },
    remove(id) { fs.rmSync(path.dirname(location(id)), { recursive: true, force: true }); },
    location,
  };
}
