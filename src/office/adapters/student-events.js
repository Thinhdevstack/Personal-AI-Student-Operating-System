// Student lifecycle state to bounded visual actors; no Claude session or academic business logic.
import { STUDENT_ACTIVITY_LIMITS as L, applyStudentEvent, applyStudentSnapshot, createStudentActivityState } from '../../shared/office-events.js';

export function createStudentOfficeAdapter({ createActor, now = Date.now }) {
  const state = createStudentActivityState(), actors = new Map();
  let connected = false, resync = true;
  const terminal = (row) => row.event.operation === 'turn' && row.event.status !== 'started';
  function clear() { for (const item of actors.values()) item.actor.dispose(); actors.clear(); }
  function status(row) {
    if (terminal(row)) return row.event.status;
    return !connected || resync || now() - row.event.timestamp > L.clientMs ? 'unknown' : 'busy';
  }
  function reconcile() {
    const visible = [...state.courses.values()].filter((row) => now() - row.event.timestamp <= (terminal(row) ? L.keepMs : L.clientMs + L.keepMs)).sort((a, b) => b.event.seq - a.event.seq).slice(0, L.actors);
    const ids = new Set(visible.map((row) => row.event.courseId));
    for (const [id, item] of actors) if (!ids.has(id)) { item.actor.dispose(); actors.delete(id); }
    for (const row of visible) {
      let item = actors.get(row.event.courseId);
      if (!item) {
        const actor = createActor(row.event); if (!actor) continue;
        item = { actor, row, queue: [], current: null, until: 0 }; actors.set(row.event.courseId, item);
      }
      item.row = row;
      item.actor.status(row, status(row));
    }
  }
  function rest(item) { item.queue = []; item.current = null; item.actor.rest(); }
  function playNext(item) {
    const operation = item.queue.shift();
    if (!operation) { item.current = null; if (terminal(item.row)) item.actor.rest(); return; }
    item.current = { operation, startedAt: now(), arrivedAt: null };
    item.actor.play(operation);
  }
  return {
    snapshot(snapshot) {
      const oldEpoch = state.epoch;
      if (!applyStudentSnapshot(state, snapshot)) return false;
      if (oldEpoch !== state.epoch) clear();
      resync = false; connected = true; reconcile();
      // Restore current state only. A snapshot never queues completed historical phases.
      for (const item of actors.values()) {
        rest(item);
        if (!terminal(item.row) && status(item.row) === 'busy' && item.row.event.operation !== 'turn' && item.row.event.status === 'started') {
          item.until = now() + L.animationMs; item.queue = [item.row.event.operation]; playNext(item);
        }
      }
      return true;
    },
    event(event) {
      if (!applyStudentEvent(state, event)) return false;
      reconcile();
      const item = actors.get(event.courseId); if (!item) return true;
      if (event.operation === 'turn' && event.status === 'started') { rest(item); item.until = now() + L.animationMs; }
      else if (event.status === 'started' && connected && !resync) {
        if (item.queue.length < 3 && item.current?.operation !== event.operation && !item.queue.includes(event.operation)) item.queue.push(event.operation);
        if (!item.current) playNext(item);
      } else if (event.operation === 'turn' && event.status !== 'completed') rest(item);
      return true;
    },
    connection(on) {
      connected = on;
      if (!on) { resync = true; for (const item of actors.values()) rest(item); }
      reconcile();
    },
    tick() {
      reconcile();
      for (const item of actors.values()) {
        if (status(item.row) === 'unknown' || (item.current && now() > item.until)) { rest(item); continue; }
        if (!item.current) continue;
        if (!item.actor.arrived() && now() - item.current.startedAt >= L.travelMs) item.actor.settle?.();
        if (item.actor.arrived()) {
          item.current.arrivedAt ??= now();
          if (now() - item.current.arrivedAt >= 650 && (item.queue.length || terminal(item.row))) playNext(item);
        }
      }
    },
    inspect() { return [...actors.values()].map((item) => ({ courseId: item.row.event.courseId, attemptId: item.row.event.attemptId, status: status(item.row), operation: item.row.event.operation, current: item.current?.operation || null, queued: [...item.queue], ...item.actor.inspect?.() })); },
    ready() { return !!state.epoch && connected && !resync; },
    dispose() { clear(); state.courses.clear(); },
  };
}
