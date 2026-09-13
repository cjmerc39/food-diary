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

// Phases running on a local day, each with the day number it had reached then,
// in the Phases tab's order. A phase is off on its end day.
export function phasesOnDay(phases, day) {
  const running = phases.filter((p) => isTs(p.start) && dayKey(p.start) <= day && (p.end == null || dayKey(p.end) > day));
  return sortPhases(running, `${day}T12:00`).map((phase) => ({ phase, day: daysBetween(dayKey(phase.start), day) + 1 }));
}

// The numbers on a day's glance card.
export function dayGlance(state, day) {
  const entries = dayEntries(state, day);
  const food = entries.filter((r) => r.kind === 'food').length;
  return {
    load: dayLoad(state.symptomLog, day).load,
    entries: entries.length,
    food,
    symptoms: entries.length - food,
    phases: phasesOnDay(state.phases, day),
  };
}

// What sits in a day's leftover space. No personality or motion beside symptom
// data, so a day with symptoms keeps only the plain mark, at rest. Otherwise
// today's mark reads the clock (moon late at night, sun in the morning), a past
// day with food and no symptoms gets a leaf, an empty past day keeps the plain
// mark, and the mark settles in when shown.
//   { mark: 'default' | 'moon' | 'sun' | 'leaf', line: 'today-empty' | 'past-empty' | 'no-symptoms' | null, still: boolean }
export function dayRest({ isToday, hour, entries, symptoms }) {
  if (symptoms > 0) return { mark: 'default', line: null, still: true };
  if (isToday) {
    return { mark: skyMark(hour) || 'default', line: entries ? null : 'today-empty', still: false };
  }
  return entries ? { mark: 'leaf', line: 'no-symptoms', still: false } : { mark: 'default', line: 'past-empty', still: false };
}

// The sky's mark for the hour: a moon from 10pm to 5am, a sun until 11am, otherwise none.
export function skyMark(hour) {
  return hour >= 22 || hour < 5 ? 'moon' : hour < 11 ? 'sun' : null;
}

// Which entrance the launch welcome plays, picked at random per cold launch:
// the drop falls into the bowl, steam rises from the empty bowl, the empty bowl
// rocks and settles, or the moon or sun rises behind it (only in that mark's
// hours). `mark` is the shape above the bowl.
//   { variant: 'drop' | 'steam' | 'wobble' | 'rise', mark: 'default' | 'none' | 'moon' | 'sun' }
export const WELCOME_VARIANTS = ['drop', 'steam', 'wobble', 'rise'];
export function welcomeVariant(hour, random = Math.random()) {
  const sky = skyMark(hour);
  const pool = sky ? WELCOME_VARIANTS : WELCOME_VARIANTS.filter((v) => v !== 'rise');
  const variant = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random * pool.length)))];
  return { variant, mark: variant === 'rise' ? sky : variant === 'drop' ? 'default' : 'none' };
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
  const nowMs = tsMs(now);
  // A diary younger than the range has no data before its first entry.
  // Counting those empty hours would shrink the baseline and inflate ratios.
  const first = firstEntryDay(state);
  const fromMs = tsMs(first && `${first}T00:00` > from ? `${first}T00:00` : from);
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

// ---- trends and report -------------------------------------------------------

export const TREND_RANGES = { '2w': 14, '4w': 28, '8w': 56, all: null };

export function firstEntryDay(state) {
  let first = null;
  for (const e of [...state.foodLog, ...state.symptomLog]) {
    if (isTs(e.ts) && (first === null || e.ts < first)) first = e.ts;
  }
  return first && dayKey(first);
}

// The days a Trends range covers, ending today. "all" starts at the first
// logged entry (or today, before there is one).
export function trendDays(state, range, today) {
  const n = TREND_RANGES[range];
  const first = firstEntryDay(state);
  const fromDay = n ? addDays(today, -(n - 1)) : first && first < today ? first : today;
  return { fromDay, toDay: today };
}

// Daily load for the chart. Days before the diary's first entry are marked
// as having no data, so a new diary doesn't draw a flat line of false calm.
export function trendSeries(state, fromDay, toDay) {
  const first = firstEntryDay(state);
  return loadSeries(state.symptomLog, fromDay, toDay).map((d) => ({ ...d, hasData: first !== null && d.day >= first }));
}

// A chart color slot per phase tag, in order of each tag's first phase. Colors
// follow the food, not its position in the current range, so zooming the
// range never repaints a band. Past `max` tags, the rest share -1 (neutral).
export function phaseTagSlots(phases, max = 8) {
  const ordered = phases.filter((p) => isTs(p.start)).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const slots = new Map();
  let next = 0;
  for (const p of ordered) {
    if (slots.has(p.tag)) continue;
    slots.set(p.tag, next < max ? next : -1);
    next++;
  }
  return slots;
}

