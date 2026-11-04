import { randomUUID } from 'node:crypto';
import { STUDENT_ACTIVITY_LIMITS as L, applyStudentEvent, createStudentActivityState, validStudentEvent } from '../../src/shared/office-events.js';

/** Ephemeral, bounded visualization state. It never writes academic records or replay logs. */
export function createStudentActivity({ now = Date.now, epoch = randomUUID() } = {}) {
  const state = createStudentActivityState(); state.epoch = epoch;
  const listeners = new Set(); let closed = false;
  function publish(meta, operation, status, count) {
    if (closed) return;
    const event = { version: 1, epoch, seq: state.seq + 1, eventId: randomUUID(), ...meta, operation, status, timestamp: now(), ...(Number.isInteger(count) && count >= 0 && count <= 100 && status === 'completed' && { count }) };
    if (!validStudentEvent(event) || !applyStudentEvent(state, event)) return;
    for (const listener of listeners) {
      try { Promise.resolve(listener(structuredClone(event))).catch(() => {}); } catch { /* Visualization cannot fail a chat turn. */ }
    }
  }
  function sweep() {
    for (const [id, row] of state.courses) {
      const age = now() - row.event.timestamp;
      const done = row.event.operation === 'turn' && row.event.status !== 'started';
      if (done && age > L.keepMs) state.courses.delete(id);
      else if (!done && age > L.activeMs) {
        const { courseId, courseName, requestId, turnId, attemptId, isMock } = row.event;
        publish({ courseId, courseName, requestId, turnId, attemptId, isMock }, 'turn', 'interrupted');
      }
    }
  }
  const timer = setInterval(sweep, 10000); timer.unref();
  return {
    begin(input) {
      sweep();
      // Construct a strict allow-list. The caller may contain private data; none is spread into the wire payload.
      const meta = { courseId: input.courseId, courseName: String(input.courseName).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120) || 'Course', requestId: input.requestId, turnId: input.turnId, attemptId: input.attemptId, isMock: !!input.isMock };
      publish(meta, 'turn', 'started');
      return (operation, status, count) => {
        if (state.courses.get(meta.courseId)?.event.attemptId !== meta.attemptId) return;
        publish(meta, operation, status, count);
      };
    },
    snapshot() { sweep(); return { version: 1, epoch, seq: state.seq, generatedAt: now(), courses: structuredClone([...state.courses.values()]) }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { closed = true; clearInterval(timer); listeners.clear(); state.courses.clear(); },
  };
}
