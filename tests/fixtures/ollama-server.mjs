// Protocol fixture only: never use this server as real model inference.
import http from 'node:http';
import { createMockAIProvider } from '../../server/ai/openai.mjs';
if (process.env.STUDENT_OLLAMA_FIXTURE !== '1') throw new Error('Test fixture requires explicit opt-in');
const embedding = createMockAIProvider();
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:4b' }, { name: 'embeddinggemma:latest' }] }));
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (req.url === '/api/embed') return res.end(JSON.stringify({ embeddings: await embedding.embed(body.input) }));
  const payload = JSON.parse(body.messages.at(-1).content);
  const respond = () => {
    if (res.destroyed) return;
    const source = payload.sources[0];
    const general = payload.question.includes('outside');
    res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify({ answer: 'Ollama protocol fixture: ' + (general ? 'General explanation' : source?.content || 'General explanation'), additionalKnowledge: '', basis: source && !general ? 'materials' : 'general', sourceIds: source && !general ? [source.sourceId] : [] }) } }));
  };
  if (payload.question.includes('Cancel')) {
    const timer = setTimeout(respond, 40000);
    res.on('close', () => clearTimeout(timer));
  } else respond();
});
server.listen(Number(process.env.OLLAMA_FIXTURE_PORT) || 4405, '127.0.0.1', () => console.log('Ollama HTTP fixture ready'));
