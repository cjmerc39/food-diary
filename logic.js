// Food Diary pure logic. An ES module that runs unchanged in the browser
// (imported by index.html) and in node (logic.test.js via `node --test`).
// Nothing here touches the DOM, storage, or the clock: callers pass `now` in.

export const STATE_VERSION = 2;
// Earlier builds compared foods by a window of hours after each meal; Trends
// now compares whole days, so nothing reads these settings. They stay valid in
// stored diaries, so the choices are kept only to check them.
export const WINDOW_CHOICES = [6, 12, 24, 48, 72, 96, 120, 168];
export const DIRECT_WINDOW_CHOICES = [1, 2, 4, 8];

// Two exposure pathways: what the parent eats reaches the baby through breast
// milk; once solids start, the baby's own food is the second. Older entries
// carry no `who`, and mean the parent.
export const WHO = ['parent', 'baby'];
export const eventWho = (e) => (e.who === 'baby' ? 'baby' : 'parent');
export const hasBabyFood = (state) => state.foodLog.some((e) => eventWho(e) === 'baby');

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

// Meals and symptom sets have a name; foods have a label.
const nameOf = (x) => String(x.name ?? x.label ?? '');

// Order for the recents grid: each use counts, and a meal's pull halves for
// every week it goes unused, so both habits and this week's meals rise.
// Works the same for foods and symptom sets.
export function rankMeals(meals, now, limit = 8) {
  const nowMs = tsMs(now);
  const score = (m) => {
    const ageDays = isTs(m.lastUsed) ? Math.max(0, (nowMs - tsMs(m.lastUsed)) / 86400000) : 365;
    return (1 + (m.useCount || 0)) * 0.5 ** (ageDays / 7);
  };
  return meals.map((m) => [score(m), m])
    .sort((a, b) => b[0] - a[0] || nameOf(a[1]).localeCompare(nameOf(b[1])))
    .slice(0, limit)
    .map(([, m]) => m);
}

// Library search: names starting with the query, then any word starting with
// it, then containing it anywhere; more-used meals first within each. Works
// the same for foods.
export function searchMeals(meals, query) {
  const q = normName(query);
  if (!q) return [];
  const rank = (m) => {
    const name = normName(nameOf(m));
    if (name.startsWith(q)) return 0;
    if (name.split(' ').some((w) => w.startsWith(q))) return 1;
    return name.includes(q) ? 2 : -1;
  };
  return meals.map((m) => [rank(m), m])
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || (b[1].useCount || 0) - (a[1].useCount || 0) || nameOf(a[1]).localeCompare(nameOf(b[1])))
    .map(([, m]) => m);
}

// ---- foods -------------------------------------------------------------------
// From state v2, a meal is logged by picking foods from a list that grows as
// she logs. Each food carries its own allergens; a saved meal is a named
// bundle of foods, its allergens taken from them. Entries snapshot their tags
// when logged, so editing a food never rewrites history. Merging one food into
// another leaves the old one behind as an alias (mergedInto): past entries,
// which never change, then count toward the food it became.
//   Food = { id, label, tags, uncertain, useCount, lastUsed, reviewed, hidden?, mergedInto?, safe? }
// `safe` is hers alone: a food she has decided is fine, kept out of Trends'
// comparisons until she says otherwise. The app never sets or suggests it.

export const hasItems = (e) => Array.isArray(e.items) && e.items.length > 0;

// Looks foods up by id, following merges to the food each one became.
export function itemResolver(foodItems) {
  const byId = new Map((foodItems || []).filter(isObj).map((it) => [it.id, it]));
  return (id) => {
    let it = byId.get(id);
    const seen = new Set();
    while (it && it.mergedInto && !seen.has(it.id)) {
      seen.add(it.id);
      const next = byId.get(it.mergedInto);
      if (!next) break;
      it = next;
    }
    return it || null;
  };
}

// The foods behind a list of ids, merges followed, each once.
export function resolveItems(foodItems, ids) {
  const resolve = itemResolver(foodItems);
  const out = new Map();
  for (const id of ids || []) {
    const it = resolve(id);
    if (it && !out.has(it.id)) out.set(it.id, it);
  }
  return [...out.values()];
}

// Allergens across several foods (or anything with tags and uncertain): a
// food that contains one outranks another that possibly hides it.
export function itemTags(list) {
  const tags = [...new Set(list.flatMap((x) => x.tags || []))];
  const uncertain = [...new Set(list.flatMap((x) => x.uncertain || []))].filter((t) => !tags.includes(t));
  return { tags, uncertain };
}

// A saved meal's allergens: its foods', plus any it kept from before foods
// existed (a meal split into foods at the update keeps its old tags, because
// which of its foods held them isn't knowable).
export function mealTags(state, meal) {
  return itemTags([...resolveItems(state.foodItems, meal.items), { tags: meal.tags, uncertain: meal.uncertain }]);
}

