// Food Diary pure logic. An ES module that runs unchanged in the browser
// (imported by index.html) and in node (logic.test.js via `node --test`).
// Nothing here touches the DOM, storage, or the clock: callers pass `now` in.

export const STATE_VERSION = 1;
export const WINDOW_CHOICES = [6, 12, 24, 48, 72];

// Starter allergen vocabulary. Events store ids; labels are for display.
export const STARTER_TAGS = [
  { id: 'dairy', label: 'Dairy' },
  { id: 'soy', label: 'Soy' },
  { id: 'egg', label: 'Egg' },
  { id: 'wheat', label: 'Wheat' },
  { id: 'corn', label: 'Corn' },
  { id: 'peanut', label: 'Peanut' },
  { id: 'treenut', label: 'Tree nuts' },
  { id: 'fish', label: 'Fish' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'citrus', label: 'Citrus' },
  { id: 'strawberry', label: 'Strawberry' },
  { id: 'chocolate', label: 'Chocolate' },
];
const STARTER_IDS = new Set(STARTER_TAGS.map((t) => t.id));

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- time --------------------------------------------------------------------
// Timestamps are local wall-clock strings like "2026-09-13T14:30", no zone.
// A timestamp's day is its first ten characters, so day boundaries are local
// by construction and same-shape strings compare correctly as plain strings.
// Elapsed hours go through Date, which knows about DST; day counts use UTC
// calendar math, which never sees a 23h or 25h day.

const pad = (n) => String(n).padStart(2, '0');
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

export function toLocalISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isTs(ts) {
  return typeof ts === 'string' && ts.length === 16 && TS_RE.test(ts);
}

export function parseLocal(ts) {
  const m = typeof ts === 'string' && TS_RE.exec(ts);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export const dayKey = (ts) => ts.slice(0, 10);

const utcDay = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(day, n) {
  const t = new Date(utcDay(day) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(dayA, dayB) {
  return Math.round((utcDay(dayB) - utcDay(dayA)) / 86400000);
}

export function hoursBetween(a, b) {
  return (parseLocal(b) - parseLocal(a)) / 3600000;
}

// ---- phases ------------------------------------------------------------------

export function isPhaseActive(phase, now) {
  return phase.start <= now && (phase.end == null || now < phase.end);
}

// Day number within a phase, counting the start day as day 1. Closed phases
// stop counting on their end day. 0 means the phase hasn't started yet.
export function phaseDay(phase, now) {
  if (now < phase.start) return 0;
  const last = phase.end != null && phase.end < now ? phase.end : now;
  return daysBetween(dayKey(phase.start), dayKey(last)) + 1;
}

// Active first, then upcoming, then closed; newest start first within each.
export function sortPhases(phases, now) {
  const rank = (p) => (isPhaseActive(p, now) ? 0 : p.start > now ? 1 : 2);
  return [...phases].sort((a, b) =>
    rank(a) - rank(b) || (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

// ---- tags --------------------------------------------------------------------

export function slugify(label) {
  return String(label)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Every known tag: starters first, then custom ones. Hidden tags are still
// returned (flagged) so history keeps resolving their labels.
export function allTags(settings) {
  const hidden = new Set((settings && settings.hiddenTags) || []);
  const custom = ((settings && settings.customTags) || [])
    .filter((t) => isObj(t) && t.id && !STARTER_IDS.has(t.id));
  return [...STARTER_TAGS, ...custom]
    .map((t) => ({ id: t.id, label: t.label, hidden: hidden.has(t.id) }));
}

export function tagLabel(settings, id) {
  const t = allTags(settings).find((x) => x.id === id);
  return t ? t.label : id;
}

// ---- state -------------------------------------------------------------------

export function freshState() {
  return {
    v: STATE_VERSION,
    onboarded: false,
    babyName: '',
    settings: {
      windowHours: 24,
      customTags: [],   // [{ id, label }], id slugified from label
      hiddenTags: [],   // tag ids hidden from pickers, never deleted
    },
    meals: [],
    foodLog: [],
    symptomLog: [],
    phases: [],
    dismissed: [],      // exposure banners the parent closed
    lastBackup: null,   // timestamp of the last export
  };
}

// Upgrades from version k to k+1, keyed by k. Migrations are additive: they
// add or reshape fields and never drop diary entries. None exist yet.
const MIGRATIONS = {};

// Reads whatever localStorage (or an imported file) holds.
//   { ok: true, state, fresh, migrated }   ready to use
//   { ok: false, reason: 'newer', version } saved by a newer build: hands off
//   { ok: false, reason: 'unreadable' }     not a diary this app wrote
export function readState(raw) {
  if (raw == null || raw === '') {
    return { ok: true, state: freshState(), fresh: true, migrated: false };
  }
  let data;
  try { data = JSON.parse(raw); } catch { return { ok: false, reason: 'unreadable' }; }
  if (!isObj(data) || !Number.isInteger(data.v) || data.v < 1) {
    return { ok: false, reason: 'unreadable' };
  }
  if (data.v > STATE_VERSION) return { ok: false, reason: 'newer', version: data.v };
  let s = data;
  for (let k = data.v; k < STATE_VERSION; k++) s = MIGRATIONS[k](s);
  return { ok: true, state: normalizeState(s), fresh: false, migrated: data.v < STATE_VERSION };
}

// Fills in anything missing. Unknown fields ride along untouched, so data from
// a sibling build is never silently stripped.
export function normalizeState(s) {
  const base = freshState();
  const out = { ...base, ...s, v: STATE_VERSION };
  out.settings = { ...base.settings, ...(isObj(s.settings) ? s.settings : {}) };
  if (!WINDOW_CHOICES.includes(out.settings.windowHours)) {
    out.settings.windowHours = base.settings.windowHours;
  }
  for (const k of ['customTags', 'hiddenTags']) {
    if (!Array.isArray(out.settings[k])) out.settings[k] = [];
  }
  for (const k of ['meals', 'foodLog', 'symptomLog', 'phases', 'dismissed']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (typeof out.babyName !== 'string') out.babyName = '';
  if (out.lastBackup != null && !isTs(out.lastBackup)) out.lastBackup = null;
  // A diary that already holds entries has clearly been set up.
  out.onboarded = out.onboarded === true ||
    out.foodLog.length + out.symptomLog.length + out.phases.length > 0;
  return out;
}
