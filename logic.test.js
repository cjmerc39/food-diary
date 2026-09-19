// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';

// Pinned to a US zone with DST so 23h and 25h days behave the same on every
// machine. Safe to set after the import: logic.js creates no Dates on load.
process.env.TZ = 'America/New_York';

const food = (id, ts, tags = [], uncertain = []) => ({ id, ts, mealId: null, name: id, tags, uncertain, note: '' });
const sym = (id, ts, cat, severity, flags = [], extra = {}) => ({ id, ts, cat, severity, flags, note: '', ...extra });
const phase = (start, end = null, extra = {}) =>
  ({ id: `${extra.tag || 'dairy'}-${start}`, kind: 'eliminate', tag: 'dairy', start, end, note: '', ...extra });
const diary = (over = {}) => ({ ...L.freshState(), onboarded: true, ...over });
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- time --------------------------------------------------------------------

test('toLocalISO and parseLocal round-trip local wall-clock time', () => {
  const d = new Date(2026, 8, 13, 14, 30);
  assert.equal(L.toLocalISO(d), '2026-09-13T14:30');
  assert.equal(L.parseLocal('2026-09-13T14:30').getTime(), d.getTime());
  assert.equal(L.parseLocal('2026-09-13').getHours(), 0);
  assert.equal(L.parseLocal('13/09/2026'), null);
  assert.equal(L.parseLocal(null), null);
});

test('isTs accepts only the full diary timestamp shape', () => {
  assert.equal(L.isTs('2026-09-13T14:30'), true);
  assert.equal(L.isTs('2026-09-13'), false);
  assert.equal(L.isTs('2026-09-13T14:30:00'), false);
  assert.equal(L.isTs('2026-09-13T14:30Z'), false);
  assert.equal(L.isTs(20260913), false);
});

