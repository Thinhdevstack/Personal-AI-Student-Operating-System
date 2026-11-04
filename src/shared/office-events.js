// Student activity wire contract: metadata only, independent of Claude sessions and Three.js.
export const STUDENT_OPERATIONS = Object.freeze(['turn', 'library.search', 'memory.search', 'ai.respond']);
export const STUDENT_STATUSES = Object.freeze(['started', 'completed', 'failed', 'interrupted']);
export const STUDENT_ACTIVITY_LIMITS = Object.freeze({ courses: 32, actors: 4, activeMs: 120000, keepMs: 180000, clientMs: 150000, animationMs: 30000, travelMs: 8000 });
const uuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const keys = (o, allowed) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((key) => allowed.includes(key));
export function validStudentEvent(e) {
  return !!(keys(e, ['version', 'epoch', 'seq', 'eventId', 'courseId', 'courseName', 'requestId', 'turnId', 'attemptId', 'operation', 'status', 'timestamp', 'isMock', 'count']) && e.version === 1 && uuid(e.epoch) && uuid(e.eventId) && uuid(e.courseId) && uuid(e.requestId) && uuid(e.turnId) && uuid(e.attemptId) && integer(e.seq) && e.seq > 0 && integer(e.timestamp) && typeof e.courseName === 'string' && e.courseName.length > 0 && e.courseName.length <= 120 && !/[\x00-\x1f\x7f]/.test(e.courseName) && typeof e.isMock === 'boolean' && STUDENT_OPERATIONS.includes(e.operation) && STUDENT_STATUSES.includes(e.status) && (e.count === undefined || (integer(e.count) && e.count <= 100 && ['library.search', 'memory.search'].includes(e.operation) && e.status === 'completed')));
}
export function validStudentSnapshot(s) {
  return !!(keys(s, ['version', 'epoch', 'seq', 'generatedAt', 'courses']) && s.version === 1 && uuid(s.epoch) && integer(s.seq) && integer(s.generatedAt) && Array.isArray(s.courses) && s.courses.length <= STUDENT_ACTIVITY_LIMITS.courses && new Set(s.courses.map((row) => row?.event?.courseId)).size === s.courses.length && s.courses.every((row) => keys(row, ['event', 'steps']) && validStudentEvent(row.event) && row.event.epoch === s.epoch && row.event.seq <= s.seq && Array.isArray(row.steps) && row.steps.length <= 3 && new Set(row.steps.map((step) => step?.operation)).size === row.steps.length && row.steps.every((step) => keys(step, ['operation', 'status', 'count']) && STUDENT_OPERATIONS.slice(1).includes(step.operation) && STUDENT_STATUSES.includes(step.status) && (step.count === undefined || (integer(step.count) && step.count <= 100)))));
}

/** Pure client state; a server snapshot establishes the epoch, events never switch it. */
export function createStudentActivityState() { return { epoch: null, seq: 0, courses: new Map() }; }
export function applyStudentSnapshot(state, snapshot) {
  if (!validStudentSnapshot(snapshot)) return false;
  const sameEpoch = state.epoch === snapshot.epoch;
  if (sameEpoch && snapshot.seq < state.seq) return false;
  state.epoch = snapshot.epoch; state.seq = snapshot.seq;
  state.courses = new Map(snapshot.courses.map((row) => [row.event.courseId, structuredClone(row)]));
  return true;
}
export function applyStudentEvent(state, event) {
  if (!validStudentEvent(event) || state.epoch !== event.epoch) return false;
  const previous = state.courses.get(event.courseId);
  if (previous && (event.seq <= previous.event.seq || (event.attemptId !== previous.event.attemptId && !(event.operation === 'turn' && event.status === 'started')) || (event.attemptId === previous.event.attemptId && previous.event.operation === 'turn' && previous.event.status !== 'started'))) return false;
  let row = previous && previous.event.attemptId === event.attemptId ? structuredClone(previous) : { steps: [] };
  row.event = { ...event };
  if (event.operation !== 'turn') {
    row.steps = row.steps.filter((step) => step.operation !== event.operation);
    row.steps.push({ operation: event.operation, status: event.status, ...(event.count !== undefined && { count: event.count }) });
  }
  state.seq = Math.max(state.seq, event.seq);
  state.courses.delete(event.courseId); state.courses.set(event.courseId, row);
  while (state.courses.size > STUDENT_ACTIVITY_LIMITS.courses) state.courses.delete(state.courses.keys().next().value);
  return true;
}