// Every entry from fromDay through toDay, oldest first, for the report's log.
export function rangeEntries(state, fromDay, toDay) {
  const rows = [];
  const inRange = (e) => isTs(e.ts) && dayKey(e.ts) >= fromDay && dayKey(e.ts) <= toDay;
  for (const e of state.foodLog) if (inRange(e)) rows.push({ kind: 'food', e });
  for (const e of state.symptomLog) if (inRange(e)) rows.push({ kind: 'symptom', e });
  return rows.sort((a, b) => (a.e.ts < b.e.ts ? -1 : a.e.ts > b.e.ts ? 1 : 0));
}

// ---- tags in settings --------------------------------------------------------

// Adds a custom allergen tag, id slugified from the label.
// Returns { settings, id } or { error }.
export function addCustomTag(settings, label) {
  const name = String(label).trim().replace(/\s+/g, ' ');
  const id = slugify(name);
  if (!id) return { error: 'Use at least one letter or number.' };
  const clash = allTags(settings).find((t) => t.id === id || normName(t.label) === normName(name));
  if (clash) return { error: `${clash.label} is already on the list.` };
  return { id, settings: { ...settings, customTags: [...settings.customTags, { id, label: name }] } };
}

// Whether a tag appears anywhere in the diary. Tags in use can be hidden but
// never deleted, so history keeps its labels.
export function tagInUse(state, id) {
  const onMeal = (m) => (m.tags || []).includes(id) || (m.uncertain || []).includes(id);
  return state.meals.some(onMeal) || state.foodLog.some(onMeal) || state.phases.some((p) => p.tag === id);
}

// ---- backups -----------------------------------------------------------------

// Merges an imported diary into the current one, matching entries by id.
// Anything the current diary lacks is added; on a clash the current copy wins,
// so importing an older backup can never undo edits made since. Returns a new
// state (inputs untouched) and how many of each were added.
export function mergeStates(current, incoming) {
  const out = { ...current, settings: { ...current.settings } };
  const added = {};
  for (const k of ['meals', 'foodLog', 'symptomLog', 'phases']) {
    const have = new Set(current[k].map((x) => x.id));
    const extra = incoming[k].filter((x) => isObj(x) && x.id != null && !have.has(x.id));
    added[k] = extra.length;
    out[k] = [...current[k], ...extra];
  }
  const customIds = new Set(current.settings.customTags.map((t) => t.id));
  out.settings.customTags = [...current.settings.customTags,
    ...incoming.settings.customTags.filter((t) => isObj(t) && t.id && !customIds.has(t.id))];
  out.settings.hiddenTags = [...new Set([...current.settings.hiddenTags, ...incoming.settings.hiddenTags])];
  out.dismissed = [...new Set([...current.dismissed, ...incoming.dismissed])];
  if (!out.babyName && incoming.babyName) out.babyName = incoming.babyName;
  if (incoming.lastBackup && (!out.lastBackup || incoming.lastBackup > out.lastBackup)) out.lastBackup = incoming.lastBackup;
  out.onboarded = current.onboarded || incoming.onboarded;
  return { state: out, added };
}

export const BACKUP_DUE_DAYS = 14;
export const BACKUP_SNOOZE_DAYS = 7;

// The gentle backup reminder on Today. It waits until the diary has food or
// symptom entries and two weeks have passed since the last backup (or, with no
// backup yet, since the first entry), and stays away for a week after "Later".
// Returns null, or { days, never } for the reminder's wording.
export function backupReminder(state, today) {
  const first = firstEntryDay(state);
  if (!first) return null;
  const never = !isTs(state.lastBackup);
  const days = daysBetween(never ? first : dayKey(state.lastBackup), today);
  if (days < BACKUP_DUE_DAYS) return null;
  if (isTs(state.backupSnoozed) && daysBetween(dayKey(state.backupSnoozed), today) < BACKUP_SNOOZE_DAYS) return null;
  return { days, never };
}

export const APP_ID = 'food-diary';
const SAFE_ID = /^[\w-]{1,64}$/;
const SAFE_TAG = /^[a-z0-9-]{1,40}$/;