// A food by its label, ignoring case and spacing; merged-away foods don't count.
export function findItemByLabel(foodItems, label) {
  const n = normName(label);
  return (n && (foodItems || []).find((it) => !it.mergedInto && normName(it.label) === n)) || null;
}

// Foods still to review: split out of saved meals at the update and not yet
// looked at, merged away, or hidden.
export const foodsToReview = (state) => (state.foodItems || []).filter((it) => !it.reviewed && !it.mergedInto && !it.hidden).length;

// The card on Today pointing to them: { count } while any are left, until she
// dismisses it or the count reaches zero, either of which retires it for good
// (foodReviewDone).
export function foodReviewCard(state) {
  if (state.foodReviewDone) return null;
  const count = foodsToReview(state);
  return count ? { count } : null;
}

// Foods the picker offers without searching: not merged away, not hidden.
export const pickableItems = (foodItems) => (foodItems || []).filter((it) => !it.mergedInto && !it.hidden);

// Merges one food into another. The library and saved meals move to the
// target, which also takes over the use count; the merged food stays behind
// as an alias so past entries count toward the target. The target keeps its
// own allergens. Returns { foodItems, meals } or null.
export function mergeItem(state, fromId, toId) {
  const resolve = itemResolver(state.foodItems);
  const from = resolve(fromId), to = resolve(toId);
  if (!from || !to || from.id === to.id) return null;
  const foodItems = state.foodItems.map((it) => {
    if (it.id === from.id) return { ...it, mergedInto: to.id };
    if (it.id === to.id) return { ...it, useCount: (to.useCount || 0) + (from.useCount || 0), lastUsed: later(to.lastUsed, from.lastUsed) };
    return it;
  });
  const meals = state.meals.map((m) => ((m.items || []).includes(from.id)
    ? { ...m, items: [...new Set(m.items.map((id) => (id === from.id ? to.id : id)))] } : m));
  return { foodItems, meals };
}

const later = (a, b) => (!isTs(a) ? (isTs(b) ? b : null) : isTs(b) && b > a ? b : a);

