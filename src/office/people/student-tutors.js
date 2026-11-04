// Student tutors reuse the chibi rig and walking graph in their own namespace, outside session/NPC registries.
import { state } from '../core/state.js';
import { $, STATIC, el, reduceMotion, replay, short } from '../core/env.js';
import { Worker } from './workers.js';
import { STATIONS } from './navigation.js';
import { t } from '../../i18n/index.js';
import { createStudentOfficeAdapter } from '../adapters/student-events.js';

const actors = new Map();
let adapter = null, panel = null, list = null, disposed = false;
const tr = (key, vars) => t('student.officeActivity.' + key, vars);
const enabled = () => !STATIC && !new URLSearchParams(location.search).has('demo');

function createActor(event) {
  const home = STATIONS.meeting.find((spot) => !spot.by);
  if (!home) return null;
  const w = new Worker({ name: tr('tutor'), shirt: '#2A9D8F', look: state.LOOK }, { id: 'student:tutor:' + event.courseId, scale: 0.88 });
  // Student actors never enter workers/sessions/npcs, and never run Claude's daily-life planner.
  w.tick = () => {};
  w.hurry = true;
  home.by = w; w.spot = home; w.pos.set(home.x, home.z); w.face = w.faceTarget = home.face;
  w.root.name = w.id; w.root.userData.studentCourseId = event.courseId;
  w.tagEl.classList.add('student-tutor-tag'); w.tagEl.dataset.studentCourse = event.courseId;
  w.setName(tr('name', { course: short(event.courseName, 24) }));
  const card = el('li', 'student-office-card'); card.dataset.courseId = event.courseId;
  const name = el('strong'), actual = el('span'), steps = el('small'); card.append(name, actual, steps); list.append(card);
  const history = []; let activity = null, key = '', busy = false, destination = home, targetAnim = 'idle';
  function place(spot, anim, instant = false) {
    destination = spot; targetAnim = anim;
    if (w.spot && w.spot !== home && w.spot.by === w) w.spot.by = null;
    if (spot !== home) spot.by = w;
    if (instant || reduceMotion) {
      w.path = []; w.onArrive = null; w.phase = 'idle'; w.spot = spot; w.pos.set(spot.x, spot.z); w.face = w.faceTarget = spot.face; w.pose = spot.sit ? 'sit' : 'stand'; w.anim = anim;
      w.animate(0.1, state.sim);
    } else {
      w.goTo(spot, () => { w.anim = anim; });
      home.by = w; // Keep the study seat reserved while its tutor visits the library.
      w.anim = anim;
    }
  }
  const actor = {
    status(row, status) {
      const nextKey = JSON.stringify([row.event.seq, status]); if (key === nextKey) return; key = nextKey;
      busy = status === 'busy';
      w.setName(tr('name', { course: short(row.event.courseName, 24) }));
      name.textContent = tr('name', { course: row.event.courseName });
      actual.textContent = tr(status === 'busy' ? row.event.operation : status) + (row.event.isMock ? ' · ' + tr('offline') : '');
      steps.textContent = row.steps.map((step) => tr(step.operation) + ': ' + tr('step.' + step.status) + (step.count === undefined ? '' : ` (${step.count})`)).join(' · ');
      card.dataset.status = status; w.tagEl.dataset.status = status;
      if (activity) w.say('read', tr(busy ? activity : 'recent', { activity: tr(activity) }));
    },
    play(operation) {
      activity = operation; card.dataset.animation = operation;
      const anim = operation === 'library.search' ? 'read' : operation === 'memory.search' ? 'think' : 'type';
      const library = w.spot !== home && w.spot?.by === w ? w.spot : STATIONS.library.find((spot) => !spot.by) || home;
      place(operation === 'ai.respond' ? home : library, anim);
      history.push(operation); if (history.length > 12) history.shift();
      w.say('read', tr(busy ? operation : 'recent', { activity: tr(operation) }));
    },
    arrived() { return w.phase !== 'walk'; },
    settle() { place(destination, targetAnim, true); },
    rest() { activity = null; card.dataset.animation = 'idle'; place(home, 'idle', true); w.hush(); },
    inspect() { return { actorId: w.id, inScene: !!w.root.parent, anim: w.anim, phase: w.phase, position: { x: w.root.position.x, z: w.root.position.z }, home: { x: home.x, z: home.z }, history: [...history] }; },
    dispose() { if (home.by === w) home.by = null; w.remove(); card.remove(); actors.delete(event.courseId); },
    w,
  };
  actors.set(event.courseId, actor);
  actor.rest(); return actor;
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
export function updateStudentTutors(dt, time) {
  if (!adapter) return;
  if (replay.on) { adapter.dispose(); panel.hidden = true; return; }
  try {
    adapter.tick();
    for (const actor of actors.values()) actor.w.update(reduceMotion ? 0 : dt, time);
    panel.hidden = !actors.size;
  } catch { adapter.dispose(); panel.hidden = true; }
}
export function studentWalking() { return [...actors.values()].some((actor) => actor.w.phase === 'walk'); }
export function rebuildStudentTutors() { for (const [courseId, actor] of actors) { try { actor.w.rebuild(); actor.w.root.name = actor.w.id; actor.w.root.userData.studentCourseId = courseId; } catch { actor.dispose(); } } }
export function setup() {
  if (!enabled()) return;
  panel = el('details', 'student-office-panel'); panel.id = 'student-office'; panel.hidden = true; panel.open = true;
  const heading = el('summary', '', tr('title')); list = el('ul'); panel.append(heading, list); $('stage').append(panel);
  adapter = createStudentOfficeAdapter({ createActor });
  if (new URLSearchParams(location.search).has('debug')) {
    // Read-only diagnostics describe actual rendered actors; there is no browser event injection endpoint.
    window.__studentOffice = { inspect: () => adapter.inspect(), ready: () => adapter.ready() };
  }
  const cleanup = () => { if (disposed) return; disposed = true; adapter.dispose(); panel.remove(); };
  addEventListener('pagehide', cleanup, { once: true });
  addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
}