// Reads a backup file. Beyond readState's version checks, the file has to be
// this app's diary (not, say, another app's saved state from the same site),
// and every entry is checked, so a damaged or hand-edited file can neither
// crash the app nor put markup on the page. Bad entries are dropped and counted.
//   { ok: true, state, skipped }  |  { ok: false, reason: 'unreadable' | 'newer' | 'not-diary' }
export function readBackup(text) {
  const res = readState(text);
  if (!res.ok) return res;
  if (res.fresh) return { ok: false, reason: 'unreadable' };
  const raw = JSON.parse(text);
  const isDiary = raw.app === APP_ID || ['meals', 'foodLog', 'symptomLog', 'phases'].every((k) => Array.isArray(raw[k]));
  if (!isDiary) return { ok: false, reason: 'not-diary' };
  const { state, skipped } = sanitizeDiary(res.state);
  delete state.app;
  return { ok: true, state, skipped };
}

// Keeps only well-formed entries with safe ids and tags, repairing what can
// be repaired (missing tag lists, a stool severity that disagrees with its
// consistency) and dropping the rest, including repeated ids.
export function sanitizeDiary(s) {
  let skipped = 0;
  const text = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  const tagList = (v) => (Array.isArray(v) ? [...new Set(v.filter((t) => typeof t === 'string' && SAFE_TAG.test(t)))] : []);
  const keep = (list, fix) => {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const fixed = isObj(item) && typeof item.id === 'string' && SAFE_ID.test(item.id) && !seen.has(item.id) ? fix(item) : null;
      if (fixed) {
        seen.add(fixed.id);
        out.push(fixed);
      } else {
        skipped++;
      }
    }
    return out;
  };

  const meals = keep(s.meals, (m) => {
    const name = text(m.name, 80).trim();
    if (!name) return null;
    const tags = tagList(m.tags);
    return {
      ...m, name, tags, uncertain: tagList(m.uncertain).filter((t) => !tags.includes(t)),
      useCount: Number.isFinite(m.useCount) && m.useCount > 0 ? Math.floor(m.useCount) : 0,
      lastUsed: isTs(m.lastUsed) ? m.lastUsed : null,
    };
  });

  const foodLog = keep(s.foodLog, (e) => {
    if (!isTs(e.ts)) return null;
    const tags = tagList(e.tags);
    return {
      ...e, name: text(e.name, 80).trim() || 'Food', tags, uncertain: tagList(e.uncertain).filter((t) => !tags.includes(t)),
      mealId: typeof e.mealId === 'string' && SAFE_ID.test(e.mealId) ? e.mealId : null, note: text(e.note),
    };
  });

  const symptomLog = keep(s.symptomLog, (e) => {
    if (!isTs(e.ts) || !SYMPTOM_CATS.includes(e.cat)) return null;
    const fixed = { ...e, flags: tagList(e.flags).filter((f) => (CAT_FLAGS[e.cat] || []).includes(f)), note: text(e.note) };
    if (e.cat === 'stool' && Object.hasOwn(STOOL_SEVERITY, e.consistency)) {
      fixed.severity = STOOL_SEVERITY[e.consistency];
      return fixed;
    }
    delete fixed.consistency;
    return [1, 2, 3].includes(e.severity) ? fixed : null;
  });

  const phases = keep(s.phases, (p) => {
    if (!['eliminate', 'reintroduce'].includes(p.kind) || typeof p.tag !== 'string' || !SAFE_TAG.test(p.tag) || !isTs(p.start)) return null;
    if (p.end != null && (!isTs(p.end) || p.end <= p.start)) return null;
    const fixed = { ...p, end: p.end ?? null, note: text(p.note) };
    if (Array.isArray(p.closes)) fixed.closes = p.closes.filter((id) => typeof id === 'string' && SAFE_ID.test(id));
    else delete fixed.closes;
    return fixed;
  });

  const customIds = new Set();
  const customTags = [];
  for (const t of s.settings.customTags) {
    const ok = isObj(t) && typeof t.id === 'string' && SAFE_TAG.test(t.id) && !customIds.has(t.id) && typeof t.label === 'string' && t.label.trim();
    if (!ok) { skipped++; continue; }
    customIds.add(t.id);
    customTags.push({ id: t.id, label: t.label.trim().slice(0, 30) });
  }

  return {
    state: {
      ...s,
      babyName: text(s.babyName, 40),
      settings: { ...s.settings, customTags, hiddenTags: tagList(s.settings.hiddenTags) },
      meals, foodLog, symptomLog, phases,
      dismissed: s.dismissed.filter((k) => typeof k === 'string').slice(0, 500),
    },
    skipped,
  };
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
    backupSnoozed: null, // when the parent last tapped "Later" on the backup reminder
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
  if (out.backupSnoozed != null && !isTs(out.backupSnoozed)) out.backupSnoozed = null;
  // A diary that already holds entries has clearly been set up.
  out.onboarded = out.onboarded === true ||
    out.foodLog.length + out.symptomLog.length + out.phases.length > 0;
  return out;
}