// An old meal name split into foods at its commas (and semicolons), never
// inside parentheses; an unclosed one keeps the rest together. Each food gets
// a capital first letter so the list reads evenly.
export function splitMealName(name) {
  const pieces = [];
  let depth = 0, cur = '';
  for (const ch of String(name || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { pieces.push(cur); cur = ''; continue; }
    cur += ch;
  }
  pieces.push(cur);
  return pieces.map((x) => x.trim().replace(/\s+/g, ' ').replace(/\.+$/, '').trim()).filter(Boolean)
    .map((x) => x[0].toUpperCase() + x.slice(1));
}

// A stable id for a food named at the update: the same name gets the same id
// on every copy of the diary, so restoring an old backup later can't double it.
function labelId(label) {
  let h = 2166136261;
  for (const ch of normName(label)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return `f${(h >>> 0).toString(36)}`;
}

// ---- symptoms ----------------------------------------------------------------

export const SYMPTOM_CATS = ['crying', 'spitup', 'stool', 'gas', 'skin', 'resp', 'other'];
// The five categories that make up the daily symptom load ("other" is not one).
export const LOAD_CATS = ['crying', 'spitup', 'stool', 'skin', 'resp'];
// Categories tracked per day: the load's five, plus gas, which is charted but
// not counted, so the load keeps its clinical five and its 0 to 20 scale.
export const DAY_CATS = [...LOAD_CATS, 'gas'];
export const CAT_FLAGS = { stool: ['mucus', 'blood'], skin: ['hives'] };
export const FLAG_POINTS = { blood: 2, mucus: 1, hives: 2 };
// Stool severity comes from consistency. A formed stool is normal, so it can
// only be logged with a flag or a color worth a call; it then has severity 0
// and counts its flags.
export const STOOL_SEVERITY = { formed: 0, hard: 1, loose: 2, watery: 3 };
// Stool color is descriptive and adds no points (green in particular is common
// and normal). Red, black, and pale carry a caution note in the sheet.
export const STOOL_COLORS = ['yellow', 'green', 'brown', 'orange', 'red', 'black', 'pale'];
export const CAUTION_COLORS = ['red', 'black', 'pale'];
// One stool entry can stand for several alike diapers. Missing means one.
export const MAX_STOOL_COUNT = 20;
export const stoolCount = (e) => (e.cat !== 'stool' ? 0
  : Number.isInteger(e.count) && e.count >= 1 ? Math.min(e.count, MAX_STOOL_COUNT) : 1);

// What a symptom draft still needs before it can be logged, or '' when ready.
export function symptomMissing(d) {
  if (!SYMPTOM_CATS.includes(d.cat)) return 'category';
  if (d.cat === 'stool') {
    if (!(d.consistency in STOOL_SEVERITY)) return 'consistency';
    return d.consistency === 'formed' && !(d.flags || []).length && !CAUTION_COLORS.includes(d.color) ? 'formed' : '';
  }
  return [1, 2, 3].includes(d.severity) ? '' : 'severity';
}

// Event fields from a ready draft: stool severity derived from consistency,
// flags limited to the ones the category offers. A stool keeps a known color
// and a count above one; both are left off otherwise.
export function symptomFields(d) {
  const offered = CAT_FLAGS[d.cat] || [];
  const fields = {
    cat: d.cat,
    severity: d.cat === 'stool' ? STOOL_SEVERITY[d.consistency] : d.severity,
    flags: offered.filter((f) => (d.flags || []).includes(f)),
    note: String(d.note || '').trim(),
  };
  if (d.cat === 'stool') {
    fields.consistency = d.consistency;
    if (STOOL_COLORS.includes(d.color)) fields.color = d.color;
    const n = stoolCount({ cat: 'stool', count: d.count });
    if (n > 1) fields.count = n;
  }
  return fields;
}

// A symptom set item from a ready draft: the event fields without the note or
// the count. How many diapers is a fact about one time, not about the pattern.
export function setItem(d) {
  const { note, count, ...item } = symptomFields(d);
  return item;
}

// Points one symptom event adds: its severity plus its flags' points. A stool
// entry standing for several diapers scores as that many entries would.
export function eventPoints(e) {
  let points = Number.isFinite(e.severity) ? e.severity : 0;
  for (const f of e.flags || []) points += FLAG_POINTS[f] || 0;
  return e.cat === 'stool' ? points * stoolCount(e) : points;
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
// 1 for mucus, and 2 for hives, each counted once per day. `cats` also carries
// gas (charted, not counted), and `stools` is how many stools were logged,
// counting an entry for several diapers as that many.
export function dayLoad(symptomLog, day) {
  const cats = Object.fromEntries(DAY_CATS.map((c) => [c, 0]));
  const flags = { blood: false, mucus: false, hives: false };
  let stools = 0;
  for (const e of symptomLog) {
    if (!isTs(e.ts) || dayKey(e.ts) !== day) continue;
    if (e.cat in cats) cats[e.cat] = Math.max(cats[e.cat], Number.isFinite(e.severity) ? e.severity : 0);
    for (const f of e.flags || []) if (f in flags) flags[f] = true;
    stools += stoolCount(e);
  }
  const load = LOAD_CATS.reduce((sum, c) => sum + cats[c], 0) +
    Object.keys(flags).reduce((sum, f) => sum + (flags[f] ? FLAG_POINTS[f] : 0), 0);
  return { day, load, cats, flags, stools };
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
  const { load, stools } = dayLoad(state.symptomLog, day);
  return {
    load,
    stools,
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
// `who` narrows to one pathway; null means both.
export function exposuresOf(foodLog, tag, who = null) {
  const out = [];
  for (const e of foodLog) {
    if (!isTs(e.ts) || (who && eventWho(e) !== who)) continue;
    const on = (e.tags || []).includes(tag);
    const maybe = !on && (e.uncertain || []).includes(tag);
    if (on || maybe) out.push({ event: e, ts: e.ts, ms: tsMs(e.ts), uncertain: maybe, weight: maybe ? 0.5 : 1, who: eventWho(e) });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// Banners for Today: a food carrying a tag (or possibly hiding it) that was
// under an elimination when eaten, in the last 72 hours, not dismissed.
// One banner per exposure, keyed "eventId:tag". Newest first. Eliminations
// describe the parent's diet, but the baby eating that food matters at least
// as much, so both pathways raise banners; `who` says which.
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
      banners.push({ key, tag, uncertain, ts: e.ts, eventId: e.id, name: e.name, who: eventWho(e) });
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
            eventId: x.event.id, name: x.event.name, ts: x.ts, uncertain: x.uncertain, who: x.who,
            points, count, watching: endMs > nowMs, hoursLeft: Math.max(0, (endMs - nowMs) / HOUR),
          };
        })
        .reverse();
      return { phase, day: phaseDay(phase, now), exposures };
    });
}

// ---- where things stand ----------------------------------------------------------
// Symptom tracking begins with the first symptom entry. The days before it
// hold food but say nothing about symptoms, so every comparison starts there.
// A day with nothing logged at all counts for neither side of anything.

export function trackingStart(state) {
  let first = null;
  for (const e of state.symptomLog) if (isTs(e.ts) && (first === null || e.ts < first)) first = e.ts;
  return first && dayKey(first);
}

// Days from fromDay through toDay with any entry, each with its symptom load.
// A day with food logged and no symptom is a quiet day, load 0.
function loggedDays(state, fromDay, toDay) {
  const days = new Map();
  for (const e of state.foodLog) {
    if (!isTs(e.ts)) continue;
    const d = dayKey(e.ts);
    if (d >= fromDay && d <= toDay && !days.has(d)) days.set(d, 0);
  }
  for (const [d, entries] of bucketByDay(state.symptomLog)) {
    if (d >= fromDay && d <= toDay) days.set(d, dayLoad(entries, d).load);
  }
  return days;
}

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

// What is out (and back) right now and since when, and how the range has gone
// in her own terms: days with entries since tracking began, and how many of
// them had a symptom logged. No comparison with anything.
//   { out: [{ phase, tag, startDay, day }], back: [...], trackingStart, from, days, symptomDays }
export function statusNow(state, { fromDay, today }) {
  const now = `${today}T23:59`;
  const live = [...state.phases].filter((p) => isTs(p.start) && isPhaseActive(p, now)).sort(byStart)
    .map((p) => ({ phase: p, tag: p.tag, startDay: dayKey(p.start), day: phaseDay(p, now) }));
  const start = trackingStart(state);
  const from = start && start > fromDay ? start : fromDay;
  const days = start ? loggedDays(state, from, today) : new Map();
  const symptomDays = bucketByDay(state.symptomLog);
  let withSymptoms = 0;
  for (const d of days.keys()) if (symptomDays.has(d)) withSymptoms++;
  return {
    out: live.filter((p) => p.phase.kind === 'eliminate'),
    back: live.filter((p) => p.phase.kind === 'reintroduce'),
    trackingStart: start, from, days: days.size, symptomDays: withSymptoms,
  };
}

// ---- anything standing out ------------------------------------------------------------
// Every food through one pathway (an allergen tag, a picked food, or an older
// entry's name, all just foods here) by the days after it was eaten against
// the other days, from when symptom tracking began. Food proteins reach the
// milk within hours and clear within a day, but the reactions looked for here
// (mucus, loose stools, gas, eczema) arrive hours to days later, so each
// eating casts a shadow of SHADOW_DAYS days: the day it was eaten and the two
// after. The shadow days' symptom load, on average, against the load of the
// tracked days outside every shadow; a day counts once however many shadows
// overlap it, and both sides are days with entries. A food needs
// STANDOUT_MIN_EATEN days eaten and STANDOUT_MIN_NOT tracked days outside its
// shadow; a food eaten most days shadows nearly everything, has too few days
// outside to compare against, and is listed as such instead. Foods and tags
// she marked safe are left out. A food stands out when, for every time it was
// eaten, its own three days were heavier than the average day outside, and the
// shadow as a whole is heavier by STANDOUT_GAP load points or more, so one
// rough stretch can't carry a food on its own. The rule is fixed, not tuned to
// make rows appear: on most diaries nothing stands out, and that is a real
// answer. Two names with exactly the same eaten days (a tag and its food, or
// two foods always eaten together) are one row naming both.
//   row: { key, kind, label, id?, also: [{ kind, label, id? }], who, eatenDays, afterDays, notDays,
//          avgAfter, avgNot, gap, heavier, dates: [{ day, load, possible }], after: [{ day, load, eaten }] }
export const SHADOW_DAYS = 3;
export const STANDOUT_MIN_EATEN = 3;
export const STANDOUT_MIN_NOT = 5;
export const STANDOUT_GAP = 2;       // load points between the two averages
export const STANDOUT_LIMIT = 3;

// The tracked days a food eaten on `eatenDays` casts its shadow over, each once.
function shadowOf(eatenDays, days) {
  const shadow = new Map();
  for (const d of eatenDays) {
    for (let k = 0; k < SHADOW_DAYS; k++) {
      const dd = addDays(d, k);
      if (days.has(dd) && !shadow.has(dd)) shadow.set(dd, { day: dd, load: days.get(dd), eaten: false });
    }
  }
  for (const d of eatenDays) if (shadow.has(d)) shadow.get(d).eaten = true;
  return [...shadow.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

const safeTagsOf = (state) => new Set((state.settings && state.settings.safeTags) || []);

// The groups one entry counts toward: its tags (safe ones skipped), its foods
// (safe ones skipped), or its name when it predates picked foods.
function entryGroups(state, e, safeTags) {
  const out = [];
  const tags = [...new Set(e.tags || [])];
  const maybe = [...new Set((e.uncertain || []).filter((t) => !tags.includes(t)))];
  for (const t of [...tags, ...maybe]) if (!safeTags.has(t)) out.push({ key: `tag:${t}`, kind: 'tag', label: t, possible: maybe.includes(t) });
  const items = hasItems(e) ? resolveItems(state.foodItems, e.items) : [];
  for (const it of items) if (!it.safe) out.push({ key: `food:${it.id}`, kind: 'food', label: it.label, id: it.id, possible: false });
  if (!items.length && normName(e.name || '')) out.push({ key: `name:${normName(e.name)}`, kind: 'name', label: String(e.name).trim(), possible: false });
  return out;
}

const KIND_ORDER = { tag: 0, food: 1, name: 2 };

export function standingOut(state, { fromDay, today, who }) {
  const start = trackingStart(state);
  const from = start && start > fromDay ? start : fromDay;
  const base = { who, from, trackingStart: start, loggedDays: 0, enough: false, usual: 0, standing: [], everyday: [], compared: 0, rows: [] };
  if (!start || from > today) return base;
  const days = loggedDays(state, from, today);
  const safeTags = safeTagsOf(state);
  const groups = new Map();
  for (const e of state.foodLog) {
    if (!isTs(e.ts) || eventWho(e) !== who) continue;
    const d = dayKey(e.ts);
    if (d < from || d > today) continue;
    for (const g of entryGroups(state, e, safeTags)) {
      if (!groups.has(g.key)) groups.set(g.key, { key: g.key, kind: g.kind, label: g.label, id: g.id, days: new Map() });
      const grp = groups.get(g.key);
      // A day is only "possibly" when every entry that day was.
      grp.days.set(d, grp.days.has(d) ? grp.days.get(d) && g.possible : g.possible);
    }
  }
  const rows = [];
  for (const g of groups.values()) {
    const eaten = [...g.days.keys()].sort();
    const dates = eaten.map((day) => ({ day, load: days.get(day) || 0, possible: g.days.get(day) }));
    const after = shadowOf(eaten, days);
    const shadowed = new Set(after.map((d) => d.day));
    const notLoads = [...days].filter(([day]) => !shadowed.has(day)).map(([, load]) => load);
    const avgAfter = avg(after.map((d) => d.load)), avgNot = avg(notLoads);
    // Each eating on its own: its day and the two after, against the days outside.
    const heavier = eaten.filter((d) => avg(shadowOf([d], days).map((x) => x.load)) > avgNot).length;
    rows.push({
      key: g.key, kind: g.kind, label: g.label, id: g.id, also: [], who,
      eatenDays: dates.length, afterDays: after.length, notDays: notLoads.length, avgAfter, avgNot, gap: avgAfter - avgNot,
      heavier, dates, after,
    });
  }
  // The same days under two names are one thing.
  rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
  const bySig = new Map();
  const kept = [];
  for (const r of rows) {
    const sig = r.dates.map((d) => d.day).join(',');
    const same = bySig.get(sig);
    if (same) same.also.push({ kind: r.kind, label: r.label, ...(r.id ? { id: r.id } : {}) });
    else { bySig.set(sig, r); kept.push(r); }
  }
  const enough = days.size >= STANDOUT_MIN_EATEN + STANDOUT_MIN_NOT;
  const compared = kept.filter((r) => r.eatenDays >= STANDOUT_MIN_EATEN && r.notDays >= STANDOUT_MIN_NOT);
  const everyday = enough ? kept.filter((r) => r.notDays < STANDOUT_MIN_NOT).sort((a, b) => b.eatenDays - a.eatenDays || a.label.localeCompare(b.label)) : [];
  const standing = compared.filter((r) => r.gap >= STANDOUT_GAP && r.heavier === r.eatenDays)
    .sort((a, b) => b.gap - a.gap || b.eatenDays - a.eatenDays || a.label.localeCompare(b.label))
    .slice(0, STANDOUT_LIMIT);
  return { ...base, loggedDays: days.size, enough, usual: avg([...days.values()]), standing, everyday, compared: compared.length, rows: kept };
}

// ---- new foods -------------------------------------------------------------------
// Foods eaten for the first time in range, from when symptom tracking began,
// each with the symptom load of that day and the two after (the same shadow
// as above) against the other days in range. An observation about one
// occasion: never ranked, never part of what stands out. Safe foods are left
// out here too; tags are not foods here.
//   { key, kind, label, id?, day, load, next: [{ day, load (null when nothing was logged), pending }], otherDays, others }
export function newFoods(state, { fromDay, today, who }) {
  const start = trackingStart(state);
  const from = start && start > fromDay ? start : fromDay;
  if (!start || from > today) return [];
  const days = loggedDays(state, from, today);
  const safeTags = safeTagsOf(state);
  const firstDay = new Map();
  const log = state.foodLog.filter((e) => isTs(e.ts) && eventWho(e) === who).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  for (const e of log) {
    for (const g of entryGroups(state, e, safeTags)) {
      if (g.kind !== 'tag' && !firstDay.has(g.key)) firstDay.set(g.key, { key: g.key, kind: g.kind, label: g.label, id: g.id, day: dayKey(e.ts) });
    }
  }
  const out = [];
  for (const f of firstDay.values()) {
    if (f.day < from || f.day > today) continue;
    const next = [];
    for (let k = 1; k < SHADOW_DAYS; k++) {
      const d = addDays(f.day, k);
      next.push({ day: d, load: days.has(d) ? days.get(d) : null, pending: d >= today });
    }
    const span = new Set([f.day, ...next.map((n) => n.day)]);
    const others = [...days].filter(([d]) => !span.has(d)).map(([, load]) => load);
    out.push({ ...f, load: days.get(f.day) || 0, next, otherDays: others.length, others: avg(others) });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.label.localeCompare(b.label)));
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
  return (state.foodItems || []).some(onMeal) || state.meals.some(onMeal) || state.foodLog.some(onMeal) || state.phases.some((p) => p.tag === id);
}

// ---- backups -----------------------------------------------------------------

// Merges an imported diary into the current one, matching entries by id.
// Anything the current diary lacks is added; on a clash the current copy wins,
// so importing an older backup can never undo edits made since. Returns a new
// state (inputs untouched) and how many of each were added.
// Foods match by id first, then by label: a food in the backup named like one
// already here is taken as that food, and the backup's entries and meals are
// pointed at it (on the incoming copies only), so a restore never doubles a food.
export function mergeStates(current, incoming) {
  const out = { ...current, settings: { ...current.settings } };
  const added = {};
  const mineFoods = current.foodItems || [];
  const foodIds = new Set(mineFoods.map((it) => it.id));
  const byLabel = new Map(mineFoods.filter((it) => !it.mergedInto).map((it) => [normName(it.label), it.id]));
  const remap = new Map();
  const newFoods = [];
  for (const it of incoming.foodItems || []) {
    if (!isObj(it) || it.id == null || foodIds.has(it.id)) continue;
    const same = !it.mergedInto && byLabel.get(normName(it.label));
    if (same) { remap.set(it.id, same); continue; }
    newFoods.push(it);
    foodIds.add(it.id);
    if (!it.mergedInto) byLabel.set(normName(it.label), it.id);
  }
  const mapIds = (ids) => [...new Set(ids.map((id) => remap.get(id) || id))];
  const pointed = (list) => (list || []).map((x) => (isObj(x) && Array.isArray(x.items) ? { ...x, items: mapIds(x.items) } : x));
  const theirsBy = {
    foodItems: newFoods.map((it) => (remap.has(it.mergedInto) ? { ...it, mergedInto: remap.get(it.mergedInto) } : it)),
    meals: pointed(incoming.meals),
    foodLog: pointed(incoming.foodLog),
  };
  for (const k of ['foodItems', 'meals', 'foodLog', 'symptomLog', 'phases', 'symptomSets']) {
    const mine = current[k] || [], theirs = theirsBy[k] || incoming[k] || [];
    const have = new Set(mine.map((x) => x.id));
    const extra = theirs.filter((x) => isObj(x) && x.id != null && !have.has(x.id));
    added[k] = extra.length;
    out[k] = [...mine, ...extra];
  }
  const customIds = new Set(current.settings.customTags.map((t) => t.id));
  out.settings.customTags = [...current.settings.customTags,
    ...incoming.settings.customTags.filter((t) => isObj(t) && t.id && !customIds.has(t.id))];
  out.settings.hiddenTags = [...new Set([...current.settings.hiddenTags, ...incoming.settings.hiddenTags])];
  out.settings.safeTags = [...new Set([...(current.settings.safeTags || []), ...(incoming.settings.safeTags || [])])];
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
// Names typed on a phone can run past the text box's limit (pasted, dictated),
// so a restore keeps them whole up to a generous bound instead of cutting them.
const NAME_MAX = 300;
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

  const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const foodItems = keep(s.foodItems || [], (it) => {
    const label = text(it.label, NAME_MAX).trim();
    if (!label) return null;
    const tags = tagList(it.tags);
    const out = {
      ...it, label, tags, uncertain: tagList(it.uncertain).filter((t) => !tags.includes(t)),
      useCount: count(it.useCount), lastUsed: isTs(it.lastUsed) ? it.lastUsed : null, reviewed: it.reviewed === true,
    };
    if (it.hidden === true) out.hidden = true; else delete out.hidden;
    if (it.safe === true) out.safe = true; else delete out.safe;
    if (typeof it.mergedInto === 'string' && SAFE_ID.test(it.mergedInto) && it.mergedInto !== it.id) out.mergedInto = it.mergedInto;
    else delete out.mergedInto;
    return out;
  });
  // A merge has to land on a food that exists, and never go in a circle.
  const foodIds = new Set(foodItems.map((it) => it.id));
  for (const it of foodItems) if (it.mergedInto && !foodIds.has(it.mergedInto)) delete it.mergedInto;
  const resolve = itemResolver(foodItems);
  for (const it of foodItems) if (resolve(it.id)?.mergedInto) delete resolve(it.id).mergedInto;
  const foodRefs = (v) => (Array.isArray(v) ? [...new Set(v.filter((id) => typeof id === 'string' && foodIds.has(id)))] : []);

  // A saved meal needs at least one food. Allergens kept on a meal (from the
  // update) stay only if they're safe tags.
  const meals = keep(s.meals, (m) => {
    const name = text(m.name, NAME_MAX).trim();
    const items = foodRefs(m.items);
    if (!name || !items.length) return null;
    const tags = tagList(m.tags);
    const out = {
      ...m, name, items, tags, uncertain: tagList(m.uncertain).filter((t) => !tags.includes(t)),
      useCount: count(m.useCount), lastUsed: isTs(m.lastUsed) ? m.lastUsed : null,
    };
    if (!out.tags.length && !out.uncertain.length) { delete out.tags; delete out.uncertain; }
    return out;
  });

  const foodLog = keep(s.foodLog, (e) => {
    if (!isTs(e.ts)) return null;
    const tags = tagList(e.tags);
    return {
      ...e, name: text(e.name, NAME_MAX).trim() || 'Food', tags, uncertain: tagList(e.uncertain).filter((t) => !tags.includes(t)),
      mealId: typeof e.mealId === 'string' && SAFE_ID.test(e.mealId) ? e.mealId : null, note: text(e.note),
      who: eventWho(e),   // entries from before solids carry none, and mean the parent
      items: foodRefs(e.items),   // picked foods; none means an older entry, read by its name
    };
  }).map((e) => {
    if (!e.items.length) delete e.items;
    return e;
  });

  const symptomLog = keep(s.symptomLog, (e) => {
    if (!isTs(e.ts) || !SYMPTOM_CATS.includes(e.cat)) return null;
    const fixed = { ...e, flags: tagList(e.flags).filter((f) => (CAT_FLAGS[e.cat] || []).includes(f)), note: text(e.note) };
    // Color and count belong to stools; anything unknown or out of range goes.
    if (e.cat !== 'stool' || !STOOL_COLORS.includes(e.color)) delete fixed.color;
    if (e.cat !== 'stool' || !(Number.isInteger(e.count) && e.count > 1 && e.count <= MAX_STOOL_COUNT)) delete fixed.count;
    if (e.cat === 'stool' && Object.hasOwn(STOOL_SEVERITY, e.consistency)) {
      fixed.severity = STOOL_SEVERITY[e.consistency];
      return fixed;
    }
    delete fixed.consistency;
    return [1, 2, 3].includes(e.severity) ? fixed : null;
  });

  // A set keeps only items that could be logged (one per category, notes
  // never stored); a set left with none is dropped.
  const symptomSets = keep(s.symptomSets || [], (set) => {
    const name = text(set.name, 60).trim();
    if (!name || !Array.isArray(set.items)) return null;
    const cats = new Set();
    const items = [];
    for (const it of set.items) {
      if (!isObj(it) || cats.has(it.cat)) continue;
      const draft = { cat: it.cat, severity: it.severity, consistency: it.consistency, color: it.color, flags: tagList(it.flags) };
      if (symptomMissing(draft)) continue;
      cats.add(it.cat);
      items.push(setItem(draft));
    }
    if (!items.length) return null;
    return {
      ...set, name, items,
      useCount: Number.isFinite(set.useCount) && set.useCount > 0 ? Math.floor(set.useCount) : 0,
      lastUsed: isTs(set.lastUsed) ? set.lastUsed : null,
    };
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
      settings: { ...s.settings, customTags, hiddenTags: tagList(s.settings.hiddenTags), safeTags: tagList(s.settings.safeTags) },
      foodItems, meals, foodLog, symptomLog, symptomSets, phases,
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
      windowHours: 24,        // from earlier builds; nothing reads it now
      directWindowHours: 4,   // from earlier builds; nothing reads it now
      customTags: [],   // [{ id, label }], id slugified from label
      hiddenTags: [],   // tag ids hidden from pickers, never deleted
      safeTags: [],     // allergen tags she marked safe: left out of Trends' comparisons
    },
    foodItems: [],      // [Food], see the foods section: the picker's list, grown as she logs
    meals: [],          // [{ id, name, items: [foodId], useCount, lastUsed, tags?, uncertain? }]: named bundles of foods
    foodLog: [],        // entries carry items: [foodId] when logged from picked foods
    symptomLog: [],
    symptomSets: [],    // [{ id, name, items: [{ cat, severity, flags, consistency?, color? }], useCount, lastUsed }]: one tap fills the symptom sheet
    phases: [],
    dismissed: [],      // exposure banner keys ("eventId:tag") the parent closed
    lastBackup: null,   // timestamp of the last export
    foodReviewDone: false, // the Today card for foods to review: dismissed, or every food reviewed
    backupSnoozed: null, // when the parent last tapped "Later" on the backup reminder
  };
}

// Version 1 to 2: food becomes picked foods. Every saved meal is split into
// foods at its commas (splitMealName), each distinct food once, unreviewed,
// with the meal's use count. A meal that is a single food hands that food its
// allergens; a meal of several foods keeps its allergens on the meal, since
// which food held the egg isn't knowable. Meals become bundles of their foods.
// Logged entries keep their name, tags, and note untouched; an entry whose
// name matches a saved meal's name, ignoring case and spacing (the old app
// logged "miso soup" against a saved "Miso soup" as the same meal), gains a
// link to that meal's foods,
// and the rest stay as older entries.
export function migrate1to2(s) {
  const strs = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : []);
  const byLabel = new Map();   // normalized label -> food
  const ids = new Set((Array.isArray(s.foodItems) ? s.foodItems : []).filter(isObj).map((it) => it.id));
  const foodFor = (label) => {
    const key = normName(label);
    let it = byLabel.get(key);
    if (!it) {
      let id = labelId(label);
      for (let n = 2; ids.has(id); n++) id = `${labelId(label)}-${n}`;
      ids.add(id);
      it = { id, label, tags: [], uncertain: [], useCount: 0, lastUsed: null, reviewed: false };
      byLabel.set(key, it);
    }
    return it;
  };
  const byName = new Map();    // normalized meal name -> its foods' ids
  const meals = (Array.isArray(s.meals) ? s.meals : []).map((m) => {
    if (!isObj(m) || typeof m.name !== 'string' || !splitMealName(m.name).length) return m;
    const tags = strs(m.tags), uncertain = strs(m.uncertain).filter((t) => !tags.includes(t));
    const foods = [...new Set(splitMealName(m.name).map(foodFor))];
    for (const it of foods) {
      it.useCount += Number.isFinite(m.useCount) && m.useCount > 0 ? Math.floor(m.useCount) : 0;
      it.lastUsed = later(it.lastUsed, m.lastUsed);
    }
    const { tags: _t, uncertain: _u, ...rest } = m;
    const out = { ...rest, items: foods.map((it) => it.id) };
    if (foods.length === 1) {
      Object.assign(foods[0], itemTags([foods[0], { tags, uncertain }]));
    } else if (tags.length || uncertain.length) {
      Object.assign(out, { tags, uncertain });
    }
    if (!byName.has(normName(m.name))) byName.set(normName(m.name), out.items);
    return out;
  });
  const foodLog = (Array.isArray(s.foodLog) ? s.foodLog : []).map((e) =>
    (isObj(e) && typeof e.name === 'string' && byName.has(normName(e.name)) && !Array.isArray(e.items) ? { ...e, items: [...byName.get(normName(e.name))] } : e));
  return { ...s, foodItems: [...(Array.isArray(s.foodItems) ? s.foodItems : []), ...byLabel.values()], meals, foodLog };
}

// Upgrades from version k to k+1, keyed by k. Migrations are additive: they
// add or reshape fields and never drop diary entries.
const MIGRATIONS = { 1: migrate1to2 };

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
  if (!DIRECT_WINDOW_CHOICES.includes(out.settings.directWindowHours)) {
    out.settings.directWindowHours = base.settings.directWindowHours;
  }
  for (const k of ['customTags', 'hiddenTags', 'safeTags']) {
    if (!Array.isArray(out.settings[k])) out.settings[k] = [];
  }
  for (const k of ['foodItems', 'meals', 'foodLog', 'symptomLog', 'symptomSets', 'phases', 'dismissed']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (typeof out.babyName !== 'string') out.babyName = '';
  if (out.lastBackup != null && !isTs(out.lastBackup)) out.lastBackup = null;
  out.foodReviewDone = out.foodReviewDone === true;
  if (out.backupSnoozed != null && !isTs(out.backupSnoozed)) out.backupSnoozed = null;
  // A diary that already holds entries has clearly been set up.
  out.onboarded = out.onboarded === true ||
    out.foodLog.length + out.symptomLog.length + out.phases.length > 0;
  return out;
}
