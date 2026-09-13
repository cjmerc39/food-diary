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
  { id: 'oat', label: 'Oat' },
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
const HOUR = 3600000;

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
export const tsMs = (ts) => parseLocal(ts).getTime();

export function addHours(ts, hours) {
  return toLocalISO(new Date(tsMs(ts) + hours * HOUR));
}

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
  return (tsMs(b) - tsMs(a)) / HOUR;
}

// ---- phases ------------------------------------------------------------------
// A phase runs from `start` up to, not including, `end`. Phases are dated by
// day (T00:00), so a phase that ended on Sep 10 last covered Sep 9.

export function isPhaseActive(phase, now) {
  return phase.start <= now && (phase.end == null || now < phase.end);
}

// Day number within a phase, counting the start day as day 1. A closed phase
// reports its length in days. 0 means it hasn't started yet.
export function phaseDay(phase, now) {
  if (now < phase.start) return 0;
  if (phase.end != null && phase.end <= now) {
    return Math.max(1, daysBetween(dayKey(phase.start), dayKey(phase.end)));
  }
  return daysBetween(dayKey(phase.start), dayKey(now)) + 1;
}

// Active first, then upcoming, then closed; newest start first within each.
export function sortPhases(phases, now) {
  const rank = (p) => (isPhaseActive(p, now) ? 0 : p.start > now ? 1 : 2);
  return [...phases].sort((a, b) =>
    rank(a) - rank(b) || (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

// Open-ended eliminations of `tag` already running when a reintroduction of it
// starts at `startTs`. Starting the reintroduction offers to end them; one with
// its own end date is left alone.
export function phasesToClose(phases, tag, startTs) {
  return phases.filter((p) => p.kind === 'eliminate' && p.tag === tag && p.start < startTs && p.end == null);
}

// Chart bands for phases overlapping [fromDay, toDay], clipped to that range.
// A band covers its start day through the day before its end day; an open
// phase runs through toDay.
export function phaseBands(phases, fromDay, toDay) {
  const bands = [];
  for (const p of phases) {
    if (!isTs(p.start)) continue;
    const first = dayKey(p.start);
    const last = p.end ? addDays(dayKey(p.end), -1) : toDay;
    const from = first > fromDay ? first : fromDay;
    const to = last < toDay ? last : toDay;
    if (last < first || from > to) continue;
    bands.push({ id: p.id, tag: p.tag, kind: p.kind, from, to, clippedStart: first < fromDay, open: p.end == null });
  }
  return bands;
}

// ---- tags and meals ----------------------------------------------------------

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

// A tag on a meal is "on" (contains), "maybe" (possibly hidden), or "off".
// It lives in `tags` or `uncertain`, never both.
export function tagState({ tags, uncertain }, id) {
  return tags.includes(id) ? 'on' : uncertain.includes(id) ? 'maybe' : 'off';
}

// The picker's tap cycle: off -> on -> maybe -> off.
export function cycleTag({ tags, uncertain }, id) {
  if (tags.includes(id)) return { tags: tags.filter((t) => t !== id), uncertain: [...uncertain, id] };
  if (uncertain.includes(id)) return { tags, uncertain: uncertain.filter((t) => t !== id) };
  return { tags: [...tags, id], uncertain };
}

export const normName = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

export function findMealByName(meals, name) {
  const n = normName(name);
  return (n && meals.find((m) => normName(m.name) === n)) || null;
}

// A name for a meal logged with allergens but no name: "Dairy, soy, possible egg".
export function autoMealName(settings, tags, uncertain) {
  const parts = [
    ...tags.map((t) => tagLabel(settings, t).toLowerCase()),
    ...uncertain.filter((t) => !tags.includes(t)).map((t) => `possible ${tagLabel(settings, t).toLowerCase()}`),
  ];
  const s = parts.join(', ');
  return s && s[0].toUpperCase() + s.slice(1);
}

// Order for the recents grid: each use counts, and a meal's pull halves for
// every week it goes unused, so both habits and this week's meals rise.
export function rankMeals(meals, now, limit = 8) {
  const nowMs = tsMs(now);
  const score = (m) => {
    const ageDays = isTs(m.lastUsed) ? Math.max(0, (nowMs - tsMs(m.lastUsed)) / 86400000) : 365;
    return (1 + (m.useCount || 0)) * 0.5 ** (ageDays / 7);
  };
  return meals.map((m) => [score(m), m])
    .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, m]) => m);
}