test('day math is calendar math, unaffected by DST', () => {
  // US clocks spring forward 2026-03-08 and fall back 2026-11-01.
  assert.equal(L.addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(L.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(L.addDays('2026-10-31', 2), '2026-11-02');
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(L.daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(L.daysBetween('2026-11-02', '2026-10-31'), -2);
  assert.equal(L.dayKey('2026-11-01T01:30'), '2026-11-01');
});

test('hour math counts real elapsed hours, so DST days are 23h and 25h', () => {
  assert.equal(L.hoursBetween('2026-03-08T00:00', '2026-03-09T00:00'), 23);
  assert.equal(L.hoursBetween('2026-11-01T00:00', '2026-11-02T00:00'), 25);
  assert.equal(L.hoursBetween('2026-09-13T08:00', '2026-09-13T14:30'), 6.5);
  assert.equal(L.addHours('2026-03-07T12:00', 24), '2026-03-08T13:00');
  assert.equal(L.addHours('2026-09-13T14:30', -3), '2026-09-13T11:30');
});

// ---- phases ------------------------------------------------------------------

test('phaseDay counts the start day as day 1', () => {
  assert.equal(L.phaseDay(phase('2026-09-01T00:00'), '2026-09-01T09:00'), 1);
  assert.equal(L.phaseDay(phase('2026-09-01T00:00'), '2026-09-12T23:59'), 12);
  assert.equal(L.phaseDay(phase('2026-03-01T00:00'), '2026-03-15T08:00'), 15, 'spans DST without drifting');
});

test('phaseDay gives a closed phase its length and is 0 before the start', () => {
  // Ended on Aug 10 means Aug 10 was the first day off: Aug 1..9 is 9 days.
  assert.equal(L.phaseDay(phase('2026-08-01T00:00', '2026-08-10T00:00'), '2026-09-13T12:00'), 9);
  assert.equal(L.phaseDay(phase('2026-09-20T00:00'), '2026-09-13T12:00'), 0);
});

test('isPhaseActive covers open, closed, and upcoming phases', () => {
  const now = '2026-09-13T12:00';
  assert.equal(L.isPhaseActive(phase('2026-09-01T00:00'), now), true);
  assert.equal(L.isPhaseActive(phase('2026-09-01T00:00', '2026-09-14T00:00'), now), true);
  assert.equal(L.isPhaseActive(phase('2026-09-01T00:00', '2026-09-13T00:00'), now), false, 'end day is off the phase');
  assert.equal(L.isPhaseActive(phase('2026-09-20T00:00'), now), false);
});

test('sortPhases puts active first, then upcoming, then closed, newest start first', () => {
  const now = '2026-09-13T12:00';
  const list = [
    phase('2026-07-01T00:00', '2026-07-20T00:00'),
    phase('2026-08-20T00:00'),
    phase('2026-09-30T00:00'),
    phase('2026-09-01T00:00'),
    phase('2026-08-01T00:00', '2026-08-15T00:00'),
  ];
  assert.deepEqual(L.sortPhases(list, now).map((p) => p.start), [
    '2026-09-01T00:00', '2026-08-20T00:00', '2026-09-30T00:00',
    '2026-08-01T00:00', '2026-07-01T00:00',
  ]);
  assert.equal(list[0].start, '2026-07-01T00:00', 'input array is not mutated');
});

test('phasesToClose finds open-ended eliminations running when a reintroduction starts', () => {
  const open = phase('2026-08-20T00:00');
  const ownEnd = phase('2026-08-01T00:00', '2026-09-01T00:00');
  const soy = phase('2026-08-20T00:00', null, { tag: 'soy' });
  const reintro = phase('2026-08-25T00:00', null, { kind: 'reintroduce' });
  const phases = [open, ownEnd, soy, reintro];
  assert.deepEqual(L.phasesToClose(phases, 'dairy', '2026-09-13T00:00'), [open]);
  assert.deepEqual(L.phasesToClose(phases, 'dairy', '2026-08-10T00:00'), [],
    'a backfilled start leaves alone a phase with its own end date and one that had not begun');
  assert.deepEqual(L.phasesToClose(phases, 'egg', '2026-09-13T00:00'), []);
});

test('phaseBands clips phases to the range and ends each band the day before its end', () => {
  const phases = [
    phase('2026-08-20T00:00'),
    phase('2026-08-27T00:00', '2026-09-05T00:00', { tag: 'soy' }),
    phase('2026-09-10T00:00', null, { kind: 'reintroduce', tag: 'egg' }),
    phase('2026-07-01T00:00', '2026-08-01T00:00', { tag: 'wheat' }),
    phase('2026-09-20T00:00', null, { tag: 'corn' }),
    phase('2026-09-03T00:00', '2026-09-03T00:00', { tag: 'fish' }),
  ];
  const bands = L.phaseBands(phases, '2026-09-01', '2026-09-14');
  assert.deepEqual(bands.map(({ tag, kind, from, to, clippedStart, open }) => ({ tag, kind, from, to, clippedStart, open })), [
    { tag: 'dairy', kind: 'eliminate', from: '2026-09-01', to: '2026-09-14', clippedStart: true, open: true },
    { tag: 'soy', kind: 'eliminate', from: '2026-09-01', to: '2026-09-04', clippedStart: true, open: false },
    { tag: 'egg', kind: 'reintroduce', from: '2026-09-10', to: '2026-09-14', clippedStart: false, open: true },
  ]);
  assert.deepEqual(L.phaseBands([], '2026-09-01', '2026-09-14'), []);
});

// ---- tags and meals ----------------------------------------------------------

test('slugify makes stable ids from labels', () => {
  assert.equal(L.slugify('Tree nuts'), 'tree-nuts');
  assert.equal(L.slugify('Crème fraîche'), 'creme-fraiche');
  assert.equal(L.slugify('  Nightshades!! '), 'nightshades');
  assert.equal(L.slugify('Red dye #40'), 'red-dye-40');
  assert.equal(L.slugify('!!!'), '');
});

test('allTags lists starters then customs, and hidden tags stay resolvable', () => {
  const settings = {
    customTags: [{ id: 'millet', label: 'Millet' }, { id: 'dairy', label: 'Dupe' }, null],
    hiddenTags: ['corn', 'millet'],
  };
  const tags = L.allTags(settings);
  assert.equal(tags.length, 14);
  assert.deepEqual(tags[0], { id: 'dairy', label: 'Dairy', hidden: false });
  assert.deepEqual(tags[13], { id: 'millet', label: 'Millet', hidden: true });
  assert.equal(tags.find((t) => t.id === 'corn').hidden, true);
  assert.equal(L.tagLabel(settings, 'millet'), 'Millet');
  assert.equal(L.tagLabel(settings, 'mystery'), 'mystery');
  assert.equal(L.allTags(undefined).length, 13);
});

test('starter vocabulary includes oat', () => {
  assert.deepEqual(L.STARTER_TAGS.find((t) => t.id === 'oat'), { id: 'oat', label: 'Oat' });
  assert.equal(new Set(L.STARTER_TAGS.map((t) => t.id)).size, L.STARTER_TAGS.length, 'ids are unique');
});

test('standaloneHeight trusts the screen when running full screen, else the window', () => {
  const phone = { insetTop: 59, screenW: 393, screenH: 852, innerW: 393 };
  assert.equal(L.standaloneHeight({ ...phone, innerH: 787 }), 852, 'phantom toolbar made the window short');
  assert.equal(L.standaloneHeight({ ...phone, innerH: 917 }), 852, 'window reported past the screen');
  assert.equal(L.standaloneHeight({ ...phone, innerH: 852 }), 852);
  assert.equal(L.standaloneHeight({ insetTop: 0, screenW: 375, screenH: 667, innerW: 375, innerH: 647 }), 647, 'no inset: below the status bar');
  assert.equal(L.standaloneHeight({ insetTop: 24, screenW: 393, screenH: 852, innerW: 852, innerH: 393 }), 393, 'landscape');
  assert.equal(L.standaloneHeight({ insetTop: 24, screenW: 1024, screenH: 1366, innerW: 320, innerH: 900 }), 900, 'iPad split view keeps the window');
});

test('cycleTag goes off, contains, possibly hidden, off, and never holds a tag twice', () => {
  let d = { tags: [], uncertain: [] };
  d = L.cycleTag(d, 'dairy');
  assert.deepEqual(d, { tags: ['dairy'], uncertain: [] });
  assert.equal(L.tagState(d, 'dairy'), 'on');
  d = L.cycleTag(d, 'dairy');
  assert.deepEqual(d, { tags: [], uncertain: ['dairy'] });
  assert.equal(L.tagState(d, 'dairy'), 'maybe');
  d = L.cycleTag(d, 'dairy');
  assert.deepEqual(d, { tags: [], uncertain: [] });
  assert.equal(L.tagState(d, 'dairy'), 'off');
});

test('autoMealName and findMealByName', () => {
  assert.equal(L.autoMealName({}, ['dairy', 'soy'], ['egg']), 'Dairy, soy, possible egg');
  assert.equal(L.autoMealName({}, [], ['treenut']), 'Possible tree nuts');
  assert.equal(L.autoMealName({}, [], []), '');
  const meals = [{ id: 'm1', name: 'Pad  Thai' }];
  assert.equal(L.findMealByName(meals, ' pad thai ').id, 'm1');
  assert.equal(L.findMealByName(meals, ''), null);
  assert.equal(L.findMealByName(meals, 'pad'), null);
});

test('rankMeals weighs use count against weeks since last use', () => {
  const now = '2026-09-13T12:00';
  const meals = [
    { id: 'a', name: 'Oatmeal', useCount: 10, lastUsed: '2026-08-30T12:00' },  // 11 x 1/4 = 2.75
    { id: 'b', name: 'Pad thai', useCount: 1, lastUsed: '2026-09-13T12:00' },  // 2 x 1 = 2
    { id: 'c', name: 'Toast', useCount: 0, lastUsed: null },                   // about 0
    { id: 'd', name: 'Chili', useCount: 3, lastUsed: '2026-09-06T12:00' },     // 4 x 1/2 = 2
  ];
  assert.deepEqual(L.rankMeals(meals, now).map((m) => m.name), ['Oatmeal', 'Chili', 'Pad thai', 'Toast']);
  assert.equal(L.rankMeals(meals, now, 2).length, 2);
  assert.deepEqual(L.rankMeals([], now), []);
});

test('searchMeals ranks name starts, then word starts, then anywhere', () => {
  const meals = [
    { name: 'Pad thai', useCount: 1 }, { name: 'Thai curry', useCount: 0 },
    { name: 'Chicken parm', useCount: 5 }, { name: 'Parmesan pasta', useCount: 0 }, { name: 'Sparkling water', useCount: 9 },
  ];
  assert.deepEqual(L.searchMeals(meals, 'par').map((m) => m.name), ['Parmesan pasta', 'Chicken parm', 'Sparkling water']);
  assert.deepEqual(L.searchMeals(meals, 'THAI').map((m) => m.name), ['Thai curry', 'Pad thai']);
  assert.deepEqual(L.searchMeals(meals, '   '), []);
});

// ---- symptoms ----------------------------------------------------------------

test('symptomMissing says what a draft still needs', () => {
  assert.equal(L.symptomMissing({}), 'category');
  assert.equal(L.symptomMissing({ cat: 'stool' }), 'consistency');
  assert.equal(L.symptomMissing({ cat: 'stool', consistency: 'formed', flags: [] }), 'formed');
  assert.equal(L.symptomMissing({ cat: 'stool', consistency: 'formed', flags: ['blood'] }), '');
  assert.equal(L.symptomMissing({ cat: 'stool', consistency: 'loose', flags: [] }), '');
  assert.equal(L.symptomMissing({ cat: 'crying', severity: null }), 'severity');
  assert.equal(L.symptomMissing({ cat: 'resp', severity: 3 }), '');
});

test('symptomFields derives stool severity and keeps only offered flags', () => {
  assert.deepEqual(L.symptomFields({ cat: 'stool', consistency: 'loose', flags: ['hives', 'mucus'], note: '  runny ' }),
    { cat: 'stool', severity: 2, flags: ['mucus'], note: 'runny', consistency: 'loose' });
  assert.deepEqual(L.symptomFields({ cat: 'stool', consistency: 'formed', flags: ['blood'] }),
    { cat: 'stool', severity: 0, flags: ['blood'], note: '', consistency: 'formed' });
  assert.deepEqual(L.symptomFields({ cat: 'crying', severity: 2, flags: ['blood'], consistency: 'watery' }),
    { cat: 'crying', severity: 2, flags: [], note: '' });
});

test('flag points: severity plus 2 for blood, 1 for mucus, 2 for hives', () => {
  assert.equal(L.eventPoints(sym('a', '2026-09-05T08:00', 'stool', 2, ['blood', 'mucus'])), 5);
  assert.equal(L.eventPoints(sym('b', '2026-09-05T08:00', 'skin', 1, ['hives'])), 3);
  assert.equal(L.eventPoints(sym('c', '2026-09-05T08:00', 'stool', 0, ['blood'])), 2);
  assert.equal(L.eventPoints(sym('d', '2026-09-05T08:00', 'other', 3)), 3);
});

test('dayLoad takes the worst per category and counts each flag once a day', () => {
  const log = [
    sym('s1', '2026-09-05T07:00', 'stool', 2, ['blood']),
    sym('s2', '2026-09-05T15:00', 'stool', 3, ['blood', 'mucus']),
    sym('s3', '2026-09-05T09:00', 'crying', 2),
    sym('s4', '2026-09-05T21:00', 'crying', 1),
    sym('s5', '2026-09-05T10:00', 'skin', 1, ['hives']),
    sym('s6', '2026-09-05T11:00', 'other', 3),
    sym('s7', '2026-09-06T00:30', 'resp', 3),
  ];
  const d = L.dayLoad(log, '2026-09-05');
  assert.deepEqual(d.cats, { crying: 2, spitup: 0, stool: 3, skin: 1, resp: 0, gas: 0 });
  assert.deepEqual(d.flags, { blood: true, mucus: true, hives: true });
  assert.equal(d.load, 6 + 5, '"other" does not count toward load');
  assert.equal(L.dayLoad(log, '2026-09-07').load, 0);

  const worst = ['crying', 'spitup', 'stool', 'skin', 'resp'].map((c, i) =>
    sym(`w${i}`, '2026-09-08T12:00', c, 3, c === 'stool' ? ['blood', 'mucus'] : c === 'skin' ? ['hives'] : []));
  assert.equal(L.dayLoad(worst, '2026-09-08').load, 20, 'maximum is 20');
});

test('gas is a symptom category, charted per day but not part of the load', () => {
  assert.ok(L.SYMPTOM_CATS.includes('gas'));
  assert.ok(!L.LOAD_CATS.includes('gas') && L.DAY_CATS.includes('gas'));
  assert.equal(L.symptomMissing({ cat: 'gas', severity: null }), 'severity');
  assert.deepEqual(L.symptomFields({ cat: 'gas', severity: 3, flags: ['blood'], color: 'red', count: 4 }),
    { cat: 'gas', severity: 3, flags: [], note: '' }, 'no flags, color, or count off a stool');
  const log = [sym('g1', '2026-09-05T08:00', 'gas', 3), sym('c1', '2026-09-05T09:00', 'crying', 1)];
  const d = L.dayLoad(log, '2026-09-05');
  assert.equal(d.cats.gas, 3);
  assert.equal(d.load, 1, 'gas stays out of the 0 to 20 load');
  assert.equal(L.eventPoints(log[0]), 3, 'but its points count after a food, like any symptom');
});

test('stool color: stools only, no points, and a worrying color makes a formed stool loggable', () => {
  assert.deepEqual(L.symptomFields({ cat: 'stool', consistency: 'loose', color: 'green', flags: [] }),
    { cat: 'stool', severity: 2, flags: [], note: '', consistency: 'loose', color: 'green' });
  assert.equal('color' in L.symptomFields({ cat: 'stool', consistency: 'loose', color: 'purple' }), false);
  assert.equal(L.eventPoints({ cat: 'stool', severity: 2, flags: [], color: 'red' }), 2, 'color adds nothing');
  assert.equal(L.symptomMissing({ cat: 'stool', consistency: 'formed', flags: [], color: 'green' }), 'formed', 'green is normal');
  for (const color of L.CAUTION_COLORS) assert.equal(L.symptomMissing({ cat: 'stool', consistency: 'formed', flags: [], color }), '', color);
  assert.deepEqual(L.CAUTION_COLORS, ['red', 'black', 'pale']);
  assert.deepEqual(L.setItem({ cat: 'stool', consistency: 'hard', color: 'black', count: 3, flags: [], note: 'x' }),
    { cat: 'stool', severity: 1, flags: [], consistency: 'hard', color: 'black' }, 'a set keeps the color, not the count or note');
});

test('stool count: one entry for several diapers, shown in the daily load, scored as that many entries', () => {
  assert.equal('count' in L.symptomFields({ cat: 'stool', consistency: 'loose', count: 1 }), false, 'one is the default and is left off');
  assert.equal(L.symptomFields({ cat: 'stool', consistency: 'loose', count: 3 }).count, 3);
  assert.equal(L.symptomFields({ cat: 'stool', consistency: 'loose', count: 99 }).count, L.MAX_STOOL_COUNT);
  const log = [
    sym('a', '2026-09-05T07:00', 'stool', 2, ['mucus'], { consistency: 'loose', count: 3 }),
    sym('b', '2026-09-05T15:00', 'stool', 3, [], { consistency: 'watery' }),   // from before counts: one
    sym('c', '2026-09-05T16:00', 'crying', 2, [], { count: 5 }),              // a count means nothing off a stool
    sym('d', '2026-09-06T08:00', 'stool', 1, [], { consistency: 'hard', count: 2 }),
  ];
  const d = L.dayLoad(log, '2026-09-05');
  assert.equal(d.stools, 4);
  assert.equal(d.load, 3 + 2 + 1, 'the load still takes the worst stool once; the count shows beside it');
  assert.deepEqual(L.loadSeries(log, '2026-09-05', '2026-09-07').map((x) => x.stools), [4, 2, 0]);
  assert.equal(L.eventPoints(log[0]), 9, 'three loose stools with mucus score as three entries would');
  assert.equal(L.eventPoints(log[2]), 2);
  assert.equal(L.dayGlance(diary({ symptomLog: log }), '2026-09-05').stools, 4);
  const range = { from: '2026-09-01T00:00', to: '2026-09-08T00:00', windowHours: 24, now: '2026-09-10T00:00' };
  const foods = [food('f1', '2026-09-02T06:00', ['egg']), food('f2', '2026-09-04T06:00', ['egg'])];
  const one = L.suspects(diary({ foodLog: foods, symptomLog: [sym('x', '2026-09-02T09:00', 'stool', 2, [], { consistency: 'loose', count: 3 })] }), range);
  const three = L.suspects(diary({ foodLog: foods,
    symptomLog: [7, 8, 9].map((h) => sym(`x${h}`, `2026-09-02T0${h}:30`, 'stool', 2, [], { consistency: 'loose' })) }), range);
  assert.ok(one.ranked[0].ratio > 0 && near(one.ranked[0].ratio, three.ranked[0].ratio), 'one entry for three diapers scores like three entries');
});

test('restoring keeps stool colors and counts only where they make sense', () => {
  const r = L.readBackup(JSON.stringify({ ...L.freshState(), onboarded: true,
    symptomLog: [
      sym('a', '2026-09-12T10:00', 'stool', 2, [], { consistency: 'loose', color: 'pale', count: 4 }),
      sym('b', '2026-09-12T10:00', 'stool', 2, [], { consistency: 'loose', color: '<b>', count: 0 }),
      sym('c', '2026-09-12T10:00', 'stool', 2, [], { consistency: 'loose', count: 2.5 }),
      sym('d', '2026-09-12T10:00', 'stool', 2, [], { consistency: 'loose', count: 500 }),
      sym('e', '2026-09-12T10:00', 'crying', 2, [], { color: 'red', count: 3 }),
    ],
    symptomSets: [{ id: 't', name: 'Pale one', items: [{ cat: 'stool', severity: 0, flags: [], consistency: 'formed', color: 'pale', count: 3 }] }],
  }));
  assert.deepEqual(r.state.symptomLog.map((e) => [e.id, e.color, e.count]),
    [['a', 'pale', 4], ['b', undefined, undefined], ['c', undefined, undefined], ['d', undefined, undefined], ['e', undefined, undefined]]);
  assert.deepEqual(r.state.symptomSets[0].items, [{ cat: 'stool', severity: 0, flags: [], consistency: 'formed', color: 'pale' }],
    'a formed stool with a pale color is a loggable set item; the count is not kept');
  assert.equal(r.skipped, 0);
});

// ---- today -------------------------------------------------------------------

test('dayEntries interleaves one day, newest first', () => {
  const s = diary({
    foodLog: [food('f1', '2026-09-13T08:00'), food('f2', '2026-09-12T23:00'), food('f3', '2026-09-13T18:10')],
    symptomLog: [sym('s1', '2026-09-13T12:00', 'crying', 1), sym('s2', '2026-09-14T00:00', 'crying', 1)],
  });
  assert.deepEqual(L.dayEntries(s, '2026-09-13').map((r) => `${r.kind}:${r.e.id}`), ['food:f3', 'symptom:s1', 'food:f1']);
  assert.deepEqual(L.dayEntries(diary(), '2026-09-13'), []);
});

test('phasesOnDay lists what was running that day with its day number then', () => {
  const phases = [
    { ...phase('2026-08-20T00:00'), id: 'dairy' },
    { ...phase('2026-08-27T00:00', '2026-09-10T00:00', { tag: 'soy' }), id: 'soy' },
    { ...phase('2026-09-10T00:00', null, { kind: 'reintroduce', tag: 'egg' }), id: 'egg' },
    { ...phase('2026-09-20T00:00', null, { tag: 'corn' }), id: 'corn' },
  ];
  assert.deepEqual(L.phasesOnDay(phases, '2026-09-09').map((x) => [x.phase.id, x.day]), [['soy', 14], ['dairy', 21]]);
  assert.deepEqual(L.phasesOnDay(phases, '2026-09-10').map((x) => [x.phase.id, x.day]), [['egg', 1], ['dairy', 22]],
    'soy is off on its end day; egg starts');
  assert.deepEqual(L.phasesOnDay(phases, '2026-08-19'), []);
  assert.deepEqual(L.phasesOnDay([{ ...phase('2026-03-01T00:00'), id: 'p' }], '2026-03-15').map((x) => x.day), [15], 'spans DST');
});

test('dayGlance counts a day\'s entries and load', () => {
  const s = diary({
    phases: [{ ...phase('2026-09-01T00:00'), id: 'p1' }],
    foodLog: [food('f1', '2026-09-12T08:00', ['wheat']), food('f2', '2026-09-12T19:00'), food('f3', '2026-09-11T19:00')],
    symptomLog: [
      sym('s1', '2026-09-12T10:00', 'stool', 2, ['blood'], { consistency: 'loose' }),
      sym('s2', '2026-09-12T22:00', 'crying', 1),
    ],
  });
  const g = L.dayGlance(s, '2026-09-12');
  assert.deepEqual({ ...g, phases: g.phases.map((x) => [x.phase.id, x.day]) },
    { load: 5, stools: 1, entries: 4, food: 2, symptoms: 2, phases: [['p1', 12]] });
  assert.deepEqual(L.dayGlance(diary(), '2026-09-12'), { load: 0, stools: 0, entries: 0, food: 0, symptoms: 0, phases: [] });
});

test('dayRest keeps symptom days plain and still, and reads the clock today', () => {
  const today = (hour, entries = 0, symptoms = 0) => L.dayRest({ isToday: true, hour, entries, symptoms });
  const plainStill = { mark: 'default', line: null, still: true };
  assert.deepEqual(today(23), { mark: 'moon', line: 'today-empty', still: false });
  assert.equal(today(22).mark, 'moon');
  assert.equal(today(4).mark, 'moon');
  assert.equal(today(5).mark, 'sun');
  assert.equal(today(10).mark, 'sun');
  assert.equal(today(11).mark, 'default');
  assert.equal(today(21).mark, 'default');
  assert.deepEqual(today(14, 2), { mark: 'default', line: null, still: false }, 'food only: the mark settles, no line');
  assert.deepEqual(today(14, 3, 1), plainStill, 'beside symptom data: the plain mark at rest');
  assert.deepEqual(today(23, 3, 1), plainStill, 'no moon beside symptom data');
  assert.deepEqual(today(7, 1, 1), plainStill, 'no sun beside symptom data');
  const past = (entries, symptoms) => L.dayRest({ isToday: false, hour: 14, entries, symptoms });
  assert.deepEqual(past(0, 0), { mark: 'default', line: 'past-empty', still: false });
  assert.deepEqual(past(2, 0), { mark: 'leaf', line: 'no-symptoms', still: false });
  assert.deepEqual(past(4, 2), plainStill, 'no leaf beside symptom data');
});

test('welcomeVariant picks one of four entrances; the rise only in the moon or sun hours', () => {
  const at = (hour, random) => L.welcomeVariant(hour, random);
  assert.deepEqual(at(14, 0), { variant: 'drop', mark: 'default' });
  assert.deepEqual(at(14, 0.4), { variant: 'steam', mark: 'none' }, 'steam rises from the empty bowl');
  assert.deepEqual(at(14, 0.9), { variant: 'wobble', mark: 'none' });
  assert.deepEqual(at(14, 0.8), { variant: 'wobble', mark: 'none' }, 'an afternoon launch never rises');
  assert.deepEqual(at(23, 0.8), { variant: 'rise', mark: 'moon' });
  assert.deepEqual(at(22, 0.99), { variant: 'rise', mark: 'moon' });
  assert.deepEqual(at(4, 0.8), { variant: 'rise', mark: 'moon' });
  assert.deepEqual(at(5, 0.8), { variant: 'rise', mark: 'sun' });
  assert.deepEqual(at(7, 0.8), { variant: 'rise', mark: 'sun' });
  assert.deepEqual(at(10, 0.8), { variant: 'rise', mark: 'sun' });
  assert.deepEqual(at(11, 0.8), { variant: 'wobble', mark: 'none' }, '11am is past the sun hours');
  assert.deepEqual(at(21, 0.99), { variant: 'wobble', mark: 'none' });
  assert.deepEqual(at(23, 0.1), { variant: 'drop', mark: 'default' }, 'in the moon hours the other three still play');
  assert.equal(at(23, 1).variant, 'rise', 'a random of exactly 1 still lands in the pool');
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(L.welcomeVariant(23).variant);
  assert.deepEqual([...seen].sort(), ['drop', 'rise', 'steam', 'wobble'], 'over many launches every entrance turns up');
  for (let i = 0; i < 300; i++) assert.notEqual(L.welcomeVariant(14).variant, 'rise');
  assert.deepEqual([22, 4, 5, 10, 11, 21].map(L.skyMark), ['moon', 'moon', 'sun', 'sun', null, null]);
});

test('exposure banners: eaten during an elimination, last 72 hours, one per exposure', () => {
  const now = '2026-09-13T12:00';
  const s = diary({
    phases: [
      phase('2026-09-01T00:00'),
      phase('2026-08-01T00:00', '2026-09-01T00:00', { tag: 'soy' }),
      phase('2026-09-10T00:00', null, { kind: 'reintroduce', tag: 'egg' }),
    ],
    foodLog: [
      food('f1', '2026-09-12T18:10', [], ['dairy']),        // possible dairy: banner
      food('f2', '2026-09-12T19:00', ['soy']),              // soy elimination already over
      food('f3', '2026-09-10T11:00', ['dairy']),            // 73 hours ago
      food('f4', '2026-09-13T08:00', ['egg']),              // reintroduction, not elimination
      food('f5', '2026-09-13T09:00', ['dairy', 'soy']),     // dairy banner only
      food('f6', '2026-08-15T09:00', ['dairy']),            // long ago, before the phase
    ],
  });
  const banners = L.exposureBanners(s, now);
  assert.deepEqual(banners.map((b) => [b.key, b.uncertain]), [['f5:dairy', false], ['f1:dairy', true]]);
  assert.deepEqual(L.exposureBanners({ ...s, dismissed: ['f5:dairy'] }, now).map((b) => b.key), ['f1:dairy']);
  assert.deepEqual(L.exposureBanners(s, '2026-09-16T09:01').map((b) => b.key), [], 'expired after 72h');
  assert.deepEqual(L.exposureBanners(diary(), now), []);
});

test('pruneDismissed forgets banners whose food is gone or out of the window', () => {
  const s = diary({
    foodLog: [food('f5', '2026-09-13T09:00', ['dairy']), food('f3', '2026-09-09T10:00', ['dairy'])],
    dismissed: ['f5:dairy', 'f3:dairy', 'gone:dairy'],
  });
  assert.deepEqual(L.pruneDismissed(s, '2026-09-13T12:00'), ['f5:dairy']);
});

test('reintroduction watches tally points in the 72 hours after each exposure', () => {
  const now = '2026-09-13T12:00';
  const s = diary({
    phases: [phase('2026-09-10T00:00', null, { kind: 'reintroduce' }), phase('2026-08-01T00:00', '2026-09-10T00:00')],
    foodLog: [
      food('x0', '2026-09-09T18:00', ['dairy']),   // before the reintroduction
      food('x1', '2026-09-10T18:00', ['dairy']),
      food('x2', '2026-09-12T18:00', [], ['dairy']),
    ],
    symptomLog: [
      sym('s1', '2026-09-11T08:00', 'crying', 2),
      sym('s2', '2026-09-12T22:00', 'stool', 2, ['mucus'], { consistency: 'loose' }),
    ],
  });
  const [w] = L.reintroWatches(s, now);
  assert.equal(w.day, 4);
  assert.deepEqual(w.exposures.map((x) => [x.eventId, x.uncertain, x.points, x.count, x.watching]), [
    ['x2', true, 3, 1, true],
    ['x1', false, 5, 2, true],
  ]);
  assert.ok(near(w.exposures[0].hoursLeft, 54));
  assert.ok(near(w.exposures[1].hoursLeft, 6));
  const later = L.reintroWatches(s, '2026-09-16T12:00')[0].exposures;
  assert.deepEqual(later.map((x) => [x.watching, x.points]), [[false, 3], [false, 5]]);
  assert.deepEqual(L.reintroWatches(diary(), now), []);
});

// ---- suspects ----------------------------------------------------------------

const RANGE = { from: '2026-09-01T00:00', to: '2026-09-08T00:00', windowHours: 24, now: '2026-09-10T00:00' };

test('suspects on an empty diary', () => {
  const r = L.suspects(diary(), RANGE);
  assert.deepEqual(r.ranked, []);
  assert.deepEqual(r.notEnough, []);
  assert.equal(r.baseline, 0);
  assert.equal(r.totalPoints, 0);
  assert.equal(r.hours, 168);
});

test('suspects: a single exposure is not enough data yet', () => {
  const r = L.suspects(diary({
    foodLog: [food('f1', '2026-09-05T12:00', ['dairy'])],
    symptomLog: [sym('s1', '2026-09-05T20:00', 'crying', 2)],
  }), RANGE);
  assert.deepEqual(r.ranked, []);
  assert.deepEqual(r.notEnough, [{ tag: 'dairy', exposures: 1, possible: 0, watching: 0, complete: 1, weight: 1, followed: 1, days: 1, completeDays: 1 }]);
});

test('suspects: overlapping windows share events, ranked by ratio to baseline', () => {
  const r = L.suspects(diary({
    foodLog: [
      food('d1', '2026-09-03T08:00', ['dairy']),
      food('d2', '2026-09-03T14:00', ['dairy']),
      food('y1', '2026-09-06T06:00', ['soy']),
      food('y2', '2026-09-06T09:00', ['soy']),
    ],
    symptomLog: [
      sym('s1', '2026-09-03T18:00', 'stool', 2, [], { consistency: 'loose' }),  // in both dairy windows
      sym('s2', '2026-09-06T12:00', 'crying', 1),                                // in both soy windows
    ],
  }), RANGE);
  // The diary begins Sep 3, so the baseline covers Sep 3 to Sep 8: 120 hours.
  assert.equal(r.totalPoints, 3);
  assert.equal(r.hours, 120);
  assert.ok(near(r.baseline, (3 / 120) * 24));
  assert.deepEqual(r.ranked.map((x) => x.tag), ['dairy', 'soy']);
  const [dairy, soy] = r.ranked;
  assert.equal(dairy.followed, 2);
  assert.equal(dairy.complete, 2);
  assert.equal(dairy.meanAfter, 2);
  assert.ok(near(dairy.ratio, 2 / ((3 / 120) * 24)));
  assert.equal(soy.meanAfter, 1);
  assert.ok(near(soy.ratio, 1 / ((3 / 120) * 24)));
});

test('suspects: possibly-hidden exposures count at half weight', () => {
  const r = L.suspects(diary({
    foodLog: [
      food('e1', '2026-09-02T08:00', ['egg']),
      food('e2', '2026-09-04T08:00', [], ['egg']),
      food('e3', '2026-09-06T08:00', ['egg']),
      food('c1', '2026-09-03T08:00', [], ['citrus']),
      food('c2', '2026-09-05T08:00', [], ['citrus']),
    ],
    symptomLog: [sym('s1', '2026-09-02T10:00', 'crying', 3)],
  }), RANGE);
  const [egg] = r.ranked;
  assert.equal(egg.tag, 'egg');
  assert.equal(egg.weight, 2.5);
  assert.equal(egg.possible, 1);
  assert.equal(egg.followed, 1);
  assert.ok(near(egg.meanAfter, 3 / 2.5));
  assert.ok(near(egg.ratio, (3 / 2.5) / ((3 / 144) * 24)), 'the diary begins Sep 2: 144 hours');
  assert.deepEqual(r.notEnough.map((x) => [x.tag, x.weight]), [['citrus', 1]], 'two possible exposures weigh 1');
});

test('suspects: flag points count, and open windows are watched, not scored', () => {
  const r = L.suspects(diary({
    foodLog: [
      food('d1', '2026-09-02T08:00', ['dairy']),
      food('d2', '2026-09-04T08:00', ['dairy']),
      food('d3', '2026-09-09T12:00', ['dairy']),   // window still open at now
    ],
    symptomLog: [sym('s1', '2026-09-02T09:00', 'stool', 0, ['blood', 'mucus'], { consistency: 'formed' })],
  }), { ...RANGE, to: '2026-09-10T00:00' });
  const [dairy] = r.ranked;
  assert.equal(r.totalPoints, 3);
  assert.equal(dairy.exposures, 3);
  assert.equal(dairy.watching, 1);
  assert.equal(dairy.complete, 2);
  assert.equal(dairy.meanAfter, 1.5);
});

test('suspects: a range ending after now counts only the hours that have happened', () => {
  const r = L.suspects(diary({ symptomLog: [sym('s0', '2026-09-01T06:00', 'crying', 1), sym('s1', '2026-09-05T12:00', 'crying', 2)] }),
    { from: '2026-09-01T00:00', to: '2026-09-14T00:00', windowHours: 24, now: '2026-09-08T00:00' });
  assert.equal(r.hours, 168);
  assert.ok(near(r.baseline, (3 / 168) * 24));
});

test('suspects: a diary younger than the range only counts hours since its first entry', () => {
  const s = diary({
    foodLog: [food('d1', '2026-09-06T08:00', ['dairy']), food('d2', '2026-09-08T08:00', ['dairy'])],
    symptomLog: [sym('s1', '2026-09-06T12:00', 'crying', 2), sym('s2', '2026-09-08T12:00', 'crying', 2)],
  });
  const r = L.suspects(s, { from: '2026-08-17T00:00', to: '2026-09-13T12:00', windowHours: 24, now: '2026-09-13T12:00' });
  assert.equal(r.hours, 180, 'Sep 6 00:00 to Sep 13 12:00, not four weeks');
  assert.ok(near(r.ranked[0].ratio, 2 / ((4 / 180) * 24)));
});

test('suspects: no symptoms in range leaves the ratio empty instead of dividing by zero', () => {
  const r = L.suspects(diary({ foodLog: [food('a', '2026-09-02T08:00', ['corn']), food('b', '2026-09-03T08:00', ['corn'])] }), RANGE);
  assert.equal(r.ranked[0].ratio, null);
  assert.equal(r.ranked[0].meanAfter, 0);
});

// ---- two pathways: through breast milk, and the baby's own food ---------------

test('who: missing means the parent, and only baby means baby', () => {
  assert.equal(L.eventWho(food('f1', '2026-09-02T08:00')), 'parent');
  assert.equal(L.eventWho({ ...food('f1', '2026-09-02T08:00'), who: 'baby' }), 'baby');
  assert.equal(L.eventWho({ ...food('f1', '2026-09-02T08:00'), who: 'dog' }), 'parent');
  assert.equal(L.hasBabyFood(diary({ foodLog: [food('f1', '2026-09-02T08:00')] })), false);
  assert.equal(L.hasBabyFood(diary({ foodLog: [{ ...food('f1', '2026-09-02T08:00'), who: 'baby' }] })), true);
  assert.equal(L.freshState().settings.directWindowHours, 4);
  assert.equal(L.normalizeState({ v: 1 }).settings.directWindowHours, 4, 'a diary from before solids gains the default');
  assert.equal(L.normalizeState({ v: 1, settings: { directWindowHours: 3 } }).settings.directWindowHours, 4, 'off-list values fall back');
  assert.equal(L.normalizeState({ v: 1, settings: { directWindowHours: 8 } }).settings.directWindowHours, 8);
  const restored = L.readBackup(JSON.stringify({ ...L.freshState(), onboarded: true, foodLog: [
    food('old', '2026-09-02T08:00', ['dairy']),
    { ...food('b', '2026-09-02T09:00', ['dairy']), who: 'baby' },
    { ...food('odd', '2026-09-02T10:00', ['dairy']), who: 'grandma' },
  ] })).state.foodLog;
  assert.deepEqual(restored.map((e) => [e.id, e.who]), [['old', 'parent'], ['b', 'baby'], ['odd', 'parent']], 'old backups restore with who defaulted');
});

test('exposures, banners, and watches say who ate the food', () => {
  const now = '2026-09-13T12:00';
  const s = diary({
    phases: [phase('2026-09-01T00:00'), phase('2026-09-10T00:00', null, { kind: 'reintroduce', tag: 'egg' })],
    foodLog: [
      food('p1', '2026-09-13T08:00', ['dairy']),
      { ...food('b1', '2026-09-13T09:00', ['dairy']), who: 'baby' },
      { ...food('b2', '2026-09-12T09:00', ['egg']), who: 'baby' },
      food('p2', '2026-09-11T09:00', ['egg']),
    ],
    symptomLog: [sym('s1', '2026-09-12T11:00', 'skin', 2, ['hives'])],
  });
  assert.deepEqual(L.exposuresOf(s.foodLog, 'dairy').map((x) => [x.event.id, x.who]), [['p1', 'parent'], ['b1', 'baby']]);
  assert.deepEqual(L.exposuresOf(s.foodLog, 'dairy', 'baby').map((x) => x.event.id), ['b1']);
  assert.deepEqual(L.exposuresOf(s.foodLog, 'dairy', 'parent').map((x) => x.event.id), ['p1']);
  assert.deepEqual(L.exposureBanners(s, now).map((b) => [b.key, b.who]), [['b1:dairy', 'baby'], ['p1:dairy', 'parent']],
    "the baby eating an eliminated food raises a banner too, labeled");
  const [w] = L.reintroWatches(s, now);
  assert.deepEqual(w.exposures.map((x) => [x.eventId, x.who, x.points]), [['b2', 'baby', 4], ['p2', 'parent', 4]]);
});

test('suspects by pathway: each uses its own window and only its own exposures', () => {
  const s = diary({
    settings: { windowHours: 24, directWindowHours: 4, customTags: [], hiddenTags: [] },
    foodLog: [
      food('p1', '2026-09-02T08:00', ['dairy']),
      food('p2', '2026-09-04T08:00', ['dairy']),
      { ...food('b1', '2026-09-03T12:00', ['dairy']), who: 'baby' },
      { ...food('b2', '2026-09-05T12:00', ['dairy']), who: 'baby' },
      { ...food('b3', '2026-09-06T12:00', ['egg']), who: 'baby' },   // only the baby ever ate egg
    ],
    symptomLog: [
      sym('s1', '2026-09-02T18:00', 'crying', 2),   // 10h after p1: inside 24h, outside 4h
      sym('s2', '2026-09-03T13:00', 'crying', 1),   // 1h after b1
      sym('s3', '2026-09-05T13:00', 'crying', 3),   // 1h after b2
    ],
  });
  const range = { from: '2026-09-01T00:00', to: '2026-09-08T00:00', now: '2026-09-10T00:00' };
  const r = L.suspectsByPathway(s, { ...range, settings: s.settings });
  assert.equal(r.parent.windowHours, 24);
  assert.equal(r.baby.windowHours, 4);
  assert.equal(r.parent.who, 'parent');
  assert.equal(r.baby.who, 'baby');
  // The diary starts Sep 2: 144 hours to Sep 8, 6 points in all.
  assert.ok(near(r.parent.baseline, (6 / 144) * 24));
  assert.ok(near(r.baby.baseline, (6 / 144) * 4), 'the baseline is scaled to each window');
  const pd = r.parent.ranked.find((x) => x.tag === 'dairy');
  const bd = r.baby.ranked.find((x) => x.tag === 'dairy');
  assert.deepEqual([pd.exposures, pd.complete, pd.followed, pd.meanAfter], [2, 2, 1, 1], "only the parent's two exposures, only the 24h windows");
  assert.deepEqual([bd.exposures, bd.complete, bd.followed, bd.meanAfter], [2, 2, 2, 2], "only the baby's two exposures, only the 4h windows");
  assert.ok(near(pd.ratio, 1));
  assert.ok(near(bd.ratio, 2 / ((6 / 144) * 4)), 'the same tag scores differently per pathway');
  assert.equal([...r.parent.ranked, ...r.parent.notEnough].some((x) => x.tag === 'egg'), false, "egg never reached the milk");
  assert.deepEqual(r.baby.notEnough.map((x) => [x.tag, x.exposures]), [['egg', 1]]);
  const all = L.suspects(s, { ...range, windowHours: 24 });
  assert.equal(all.ranked.find((x) => x.tag === 'dairy').exposures, 4, 'without a pathway, every exposure counts together as before');
});

// ---- foods you've typed ------------------------------------------------------

const named = (id, ts, name, extra = {}) => ({ ...food(id, ts), name, ...extra });

test('textTerms: lowercase, no punctuation, singular, no filler, words and neighbor pairs', () => {
  const t = (s) => [...L.textTerms(s)].sort();
  assert.deepEqual(t("Chicken parm from Anthony's"), ['anthony', 'chicken', 'chicken parm', 'parm']);
  assert.deepEqual(t('Anthony’s meatballs'), ['anthony', 'anthony meatball', 'meatball'], 'the curly apostrophe iOS types');
  assert.equal(L.textTerms('Scrambled eggs'), L.textTerms('Scrambled eggs'), 'each distinct text is read once');
  assert.deepEqual(t('Scrambled EGGS!!'), ['egg', 'scrambled', 'scrambled egg']);
  assert.deepEqual(t('Crème brûlée'), ['brulee', 'creme', 'creme brulee']);
  assert.deepEqual(t('2 slices of toast, 1/2 cup berries'), ['berry', 'toast'], 'numbers and amounts go');
  assert.deepEqual(t(''), []);
  assert.deepEqual(t(null), []);
});

test('singular folds common plurals so a food meets itself', () => {
  const pairs = {
    eggs: 'egg', berries: 'berry', tomatoes: 'tomato', peaches: 'peach', sandwiches: 'sandwich', dishes: 'dish',
    cookies: 'cookie', fries: 'fry', oats: 'oat', cheeses: 'cheese', sauces: 'sauce', glasses: 'glass', peas: 'pea',
    kiwis: 'kiwi', loaves: 'loaf', hummus: 'hummus', couscous: 'couscous', citrus: 'citrus', swiss: 'swiss', gas: 'gas', egg: 'egg',
  };
  for (const [many, one] of Object.entries(pairs)) assert.equal(L.singular(many), one, many);
});

test('textTerms: pairs never cross punctuation or a dropped word, and stopwords never count', () => {
  const t = (s) => [...L.textTerms(s)].sort();
  assert.deepEqual(t('Mac and cheese, peanut butter toast'), ['butter', 'butter toast', 'cheese', 'mac', 'peanut', 'peanut butter', 'toast']);
  assert.deepEqual(t('Leftover lunch: a bowl of the soup with some rice'), ['rice', 'soup']);
  assert.deepEqual(t('possibly hidden dairy'), ['dairy']);
  assert.deepEqual(t('Snacks for breakfast'), []);
  for (const w of ['the', 'with', 'breakfast', 'cup', 'possibly']) assert.ok(L.STOPWORDS.has(w), w);
});

test('textTerms: food that was left out is not counted as eaten', () => {
  const t = (s) => [...L.textTerms(s)].sort();
  assert.deepEqual(t('Dairy-free yogurt'), ['yogurt']);
  assert.deepEqual(t('Pasta, no cheese'), ['pasta']);
  assert.deepEqual(t('Burger without the onions'), ['burger']);
  assert.deepEqual(t('Gluten free bread with oat milk'), ['bread', 'milk', 'oat', 'oat milk']);
});

test('foodTerms reads the name and the note, each term once, and skips names the app made up', () => {
  const settings = L.freshState().settings;
  assert.deepEqual(L.foodTerms(named('f', '2026-09-02T08:00', 'Oatmeal with banana', { note: 'extra banana, cinnamon' }), settings).sort(),
    ['banana', 'cinnamon', 'oatmeal']);
  assert.deepEqual(L.foodTerms({ ...food('g', '2026-09-02T08:00', ['dairy'], ['soy']), name: L.autoMealName(settings, ['dairy'], ['soy']) }, settings), [],
    'an entry logged by allergen alone typed no words');
  assert.deepEqual(L.foodTerms(named('h', '2026-09-02T08:00', 'Soup', { note: '' }), settings), ['soup']);
});

test('typed words need three finished exposures on three separate days', () => {
  const s = diary({
    foodLog: [
      named('a1', '2026-09-02T08:00', 'Toast'), named('a2', '2026-09-02T12:00', 'Toast'), named('a3', '2026-09-03T08:00', 'Toast'),   // three, on two days
      named('b1', '2026-09-02T08:00', 'Kale'), named('b2', '2026-09-04T08:00', 'Kale'), named('b3', '2026-09-09T12:00', 'Kale'),     // the third still inside its window
      named('c1', '2026-09-02T08:00', 'Rice'), named('c2', '2026-09-04T08:00', 'Rice'), named('c3', '2026-09-06T08:00', 'Rice'),
    ],
    symptomLog: [sym('s1', '2026-09-02T10:00', 'crying', 2)],
  });
  const range = { from: '2026-09-01T00:00', to: '2026-09-10T00:00', windowHours: 24, now: '2026-09-10T00:00', settings: s.settings };
  const r = L.termSuspects(s, range);
  assert.deepEqual(r.ranked.map((x) => x.term), ['rice']);
  const by = Object.fromEntries(r.notEnough.map((x) => [x.term, [x.exposures, x.days, x.complete, x.completeDays]]));
  assert.deepEqual(by.toast, [3, 2, 3, 2]);
  assert.deepEqual(by.kale, [3, 3, 2, 2]);
  assert.deepEqual(L.termSuspects(diary(), range).ranked, []);
});

test('typed words: only the top ten by ratio are listed', () => {
  const words = ['apple', 'bagel', 'carrot', 'date', 'endive', 'fig', 'grape', 'hummus', 'jam', 'kiwi', 'lentil', 'mango'];
  const foodLog = [];
  words.forEach((w, i) => [2, 3, 4].forEach((d) => foodLog.push(named(`${w}${d}`, `2026-09-0${d}T${String(i).padStart(2, '0')}:00`, w))));
  // Only the Sep 4 windows of words eaten from 6:00 on reach this symptom.
  const s = diary({ foodLog, symptomLog: [sym('s1', '2026-09-05T05:30', 'crying', 2)] });
  const r = L.termSuspects(s, { from: '2026-09-01T00:00', to: '2026-09-08T00:00', windowHours: 24, now: '2026-09-10T00:00', settings: s.settings });
  assert.equal(r.ranked.length, 10);
  assert.equal(r.more, 2);
  assert.deepEqual(r.ranked.map((x) => x.term), ['grape', 'hummus', 'jam', 'kiwi', 'lentil', 'mango', 'apple', 'bagel', 'carrot', 'date']);
});

test('typed words are scored per pathway with the same windows, baseline, and ratio as tags', () => {
  const s = diary({
    settings: { ...L.freshState().settings, windowHours: 24, directWindowHours: 4 },
    foodLog: [
      ...[2, 3, 4].map((d) => ({ ...named(`e${d}`, `2026-09-0${d}T08:00`, 'Scrambled eggs'), tags: ['egg'] })),
      ...[2, 3, 4].map((d) => named(`b${d}`, `2026-09-0${d}T09:30`, 'Mashed banana', { who: 'baby' })),
      ...[5, 6, 7].map((d) => named(`r${d}`, `2026-09-0${d}T08:00`, 'Rice', { note: 'no butter' })),
    ],
    symptomLog: [2, 3, 4].map((d) => ({ ...sym(`s${d}`, `2026-09-0${d}T10:00`, 'crying', 2), note: "after grandma's lasagna" })),
  });
  const range = { from: '2026-09-01T00:00', to: '2026-09-08T00:00', now: '2026-09-10T00:00', settings: s.settings };
  const words = L.termSuspectsByPathway(s, range);
  const tags = L.suspectsByPathway(s, range);
  assert.equal(words.parent.windowHours, 24);
  assert.equal(words.baby.windowHours, 4);
  assert.equal(words.parent.baseline, tags.parent.baseline, 'the same baseline as the tags');
  assert.equal(words.baby.baseline, tags.baby.baseline);
  const egg = words.parent.ranked.find((x) => x.term === 'egg');
  const eggTag = tags.parent.ranked.find((x) => x.tag === 'egg');
  assert.deepEqual([egg.exposures, egg.complete, egg.followed, egg.ratio], [eggTag.exposures, eggTag.complete, eggTag.followed, eggTag.ratio],
    'a word on the same meals as a tag scores exactly like it, and is listed rather than merged');
  assert.deepEqual(words.parent.ranked.map((x) => x.term).sort(), ['egg', 'rice', 'scrambled', 'scrambled egg']);
  assert.deepEqual(words.baby.ranked.map((x) => x.term).sort(), ['banana', 'mashed', 'mashed banana']);
  const banana = words.baby.ranked.find((x) => x.term === 'banana');
  assert.equal(banana.followed, 3, 'each inside the 4h window');
  assert.ok(near(banana.ratio, 2 / ((6 / 144) * 4)));
  const every = [...words.parent.ranked, ...words.parent.notEnough, ...words.baby.ranked, ...words.baby.notEnough].map((x) => x.term);
  assert.ok(!every.some((t) => /lasagna|grandma/.test(t)), 'symptom notes never count as food');
  assert.ok(!every.includes('butter'), '"no butter" was not eaten');
  assert.ok(![...words.parent.ranked, ...words.parent.notEnough].some((x) => x.term === 'banana'), "the baby's own food stays off the milk's list");
});

// ---- DST-adjacent days -------------------------------------------------------

test('DST: days bucket by local date and series never skip or repeat a day', () => {
  const log = [
    sym('a', '2026-03-08T01:30', 'crying', 1),
    sym('b', '2026-03-08T23:30', 'crying', 3),
    sym('c', '2026-11-01T01:30', 'skin', 2),
  ];
  assert.equal(L.dayLoad(log, '2026-03-08').load, 3);
  assert.deepEqual(L.loadSeries(log, '2026-10-31', '2026-11-02').map((d) => [d.day, d.load]),
    [['2026-10-31', 0], ['2026-11-01', 2], ['2026-11-02', 0]]);
  assert.equal(L.loadSeries(log, '2026-03-01', '2026-03-31').length, 31);
  assert.deepEqual([...L.bucketByDay(log).keys()], ['2026-03-08', '2026-11-01']);
});

test('DST: a 24h window after an exposure is 24 real hours across spring forward', () => {
  const log = [sym('in', '2026-03-08T12:30', 'crying', 2), sym('edge', '2026-03-08T13:00', 'crying', 1), sym('out', '2026-03-08T13:30', 'crying', 4)];
  const from = L.tsMs('2026-03-07T12:00');
  assert.deepEqual(L.symptomIndex(log).between(from, from + 24 * 3600000), { points: 3, count: 2 });
  const r = L.suspects(diary({
    foodLog: [food('d1', '2026-03-07T12:00', ['dairy']), food('d2', '2026-03-07T12:00', ['dairy'])],
    symptomLog: log,
  }), { from: '2026-03-08T00:00', to: '2026-03-09T00:00', windowHours: 24, now: '2026-03-20T00:00' });
  assert.equal(r.hours, 23, 'the spring-forward day has 23 hours');
});

// ---- trends and report -------------------------------------------------------

test('trendDays ends today and "all" starts at the first entry', () => {
  const s = diary({ foodLog: [food('f1', '2026-08-03T09:00')], symptomLog: [sym('s1', '2026-08-01T22:00', 'crying', 1)] });
  assert.deepEqual(L.trendDays(s, '2w', '2026-09-13'), { fromDay: '2026-08-31', toDay: '2026-09-13' });
  assert.deepEqual(L.trendDays(s, '8w', '2026-09-13'), { fromDay: '2026-07-20', toDay: '2026-09-13' });
  assert.deepEqual(L.trendDays(s, 'all', '2026-09-13'), { fromDay: '2026-08-01', toDay: '2026-09-13' });
  assert.deepEqual(L.trendDays(diary(), 'all', '2026-09-13'), { fromDay: '2026-09-13', toDay: '2026-09-13' });
  assert.equal(L.firstEntryDay(diary()), null);
});

test('trendSeries marks days before the first entry as no data', () => {
  const s = diary({ symptomLog: [sym('s1', '2026-09-11T10:00', 'stool', 2, ['blood'])] });
  const series = L.trendSeries(s, '2026-09-09', '2026-09-12');
  assert.deepEqual(series.map((d) => [d.day, d.hasData, d.load]), [
    ['2026-09-09', false, 0], ['2026-09-10', false, 0], ['2026-09-11', true, 4], ['2026-09-12', true, 0],
  ]);
});

test('phaseTagSlots assigns colors by each food\'s first phase and folds past the limit', () => {
  const phases = [
    phase('2026-09-10T00:00', null, { kind: 'reintroduce' }),
    phase('2026-08-27T00:00', null, { tag: 'soy' }),
    phase('2026-08-20T00:00'),
    phase('2026-09-01T00:00', null, { tag: 'egg' }),
  ];
  assert.deepEqual([...L.phaseTagSlots(phases)], [['dairy', 0], ['soy', 1], ['egg', 2]]);
  assert.deepEqual([...L.phaseTagSlots(phases, 2)], [['dairy', 0], ['soy', 1], ['egg', -1]]);
  assert.deepEqual([...L.phaseTagSlots([])], []);
});

test('rangeEntries lists a day range oldest first, food and symptoms together', () => {
  const s = diary({
    foodLog: [food('f1', '2026-09-12T08:00'), food('f2', '2026-09-10T23:59'), food('f3', '2026-09-14T00:00')],
    symptomLog: [sym('s1', '2026-09-11T12:00', 'crying', 1), sym('s2', '2026-09-13T23:59', 'skin', 1)],
  });
  assert.deepEqual(L.rangeEntries(s, '2026-09-11', '2026-09-13').map((r) => r.e.id), ['s1', 'f1', 's2']);
});

// ---- tags in settings --------------------------------------------------------

test('addCustomTag slugifies, and refuses blanks and duplicates', () => {
  const base = L.freshState().settings;
  const r = L.addCustomTag(base, '  Sesame  seeds ');
  assert.equal(r.id, 'sesame-seeds');
  assert.deepEqual(r.settings.customTags, [{ id: 'sesame-seeds', label: 'Sesame seeds' }]);
  assert.deepEqual(base.customTags, [], 'input settings untouched');
  assert.ok(L.addCustomTag(r.settings, 'sesame SEEDS').error.includes('already'));
  assert.ok(L.addCustomTag(base, 'Dairy').error.includes('Dairy'));
  assert.ok(L.addCustomTag(base, '!!!').error);
});

test('tagInUse looks at saved meals, entries, and phases', () => {
  const s = diary({
    meals: [{ id: 'm1', name: 'Toast', tags: ['wheat'], uncertain: ['sesame'], useCount: 1, lastUsed: null }],
    foodLog: [food('f1', '2026-09-12T08:00', [], ['corn'])],
    phases: [phase('2026-09-01T00:00', null, { tag: 'egg' })],
  });
  for (const id of ['wheat', 'sesame', 'corn', 'egg']) assert.equal(L.tagInUse(s, id), true, id);
  assert.equal(L.tagInUse(s, 'fish'), false);
});

// ---- backups -----------------------------------------------------------------

test('mergeStates adds what is missing and keeps the current copy on a clash', () => {
  const current = diary({
    babyName: '',
    settings: { windowHours: 48, customTags: [{ id: 'sesame', label: 'Sesame' }], hiddenTags: ['corn'] },
    foodLog: [food('f1', '2026-09-12T08:00', ['wheat'])],
    phases: [phase('2026-08-20T00:00')],
    dismissed: ['f1:wheat'],
    lastBackup: '2026-09-01T10:00',
  });
  const incoming = diary({
    babyName: 'Rowan',
    settings: { windowHours: 6, customTags: [{ id: 'sesame', label: 'Old label' }, { id: 'oats', label: 'Oats' }], hiddenTags: ['fish'] },
    foodLog: [food('f1', '2026-09-12T08:00', ['dairy']), food('f2', '2026-09-11T19:00', ['soy'])],
    symptomLog: [sym('s1', '2026-09-11T22:00', 'crying', 2)],
    meals: [{ id: 'm1', name: 'Toast', tags: [], uncertain: [], useCount: 3, lastUsed: null }],
    dismissed: ['f2:soy'],
    lastBackup: '2026-09-10T10:00',
  });
  const before = JSON.stringify(current);
  const { state: s, added } = L.mergeStates(current, incoming);
  assert.deepEqual(added, { meals: 1, foodLog: 1, symptomLog: 1, phases: 0, symptomSets: 0 });
  assert.deepEqual(s.foodLog.map((e) => [e.id, e.tags.join()]), [['f1', 'wheat'], ['f2', 'soy']], 'current f1 wins');
  assert.equal(s.settings.windowHours, 48);
  assert.deepEqual(s.settings.customTags, [{ id: 'sesame', label: 'Sesame' }, { id: 'oats', label: 'Oats' }]);
  assert.deepEqual(s.settings.hiddenTags, ['corn', 'fish']);
  assert.deepEqual(s.dismissed, ['f1:wheat', 'f2:soy']);
  assert.equal(s.babyName, 'Rowan', 'fills a missing name');
  assert.equal(s.lastBackup, '2026-09-10T10:00');
  assert.equal(JSON.stringify(current), before, 'current diary object untouched');
  assert.deepEqual(L.mergeStates(s, incoming).added, { meals: 0, foodLog: 0, symptomLog: 0, phases: 0, symptomSets: 0 }, 'merging twice adds nothing');
});

test('symptom sets: in a fresh state, gained by old saves, merged by id, and sanitized on restore', () => {
  assert.deepEqual(L.freshState().symptomSets, []);
  assert.deepEqual(L.normalizeState({ v: 1 }).symptomSets, [], 'a diary saved before sets gains an empty list');
  const set = (id, name, items, extra = {}) => ({ id, name, items, useCount: 0, lastUsed: null, ...extra });
  const current = diary({ symptomSets: [set('t1', 'Rough night', [{ cat: 'crying', severity: 2, flags: [] }], { useCount: 4 })] });
  const incoming = diary({ symptomSets: [
    set('t1', 'Renamed', [{ cat: 'crying', severity: 3, flags: [] }]),
    set('t2', 'Morning', [{ cat: 'stool', severity: 2, flags: ['mucus'], consistency: 'loose' }]),
  ] });
  const { state: s, added } = L.mergeStates(current, incoming);
  assert.deepEqual(added, { meals: 0, foodLog: 0, symptomLog: 0, phases: 0, symptomSets: 1 });
  assert.deepEqual(s.symptomSets.map((x) => [x.id, x.name, x.useCount]), [['t1', 'Rough night', 4], ['t2', 'Morning', 0]], 'the current copy wins');
  assert.deepEqual(L.mergeStates({ ...current, symptomSets: undefined }, incoming).added.symptomSets, 2, 'a diary without the field still merges');

  assert.deepEqual(L.setItem({ cat: 'stool', consistency: 'loose', flags: ['blood', 'hives'], note: 'x' }),
    { cat: 'stool', severity: 2, flags: ['blood'], consistency: 'loose' }, 'set items carry no note');
  const r = L.readBackup(JSON.stringify({ ...L.freshState(), onboarded: true, symptomSets: [
    set('ok', ' Bad night ', [
      { cat: 'stool', severity: 9, flags: ['mucus', 'hives', 'x"'], consistency: 'loose', note: 'dropped' },
      { cat: 'stool', severity: 1, flags: [], consistency: 'hard' },
      { cat: 'resp', severity: 3, flags: ['blood'] },
      { cat: 'other', severity: 7 },
      { cat: 'constructor', severity: 1 },
    ], { useCount: -2, lastUsed: 'yesterday' }),
    set('empty', 'Nothing usable', [{ cat: 'stool', consistency: 'formed', flags: [] }]),
    set('noname', '  ', [{ cat: 'crying', severity: 1, flags: [] }]),
    { id: 'bad id!', name: 'x', items: [{ cat: 'crying', severity: 1, flags: [] }] },
  ] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.symptomSets, [{
    id: 'ok', name: 'Bad night', useCount: 0, lastUsed: null,
    items: [{ cat: 'stool', severity: 2, flags: ['mucus'], consistency: 'loose' }, { cat: 'resp', severity: 3, flags: [] }],
  }], 'stool severity follows consistency, a second item per category and impossible items go, notes are never kept');
  assert.equal(r.skipped, 3);
});

test('backupReminder waits for entries and two weeks, and Later holds it off for a week', () => {
  const today = '2026-09-30';
  assert.equal(L.backupReminder(diary(), today), null, 'no entries, no reminder');
  assert.equal(L.backupReminder(diary({ phases: [phase('2026-01-01T00:00')] }), today), null, 'phases alone are not data');
  assert.equal(L.backupReminder(diary({ foodLog: [food('f1', '2026-09-17T08:00')] }), today), null, '13 days without a first backup is fine');
  const old = diary({ foodLog: [food('f1', '2026-09-16T08:00')], symptomLog: [sym('s1', '2026-09-20T08:00', 'crying', 1)] });
  assert.deepEqual(L.backupReminder(old, today), { days: 14, never: true });
  assert.equal(L.backupReminder({ ...old, lastBackup: '2026-09-20T21:00' }, today), null);
  assert.deepEqual(L.backupReminder({ ...old, lastBackup: '2026-09-10T21:00' }, today), { days: 20, never: false });
  assert.equal(L.backupReminder({ ...old, backupSnoozed: '2026-09-24T09:00' }, today), null, 'Later holds for a week');
  assert.deepEqual(L.backupReminder({ ...old, backupSnoozed: '2026-09-23T09:00' }, today), { days: 14, never: true });
});

test('readBackup refuses files that are not this app\'s diary', () => {
  assert.deepEqual(L.readBackup('{"hello":"world"}'), { ok: false, reason: 'unreadable' });
  assert.deepEqual(L.readBackup(''), { ok: false, reason: 'unreadable' });
  assert.deepEqual(L.readBackup(JSON.stringify({ v: 1, bottles: [], recipes: [] })), { ok: false, reason: 'not-diary' },
    "another app's saved state from the same site");
  assert.equal(L.readBackup(JSON.stringify({ v: 9, app: 'food-diary' })).reason, 'newer');
  const marked = L.readBackup(JSON.stringify({ v: 1, app: 'food-diary' }));
  assert.equal(marked.ok, true);
  assert.equal('app' in marked.state, false, 'the marker is not kept in the diary');
  assert.equal(L.readBackup(JSON.stringify({ ...L.freshState(), onboarded: true })).ok, true, 'exports from before the marker still restore');
});

test('readBackup drops damaged or unsafe entries and counts them', () => {
  const file = {
    ...L.freshState(),
    onboarded: true,
    settings: { windowHours: 24, customTags: [{ id: 'sesame', label: 'Sesame' }, { id: 'bad tag', label: 'x' }, { id: 'nolabel' }], hiddenTags: ['corn', '<b>'] },
    meals: [{ id: 'm1', name: 'Toast' }, { id: 'm2', tags: ['wheat'] }],
    foodLog: [
      food('f1', '2026-09-12T08:00', ['dairy', 'x"><img>'], ['dairy', 'soy']),
      food('f1', '2026-09-12T09:00', ['egg']),
      { id: '"><img src=x onerror=alert(1)>', ts: '2026-09-12T08:00', name: 'Evil', tags: [] },
      { id: 'f3', ts: 'yesterday', name: 'No time', tags: [] },
    ],
    symptomLog: [
      sym('s1', '2026-09-12T10:00', 'stool', 9, ['blood', 'hives'], { consistency: 'loose' }),
      sym('s2', '2026-09-12T10:00', 'constructor', 2),
      sym('s3', '2026-09-12T10:00', 'stool', 2, [], { consistency: 'constructor' }),
      sym('s4', '2026-09-12T10:00', 'crying', 7),
    ],
    phases: [
      { ...phase('2026-09-01T00:00'), id: 'p1' },
      { ...phase('2026-09-02T00:00', 'soon'), id: 'p2' },
      { ...phase('2026-09-03T00:00', null, { tag: 'Dairy Stuff' }), id: 'p3' },
    ],
  };
  const r = L.readBackup(JSON.stringify(file));
  assert.equal(r.ok, true);
  const s = r.state;
  assert.deepEqual(s.meals.map((m) => [m.id, m.tags, m.uncertain]), [['m1', [], []]], 'missing tag lists repaired, nameless meal dropped');
  assert.deepEqual(s.foodLog.map((e) => [e.id, e.tags.join(), e.uncertain.join()]), [['f1', 'dairy', 'soy']]);
  assert.deepEqual(s.symptomLog.map((e) => [e.id, e.severity, e.flags.join(), e.consistency]), [['s1', 2, 'blood', 'loose'], ['s3', 2, '', undefined]]);
  assert.deepEqual(s.phases.map((p) => p.id), ['p1']);
  assert.deepEqual(s.settings.customTags, [{ id: 'sesame', label: 'Sesame' }]);
  assert.deepEqual(s.settings.hiddenTags, ['corn']);
  assert.equal(r.skipped, 1 + 3 + 2 + 2 + 2);
});

// ---- state -------------------------------------------------------------------

test('readState with nothing saved gives a fresh, not-yet-onboarded diary', () => {
  for (const raw of [null, '']) {
    const r = L.readState(raw);
    assert.equal(r.ok, true);
    assert.equal(r.fresh, true);
    assert.deepEqual(r.state, L.freshState());
    assert.equal(r.state.onboarded, false);
  }
});

test('readState refuses data from a newer version instead of touching it', () => {
  const r = L.readState(JSON.stringify({ v: L.STATE_VERSION + 1, foodLog: [{ id: 'a' }] }));
  assert.deepEqual(r, { ok: false, reason: 'newer', version: L.STATE_VERSION + 1 });
});

test('readState reports unreadable input rather than guessing', () => {
  for (const raw of ['{', '[]', '"diary"', 'null', '{"meals":[]}', '{"v":0}', '{"v":"1"}', '{"v":1.5}']) {
    assert.deepEqual(L.readState(raw), { ok: false, reason: 'unreadable' }, raw);
  }
});

test('readState fills missing fields without dropping entries or unknown fields', () => {
  const saved = {
    v: 1,
    babyName: 'Rowan',
    settings: { windowHours: 48 },
    foodLog: [{ id: 'f1', ts: '2026-09-12T18:10', name: 'Pad thai', tags: ['soy'], uncertain: ['dairy'], note: '' }],
    phases: [phase('2026-08-20T00:00')],
    futureField: { keep: true },
  };
  const r = L.readState(JSON.stringify(saved));
  assert.equal(r.ok, true);
  assert.equal(r.migrated, false);
  const s = r.state;
  assert.equal(s.babyName, 'Rowan');
  assert.equal(s.settings.windowHours, 48);
  assert.deepEqual(s.settings.customTags, []);
  assert.deepEqual(s.settings.hiddenTags, []);
  assert.deepEqual(s.foodLog, saved.foodLog);
  assert.deepEqual(s.phases, saved.phases);
  assert.deepEqual(s.meals, []);
  assert.deepEqual(s.symptomLog, []);
  assert.deepEqual(s.futureField, { keep: true });
  assert.equal(s.onboarded, true, 'a diary with entries counts as set up');
});

test('normalizeState repairs bad field types and is idempotent', () => {
  const s = L.normalizeState({
    v: 1, onboarded: 'yes', babyName: 7, settings: { windowHours: 30, hiddenTags: 'corn' },
    meals: {}, dismissed: null, lastBackup: 'yesterday', backupSnoozed: 'soon',
  });
  assert.equal(s.backupSnoozed, null);
  assert.equal(s.settings.windowHours, 24);
  assert.deepEqual(s.settings.hiddenTags, []);
  assert.deepEqual(s.meals, []);
  assert.deepEqual(s.dismissed, []);
  assert.equal(s.babyName, '');
  assert.equal(s.lastBackup, null);
  assert.equal(s.onboarded, false);
  assert.deepEqual(L.normalizeState(s), s);
  assert.deepEqual(L.normalizeState(L.freshState()), L.freshState());
});
