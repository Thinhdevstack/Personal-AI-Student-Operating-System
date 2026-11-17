// Student tutors reuse the permanent course desk workers in the office.
import { STATIC, STUDENT_LEARNING, el, replay } from '../core/env.js';
import { workers, sessions } from './workers.js';
import { t } from '../../i18n/index.js';
import { createStudentOfficeAdapter } from '../adapters/student-events.js';

const actors = new Map();
let adapter = null, panel = null, list = null, disposed = false;
const tr = (key, vars) => t('student.officeActivity.' + key, vars);
const enabled = () => !STATIC && (STUDENT_LEARNING || !new URLSearchParams(location.search).has('demo'));

function createActor(event) {
  const deskKey = 'course:' + event.courseId;
  const w = workers.get(deskKey);
  if (!w) return null; // Sử dụng duy nhất nhân vật chính tại bàn học, không tạo nhân vật phụ trùng lặp

  const card = el('li', 'student-office-card'); card.dataset.courseId = event.courseId;
  const name = el('strong'), actual = el('span'), steps = el('small'); card.append(name, actual, steps); if (list) list.append(card);
  let activity = null, key = '', busy = false;

  const actor = {
    status(row, status) {
      const nextKey = JSON.stringify([row.event.seq, status]); if (key === nextKey) return; key = nextKey;
      busy = status === 'busy';
      name.textContent = row.event.courseName || w.cfg.name;
      actual.textContent = tr(status === 'busy' ? row.event.operation : status) + (row.event.isMock ? ' · ' + tr('offline') : '');
      steps.textContent = row.steps.map((step) => tr(step.operation) + ': ' + tr('step.' + step.status) + (step.count === undefined ? '' : ` (${step.count})`)).join(' · ');
      card.dataset.status = status;
      if (activity) w.say('read', tr(busy ? activity : 'recent', { activity: tr(activity) }));
    },
    play(operation) {
      activity = operation; card.dataset.animation = operation;
      const anim = operation === 'library.search' ? 'read' : operation === 'memory.search' ? 'think' : 'type';
      w.anim = anim;
      w.say('read', tr(busy ? operation : 'recent', { activity: tr(operation) }));
    },
    arrived() { return true; },
    settle() {},
    rest() {
      activity = null;
      card.dataset.animation = 'idle';
      const sess = sessions.get(w.id);
      // Khi hoàn thành hoạt động, chuyển về thế đọc sách nghiên cứu tài liệu
      if (!sess || sess.status !== 'work') {
        w.anim = 'read';
        w.hush();
      }
    },
    inspect() { return { actorId: w.id, anim: w.anim, phase: w.phase }; },
    dispose() { card.remove(); actors.delete(event.courseId); },
    w,
  };
  actors.set(event.courseId, actor);
  return actor;
}

export function studentMessage(message) {
  if (!adapter || replay.on) return;
  try {
    if (message.k === 'snap' && message.student) adapter.snapshot(message.student);
    else if (message.k === 'student') adapter.event(message.event);
    if (panel) panel.hidden = !actors.size;
  } catch { /* This optional visualization never interrupts legacy live updates. */ }
}
export function studentConnection(on) { try { adapter?.connection(on); } catch { /* Optional visualization. */ } }
export function updateStudentTutors() {
  if (!adapter) return;
  if (replay.on) { adapter.dispose(); if (panel) panel.hidden = true; return; }
  try {
    adapter.tick();
    if (panel) panel.hidden = !actors.size;
  } catch { adapter.dispose(); if (panel) panel.hidden = true; }
}
export function studentWalking() { return false; }
export function rebuildStudentTutors() {}
export function setup() {
  if (!enabled()) return;
  panel = el('details', 'student-office-panel'); panel.id = 'student-office'; panel.hidden = true; panel.open = true;
  const heading = el('summary', '', tr('title')); list = el('ul'); panel.append(heading, list);
  const stage = document.getElementById('stage');
  if (stage) stage.append(panel);
  adapter = createStudentOfficeAdapter({ createActor });
  if (new URLSearchParams(location.search).has('debug')) {
    window.__studentOffice = { inspect: () => adapter.inspect(), ready: () => adapter.ready() };
  }
  const cleanup = () => { if (disposed) return; disposed = true; adapter.dispose(); panel?.remove(); };
  addEventListener('pagehide', cleanup, { once: true });
  addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
}