// Library search: names starting with the query, then any word starting with
// it, then containing it anywhere; more-used meals first within each.
export function searchMeals(meals, query) {
  const q = normName(query);
  if (!q) return [];
  const rank = (m) => {
    const name = normName(m.name);
    if (name.startsWith(q)) return 0;
    if (name.split(' ').some((w) => w.startsWith(q))) return 1;
    return name.includes(q) ? 2 : -1;
  };
  return meals.map((m) => [rank(m), m])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || (b[1].useCount || 0) - (a[1].useCount || 0) || a[1].name.localeCompare(b[1].name))
    .map(([, m]) => m);
}

// ---- symptoms ----------------------------------------------------------------

export const SYMPTOM_CATS = ['crying', 'spitup', 'stool', 'skin', 'resp', 'other'];
// The five categories that make up the daily symptom load ("other" is not one).
export const LOAD_CATS = ['crying', 'spitup', 'stool', 'skin', 'resp'];
export const CAT_FLAGS = { stool: ['mucus', 'blood'], skin: ['hives'] };
export const FLAG_POINTS = { blood: 2, mucus: 1, hives: 2 };
// Stool severity comes from consistency. A formed stool is normal, so it can
// only be logged with a flag; it then has severity 0 and counts its flags.
export const STOOL_SEVERITY = { formed: 0, hard: 1, loose: 2, watery: 3 };

// What a symptom draft still needs before it can be logged, or '' when ready.
export function symptomMissing(d) {
  if (!SYMPTOM_CATS.includes(d.cat)) return 'category';
  if (d.cat === 'stool') {
    if (!(d.consistency in STOOL_SEVERITY)) return 'consistency';
    return d.consistency === 'formed' && !(d.flags || []).length ? 'formed' : '';
  }
  return [1, 2, 3].includes(d.severity) ? '' : 'severity';
}

// Event fields from a ready draft: stool severity derived from consistency,
// flags limited to the ones the category offers.
export function symptomFields(d) {
  const offered = CAT_FLAGS[d.cat] || [];
  const fields = {
    cat: d.cat,
    severity: d.cat === 'stool' ? STOOL_SEVERITY[d.consistency] : d.severity,
    flags: offered.filter((f) => (d.flags || []).includes(f)),
    note: String(d.note || '').trim(),
  };
  if (d.cat === 'stool') fields.consistency = d.consistency;
  return fields;
}

// Points one symptom event adds: its severity plus its flags' points.
export function eventPoints(e) {
  let points = Number.isFinite(e.severity) ? e.severity : 0;
  for (const f of e.flags || []) points += FLAG_POINTS[f] || 0;
  return points;
}

