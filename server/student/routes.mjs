import fs from 'node:fs';
import { MAX_PDF_BYTES, StudentError } from './storage.mjs';

const send = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));

// Unlike the legacy JSON reader, this stops retaining bytes at the limit, including chunked requests.
function readBytes(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    const fail = (error) => { if (!done) { done = true; chunks.length = 0; reject(error); } };
    if (Number(req.headers['content-length']) > limit) { fail(new StudentError('fileTooLarge', 413)); req.resume(); return; }
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) fail(new StudentError('fileTooLarge', 413));
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('aborted', () => fail(new StudentError('uploadInterrupted')));
    req.on('error', fail);
  });
}
async function readObject(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new StudentError('invalidInput', 415);
  const bytes = await readBytes(req, 16_384);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch { throw new StudentError('invalidInput'); }
}

export function createStudentRoutes({ service, authorized, sameOrigin }) {
  let uploads = 0;
  return async function studentRoutes(req, res, url) {
    try {
      if (!authorized(req, url)) throw new StudentError('unauthorized', 401);
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) throw new StudentError('forbidden', 403);
      const parts = url.pathname.split('/').filter(Boolean).slice(2);
      const [kind, id, child] = parts;
      if (req.method === 'GET' && parts.length === 1 && kind === 'snapshot') return send(res, 200, service.snapshot());
      if (parts.length === 1 && kind === 'chat' && req.method === 'POST') return send(res, 200, await service.sendChat(await readObject(req)));
      if (parts.length === 3 && kind === 'courses' && child === 'chat' && req.method === 'GET') return send(res, 200, service.chatHistory(id, url.searchParams.get('conversationId')));
      if (parts.length === 1 && req.method === 'POST') {
        if (kind === 'semesters') return send(res, 201, service.createSemester(await readObject(req)));
        if (kind === 'courses') return send(res, 201, service.createCourse(await readObject(req)));
      }
      if (parts.length === 2 && req.method === 'PATCH') {
        if (kind === 'semesters') return send(res, 200, service.updateSemester(id, await readObject(req)));
        if (kind === 'courses') return send(res, 200, service.updateCourse(id, await readObject(req)));
      }
      if (parts.length === 2 && kind === 'courses' && req.method === 'DELETE') { service.deleteCourse(id); return send(res, 200, { ok: true }); }
      if (parts.length === 3 && kind === 'courses' && child === 'materials') {
        if (req.method === 'GET') return send(res, 200, service.materials(id));
        if (req.method === 'POST') {
          service.writableCourse(id);
          if (req.headers['content-type'] !== 'application/pdf') throw new StudentError('invalidFile', 415);
          if (uploads >= 2) throw new StudentError('busy', 429);
          uploads++;
          try {
            const bytes = await readBytes(req, MAX_PDF_BYTES);
            return send(res, 201, service.addMaterial(id, bytes, url.searchParams.get('filename'), 'application/pdf'));
          } finally { uploads--; }
        }
      }
      if (parts.length === 3 && kind === 'courses' && child === 'search') {
        let query, limit, includeArchived;
        if (req.method === 'POST') {
          const body = await readObject(req);
          query = body.query;
          limit = body.limit;
          if (body.includeArchived !== undefined && typeof body.includeArchived !== 'boolean') throw new StudentError('invalidInput');
          includeArchived = body.includeArchived === true;
        } else if (req.method === 'GET') {
          query = url.searchParams.get('query') || url.searchParams.get('q');
          limit = url.searchParams.get('limit');
          includeArchived = url.searchParams.get('includeArchived') === 'true';
        } else {
          throw new StudentError('notFound', 404);
        }
        const results = await service.search(id, query, limit, includeArchived);
        return send(res, 200, results);
      }
      if (parts.length === 3 && kind === 'documents' && child === 'process' && req.method === 'POST') {
        const sync = url.searchParams.get('sync') === 'true';
        if (sync) {
          const doc = await service.processDocument(id);
          return send(res, 200, { ok: true, document: doc });
        }
        // Async processing
        void service.processDocument(id).catch((err) => {
          console.error(`Document ${id} processing failed:`, err);
        });
        return send(res, 202, { id, status: 'processing' });
      }
      if (parts.length === 3 && kind === 'documents' && child === 'chunks' && req.method === 'GET') {
        return send(res, 200, { chunks: service.documentChunks(id) });
      }
      if (parts.length === 3 && kind === 'documents' && child === 'file' && ['GET', 'HEAD'].includes(req.method)) {
        const file = service.file(id);
        // Open before sending headers so missing storage gets a meaningful HTTP error.
        let handle;
        try { handle = await fs.promises.open(file.path, 'r'); }
        catch (error) { if (error.code === 'ENOENT') throw new StudentError('fileMissing', 404); throw error; }
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': file.document.sizeBytes, 'Content-Disposition': `attachment; filename="source.pdf"; filename*=UTF-8''${encodeURIComponent(file.document.originalFilename).replace(/'/g, '%27')}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox; default-src 'none'" });
        if (req.method === 'HEAD') { await handle.close(); return res.end(); }
        const stream = handle.createReadStream();
        stream.on('error', (error) => { console.error('student download', error); res.destroy(); });
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }
      throw new StudentError('notFound', 404);
    } catch (error) {
      if (!(error instanceof StudentError)) console.error('student API: internal failure');
      if (!res.headersSent) send(res, error.status || 500, { error: error instanceof StudentError ? error.code : 'serverError' });
      else res.destroy();
      req.resume();
    }
  };
}