// Sorted symptom times with running point totals, so any time window can be
// summed with two binary searches instead of a scan per exposure.
export function symptomIndex(symptomLog) {
  const items = symptomLog.filter((e) => isTs(e.ts)).map((e) => [tsMs(e.ts), eventPoints(e)]);
  items.sort((a, b) => a[0] - b[0]);
  const times = items.map((x) => x[0]);
  const running = [0];
  for (const [, p] of items) running.push(running[running.length - 1] + p);
  const countUpTo = (t) => {
    let lo = 0, hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  return {
    // Points and entries strictly after fromMs, up to and including toMs.
    between(fromMs, toMs) {
      if (toMs <= fromMs) return { points: 0, count: 0 };
      const i = countUpTo(fromMs), j = countUpTo(toMs);
      return { points: running[j] - running[i], count: j - i };
    },
  };
}

export function bucketByDay(events) {
  const days = new Map();
  for (const e of events) {
    if (!isTs(e.ts)) continue;
    const k = dayKey(e.ts);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  return days;
}

// Symptom load for one local day, 0 to 20: for each of the five load
// categories, the worst severity logged that day, plus 2 if blood appeared,
// 1 for mucus, and 2 for hives, each counted once per day.
export function dayLoad(symptomLog, day) {
  const cats = Object.fromEntries(LOAD_CATS.map((c) => [c, 0]));
  const flags = { blood: false, mucus: false, hives: false };
  for (const e of symptomLog) {
    if (!isTs(e.ts) || dayKey(e.ts) !== day) continue;
    if (e.cat in cats) cats[e.cat] = Math.max(cats[e.cat], Number.isFinite(e.severity) ? e.severity : 0);
    for (const f of e.flags || []) if (f in flags) flags[f] = true;
  }
  const load = LOAD_CATS.reduce((sum, c) => sum + cats[c], 0) +
    Object.keys(flags).reduce((sum, f) => sum + (flags[f] ? FLAG_POINTS[f] : 0), 0);
  return { day, load, cats, flags };
}

export function loadSeries(symptomLog, fromDay, toDay) {
  const byDay = bucketByDay(symptomLog);
  const series = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) series.push(dayLoad(byDay.get(d) || [], d));
  return series;
}

// ---- today -------------------------------------------------------------------

export const WATCH_HOURS = 72;

// One day's entries, newest first, food and symptoms interleaved.
export function dayEntries(state, day) {
  const rows = [];
  for (const e of state.foodLog) if (isTs(e.ts) && dayKey(e.ts) === day) rows.push({ kind: 'food', e });
  for (const e of state.symptomLog) if (isTs(e.ts) && dayKey(e.ts) === day) rows.push({ kind: 'symptom', e });
  return rows.sort((a, b) => (a.e.ts < b.e.ts ? 1 : a.e.ts > b.e.ts ? -1 : 0));
}

// Every food event carrying the tag, oldest first. Possibly-hidden counts half.
export function exposuresOf(foodLog, tag) {
  const out = [];
  for (const e of foodLog) {
    if (!isTs(e.ts)) continue;
    const on = (e.tags || []).includes(tag);
    const maybe = !on && (e.uncertain || []).includes(tag);
    if (on || maybe) out.push({ event: e, ts: e.ts, ms: tsMs(e.ts), uncertain: maybe, weight: maybe ? 0.5 : 1 });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// Banners for Today: a food carrying a tag (or possibly hiding it) that was
// under an elimination when eaten, in the last 72 hours, not dismissed.
// One banner per exposure, keyed "eventId:tag". Newest first.
export function exposureBanners(state, now) {
  const nowMs = tsMs(now);
  const dismissed = new Set(state.dismissed);
  const banners = [];
  for (const e of state.foodLog) {
    if (!isTs(e.ts) || e.ts > now || nowMs - tsMs(e.ts) > WATCH_HOURS * HOUR) continue;
    const tags = e.tags || [];
    const pairs = [...tags.map((t) => [t, false]), ...(e.uncertain || []).filter((t) => !tags.includes(t)).map((t) => [t, true])];
    for (const [tag, uncertain] of pairs) {
      const key = `${e.id}:${tag}`;
      if (dismissed.has(key)) continue;
      if (!state.phases.some((p) => p.kind === 'eliminate' && p.tag === tag && isPhaseActive(p, e.ts))) continue;
      banners.push({ key, tag, uncertain, ts: e.ts, eventId: e.id, name: e.name });
    }
  }
  return banners.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

// Dismissed banner keys still worth remembering: their food event exists and
// is inside the 72-hour banner window.
export function pruneDismissed(state, now) {
  const nowMs = tsMs(now);
  const times = new Map(state.foodLog.filter((e) => isTs(e.ts)).map((e) => [e.id, e.ts]));
  return state.dismissed.filter((key) => {
    const ts = times.get(String(key).split(':')[0]);
    return ts && nowMs - tsMs(ts) <= WATCH_HOURS * HOUR;
  });
}

// Helper-card data for each active reintroduction: every exposure to its tag
// since the phase began, newest first, with the symptom points in the 72
// hours after it (so far, while that watch is still running).
export function reintroWatches(state, now) {
  const nowMs = tsMs(now);
  const index = symptomIndex(state.symptomLog);
  return sortPhases(state.phases.filter((p) => p.kind === 'reintroduce' && isPhaseActive(p, now)), now)
    .map((phase) => {
      const exposures = exposuresOf(state.foodLog, phase.tag)
        .filter((x) => x.ts >= phase.start && x.ts <= now)
        .map((x) => {
          const endMs = x.ms + WATCH_HOURS * HOUR;
          const { points, count } = index.between(x.ms, Math.min(endMs, nowMs));
          return {
            eventId: x.event.id, name: x.event.name, ts: x.ts, uncertain: x.uncertain,
            points, count, watching: endMs > nowMs, hoursLeft: Math.max(0, (endMs - nowMs) / HOUR),
          };
        })
        .reverse();
      return { phase, day: phaseDay(phase, now), exposures };
    });
}

// ---- suspects ----------------------------------------------------------------
// For each tag eaten in the range, how symptom points after eating it compare
// with the range's usual rate.
//   exposure      a food event carrying the tag; possibly-hidden counts half
//   points after  severities plus flag points in the window after the exposure
//   baseline      all points in the range / hours in the range * window hours
//   ratio         weight-averaged points after exposure / baseline
// An exposure whose window is still open at `now` is "watching": listed, but
// left out of the math because its tally is still growing. Windows may run
// past `to`. Overlapping windows share symptom events, so one flare can count
// toward several exposures and several tags eaten together; that is fine for
// a hint list, and it is why the UI says correlation, not diagnosis.
export function suspects(state, { from, to, windowHours, now, minWeight = 2 }) {
  const fromMs = tsMs(from), nowMs = tsMs(now);
  // A range may end later than now ("through today"); hours that haven't
  // happened yet would dilute the baseline and inflate every ratio.
  const toMs = Math.min(tsMs(to), nowMs);
  const windowMs = windowHours * HOUR;
  const index = symptomIndex(state.symptomLog);
  const hours = (toMs - fromMs) / HOUR;
  const totalPoints = index.between(fromMs - 1, toMs).points;
  const baseline = hours > 0 ? (totalPoints / hours) * windowHours : 0;

  const tagIds = new Set();
  for (const e of state.foodLog) for (const t of [...(e.tags || []), ...(e.uncertain || [])]) tagIds.add(t);

  const ranked = [];
  const notEnough = [];
  for (const tag of tagIds) {
    const inRange = exposuresOf(state.foodLog, tag).filter((x) => x.ms >= fromMs && x.ms <= toMs);
    if (!inRange.length) continue;
    const complete = inRange.filter((x) => x.ms + windowMs <= nowMs);
    let weight = 0, weightedPoints = 0, followed = 0;
    for (const x of complete) {
      const { points } = index.between(x.ms, x.ms + windowMs);
      weight += x.weight;
      weightedPoints += x.weight * points;
      if (points > 0) followed++;
    }
    const row = {
      tag, exposures: inRange.length, possible: inRange.filter((x) => x.uncertain).length,
      watching: inRange.length - complete.length, complete: complete.length, weight, followed,
    };
    if (weight < minWeight) { notEnough.push(row); continue; }
    row.meanAfter = weightedPoints / weight;
    row.ratio = baseline > 0 ? row.meanAfter / baseline : null;
    ranked.push(row);
  }
  ranked.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) ||
    b.followed / b.complete - a.followed / a.complete || b.weight - a.weight || a.tag.localeCompare(b.tag));
  notEnough.sort((a, b) => b.exposures - a.exposures || a.tag.localeCompare(b.tag));
  return { ranked, notEnough, baseline, totalPoints, hours, windowHours };
}

// ---- display -----------------------------------------------------------------

// Height for the installed app's shell. iOS standalone mode has mis-reported
// the viewport in both directions across versions: a phantom Safari toolbar
// once left a dead band at the bottom, and later 100lvh ran past the screen
// and hid the tab bar. When the app runs full screen under the status bar (a
// nonzero top inset) and the window is within a toolbar's height of the
// screen, the screen is the truth; otherwise the window is.
export function standaloneHeight({ insetTop, screenW, screenH, innerW, innerH }) {
  const screenTall = innerW > innerH ? Math.min(screenW, screenH) : Math.max(screenW, screenH);
  return insetTop > 0 && Math.abs(screenTall - innerH) <= 120 ? screenTall : innerH;
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
    dismissed: [],      // exposure banner keys ("eventId:tag") the parent closed
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
