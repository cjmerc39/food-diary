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

test('gut score points: stool, gas, and spit-up carry their severity plus 2 for blood and 1 for mucus; nothing else carries any', () => {
  assert.equal(L.eventPoints(sym('a', '2026-09-05T08:00', 'stool', 2, ['blood', 'mucus'])), 5);
  assert.equal(L.eventPoints(sym('b', '2026-09-05T08:00', 'skin', 1, ['hives'])), 0, 'skin and hives are logged, not scored');
  assert.equal(L.eventPoints(sym('c', '2026-09-05T08:00', 'stool', 0, ['blood'])), 2);
  assert.equal(L.eventPoints(sym('d', '2026-09-05T08:00', 'other', 3)), 0);
  assert.equal(L.eventPoints(sym('e', '2026-09-05T08:00', 'crying', 3)), 0);
  assert.equal(L.eventPoints(sym('f', '2026-09-05T08:00', 'resp', 3)), 0);
  assert.equal(L.eventPoints(sym('g', '2026-09-05T08:00', 'gas', 2)), 2);
  assert.equal(L.eventPoints(sym('h', '2026-09-05T08:00', 'spitup', 3)), 3);
  assert.deepEqual([L.SCORE_CATS, L.SCORE_MAX, L.FLAG_POINTS], [['stool', 'gas', 'spitup'], 12, { blood: 2, mucus: 1 }]);
});

test('dayScore: the worst stool, gas, and spit-up, plus blood and mucus once a day; skin and crying stay out', () => {
  const log = [
    sym('s1', '2026-09-05T07:00', 'stool', 2, ['blood']),
    sym('s2', '2026-09-05T15:00', 'stool', 3, ['blood', 'mucus']),
    sym('s3', '2026-09-05T09:00', 'crying', 2),
    sym('s4', '2026-09-05T21:00', 'crying', 1),
    sym('s5', '2026-09-05T10:00', 'skin', 1, ['hives']),
    sym('s6', '2026-09-05T11:00', 'other', 3),
    sym('s7', '2026-09-05T12:00', 'gas', 1),
    sym('s8', '2026-09-05T13:00', 'gas', 2),
    sym('s9', '2026-09-06T00:30', 'resp', 3),
  ];
  const d = L.dayScore(log, '2026-09-05');
  assert.deepEqual(d.cats, { crying: 2, spitup: 0, stool: 3, skin: 1, resp: 0, gas: 2 }, 'every category is tracked for the strips');
  assert.deepEqual(d.flags, { blood: true, mucus: true, hives: true }, 'hives is tracked, to show, not to score');
  assert.equal(d.score, 3 + 2 + 0 + 2 + 1, 'stool 3, gas 2, no spit-up, blood 2, mucus 1; crying, skin, hives, and other add nothing');
  assert.equal(L.dayScore(log, '2026-09-06').score, 0, 'breathing alone scores zero');
  assert.equal(L.dayScore(log, '2026-09-07').score, 0);
  assert.equal(L.dayScore([sym('k', '2026-09-08T10:00', 'skin', 3, ['hives'])], '2026-09-08').score, 0, 'a day with only skin scores zero');
  assert.equal(L.dayScore([sym('c', '2026-09-08T10:00', 'crying', 3)], '2026-09-08').score, 0, 'a day with only crying scores zero');
  const worst = [sym('w1', '2026-09-09T12:00', 'stool', 3, ['blood', 'mucus'], { consistency: 'watery' }), sym('w2', '2026-09-09T12:00', 'gas', 3), sym('w3', '2026-09-09T12:00', 'spitup', 3),
    sym('w4', '2026-09-09T12:00', 'crying', 3), sym('w5', '2026-09-09T12:00', 'skin', 3, ['hives']), sym('w6', '2026-09-09T12:00', 'resp', 3)];
  assert.equal(L.dayScore(worst, '2026-09-09').score, 12, 'the most a day can score is 12');
});

test('dayScoreParts: each point on the glance card traces to one entry, and the parts add up to the score', () => {
  const log = [
    sym('g1', '2026-09-05T08:00', 'gas', 1),
    sym('g2', '2026-09-05T13:00', 'gas', 2),
    sym('g3', '2026-09-05T18:00', 'gas', 2),              // ties go to the earliest
    sym('t1', '2026-09-05T07:00', 'stool', 2, ['mucus'], { consistency: 'loose' }),
    sym('t2', '2026-09-05T15:00', 'stool', 3, ['blood', 'mucus'], { consistency: 'watery' }),
    sym('c1', '2026-09-05T09:00', 'crying', 3),
    sym('k1', '2026-09-05T10:00', 'skin', 2, ['hives']),
  ];
  const p = L.dayScoreParts(log, '2026-09-05');
  assert.deepEqual(p.parts.map((x) => [x.kind, x.cat || x.flag, x.points, x.eventId]),
    [['cat', 'stool', 3, 't2'], ['cat', 'gas', 2, 'g2'], ['flag', 'blood', 2, 't2'], ['flag', 'mucus', 1, 't1']],
    'the worst stool and gas entries, blood from the entry that carried it, mucus from the first; nothing for crying or skin');
  assert.equal(p.score, L.dayScore(log, '2026-09-05').score);
  assert.deepEqual(L.dayScoreParts([sym('c', '2026-09-06T10:00', 'crying', 3)], '2026-09-06'), { day: '2026-09-06', score: 0, parts: [] });
  const formed = L.dayScoreParts([sym('f', '2026-09-07T10:00', 'stool', 0, ['blood'], { consistency: 'formed' })], '2026-09-07');
  assert.deepEqual(formed.parts.map((x) => [x.kind, x.flag, x.points]), [['flag', 'blood', 2]], 'a formed stool with blood: the flag is the only part');
});

test('gas is a symptom category, in the gut score and charted per day', () => {
  assert.ok(L.SYMPTOM_CATS.includes('gas'));
  assert.ok(L.SCORE_CATS.includes('gas') && L.DAY_CATS.includes('gas'));
  assert.equal(L.symptomMissing({ cat: 'gas', severity: null }), 'severity');
  assert.deepEqual(L.symptomFields({ cat: 'gas', severity: 3, flags: ['blood'], color: 'red', count: 4 }),
    { cat: 'gas', severity: 3, flags: [], note: '' }, 'no flags, color, or count off a stool');
  const log = [sym('g1', '2026-09-05T08:00', 'gas', 3), sym('c1', '2026-09-05T09:00', 'crying', 1)];
  const d = L.dayScore(log, '2026-09-05');
  assert.equal(d.cats.gas, 3);
  assert.equal(d.score, 3, 'gas is in the score; crying is not');
  assert.equal(L.eventPoints(log[0]), 3);
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

test('stool count: one entry for several diapers, shown beside the gut score, scored as that many entries after a food', () => {
  assert.equal('count' in L.symptomFields({ cat: 'stool', consistency: 'loose', count: 1 }), false, 'one is the default and is left off');
  assert.equal(L.symptomFields({ cat: 'stool', consistency: 'loose', count: 3 }).count, 3);
  assert.equal(L.symptomFields({ cat: 'stool', consistency: 'loose', count: 99 }).count, L.MAX_STOOL_COUNT);
  const log = [
    sym('a', '2026-09-05T07:00', 'stool', 2, ['mucus'], { consistency: 'loose', count: 3 }),
    sym('b', '2026-09-05T15:00', 'stool', 3, [], { consistency: 'watery' }),   // from before counts: one
    sym('c', '2026-09-05T16:00', 'crying', 2, [], { count: 5 }),              // a count means nothing off a stool
    sym('d', '2026-09-06T08:00', 'stool', 1, [], { consistency: 'hard', count: 2 }),
  ];
  const d = L.dayScore(log, '2026-09-05');
  assert.equal(d.stools, 4);
  assert.equal(d.score, 3 + 1, 'the score still takes the worst stool once, plus mucus; the count shows beside it');
  assert.deepEqual(L.scoreSeries(log, '2026-09-05', '2026-09-07').map((x) => x.stools), [4, 2, 0]);
  assert.equal(L.eventPoints(log[0]), 9, 'three loose stools with mucus score as three entries would');
  assert.equal(L.eventPoints(log[2]), 0);
  assert.equal(L.dayGlance(diary({ symptomLog: log }), '2026-09-05').stools, 4);
  const after = (log2) => L.symptomIndex(log2).between(L.tsMs('2026-09-02T06:00'), L.tsMs('2026-09-03T06:00')).points;
  assert.equal(after([sym('x', '2026-09-02T09:00', 'stool', 2, [], { consistency: 'loose', count: 3 })]),
    after([7, 8, 9].map((h) => sym(`x${h}`, `2026-09-02T0${h}:30`, 'stool', 2, [], { consistency: 'loose' }))), 'one entry for three diapers carries the points of three');
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

test('dayGlance counts a day\'s entries and its gut score', () => {
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
    { score: 4, stools: 1, entries: 4, food: 2, symptoms: 2, phases: [['p1', 12]] }, 'loose stool 2 plus blood 2; the crying is an entry, not a point');
  assert.deepEqual(L.dayGlance(diary(), '2026-09-12'), { score: 0, stools: 0, entries: 0, food: 0, symptoms: 0, phases: [] });
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
    ['x1', false, 3, 2, true],
  ], 'gut score points: the loose stool with mucus is 3; the crying entry is counted but worth nothing');
  assert.ok(near(w.exposures[0].hoursLeft, 54));
  assert.ok(near(w.exposures[1].hoursLeft, 6));
  const later = L.reintroWatches(s, '2026-09-16T12:00')[0].exposures;
  assert.deepEqual(later.map((x) => [x.watching, x.points]), [[false, 3], [false, 3]]);
  assert.deepEqual(L.reintroWatches(diary(), now), []);
});

test('window settings from earlier builds stay valid in a stored diary, though nothing reads them now', () => {
  assert.equal(L.normalizeState({ v: 2, settings: { windowHours: 168 } }).settings.windowHours, 168);
  assert.equal(L.normalizeState({ v: 2, settings: { windowHours: 144 } }).settings.windowHours, 24, 'off-list values still fall back');
  assert.deepEqual(L.freshState().settings.safeTags, []);
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
    symptomLog: [sym('s1', '2026-09-12T11:00', 'stool', 2, ['mucus'], { consistency: 'loose' })],
  });
  assert.deepEqual(L.exposuresOf(s.foodLog, 'dairy').map((x) => [x.event.id, x.who]), [['p1', 'parent'], ['b1', 'baby']]);
  assert.deepEqual(L.exposuresOf(s.foodLog, 'dairy', 'baby').map((x) => x.event.id), ['b1']);
  assert.deepEqual(L.exposuresOf(s.foodLog, 'dairy', 'parent').map((x) => x.event.id), ['p1']);
  assert.deepEqual(L.exposureBanners(s, now).map((b) => [b.key, b.who]), [['b1:dairy', 'baby'], ['p1:dairy', 'parent']],
    "the baby eating an eliminated food raises a banner too, labeled");
  const [w] = L.reintroWatches(s, now);
  assert.deepEqual(w.exposures.map((x) => [x.eventId, x.who, x.points]), [['b2', 'baby', 3], ['p2', 'parent', 3]]);
});

// ---- foods -------------------------------------------------------------------

const named = (id, ts, name, extra = {}) => ({ ...food(id, ts), name, ...extra });

// ---- foods (state v2) ----------------------------------------------------------

const v1Diary = () => ({
  v: 1, onboarded: true, babyName: 'Rowan', settings: { windowHours: 24, directWindowHours: 4, customTags: [], hiddenTags: [] },
  meals: [
    { id: 'mk', name: 'Chicken kebabs, toast, mayo, coke zero', tags: [], uncertain: [], useCount: 4, lastUsed: '2026-09-18T15:05' },
    { id: 'mb', name: 'Eggs, toast w/cream cheese, coffee,', tags: ['egg', 'wheat'], uncertain: ['dairy'], useCount: 3, lastUsed: '2026-09-17T09:00' },
    { id: 'mp', name: 'Popcorn', tags: ['corn'], uncertain: [], useCount: 2, lastUsed: '2026-09-18T22:22' },
    { id: 'mr', name: 'Rice, fire roasted veggies (Brussels, bell peppers, mushrooms', tags: [], uncertain: [], useCount: 1, lastUsed: null },
    { id: 'mt', name: 'TOAST', tags: ['wheat'], uncertain: [], useCount: 1, lastUsed: '2026-09-19T08:00' },
  ],
  foodLog: [
    { ...food('e1', '2026-09-14T13:39'), name: 'Chicken kebabs, toast, mayo, coke zero', mealId: 'mk', note: 'at the park' },
    { ...food('e2', '2026-09-15T09:00', ['egg', 'wheat'], ['dairy']), name: 'Eggs, toast w/cream cheese, coffee,', mealId: 'mb' },
    { ...food('e3', '2026-09-16T20:00', ['corn']), name: ' popcorn ', mealId: 'mp' },          // case and spacing differ: still the same meal
    { ...food('e4', '2026-09-16T12:00', ['wheat']), name: 'Sandwich from the deli', mealId: null }, // never saved: an older entry
  ],
  symptomLog: [sym('s1', '2026-09-14T18:00', 'crying', 2)],
  phases: [], dismissed: [], lastBackup: null,
});

test('migration to v2: saved meals split into foods at their commas, never inside parentheses', () => {
  const r = L.readState(JSON.stringify(v1Diary()));
  assert.equal(r.ok, true);
  assert.equal(r.migrated, true);
  const s = r.state;
  assert.equal(s.v, 2);
  assert.deepEqual(s.foodItems.map((it) => it.label),
    ['Chicken kebabs', 'Toast', 'Mayo', 'Coke zero', 'Eggs', 'Toast w/cream cheese', 'Coffee', 'Popcorn', 'Rice', 'Fire roasted veggies (Brussels, bell peppers, mushrooms'],
    'each food once (toast and TOAST are one), capitalized, the unclosed parenthesis kept whole, the trailing comma ignored');
  assert.ok(s.foodItems.every((it) => it.reviewed === false), 'every food starts unreviewed');
  const toast = L.findItemByLabel(s.foodItems, 'toast');
  assert.equal(toast.useCount, 4 + 1, 'use counts add up across the meals a food came from');
  assert.equal(toast.lastUsed, '2026-09-19T08:00');
  assert.deepEqual(L.splitMealName('  a,, b ;c.  '), ['A', 'B', 'C']);
  assert.equal(L.readState(JSON.stringify(v1Diary())).state.foodItems[0].id, s.foodItems[0].id, 'the same name gets the same id every time');
});

test('migration to v2: allergens stay where she put them, so saved meals log exactly as before', () => {
  const s = L.readState(JSON.stringify(v1Diary())).state;
  const meal = (id) => s.meals.find((m) => m.id === id);
  const food = (label) => L.findItemByLabel(s.foodItems, label);
  assert.deepEqual([food('Popcorn').tags, 'tags' in meal('mp')], [['corn'], false], 'a meal that was one food hands it its tags');
  assert.deepEqual(food('Toast').tags, ['wheat'], '"TOAST" was a one-food meal tagged wheat');
  assert.deepEqual([meal('mb').tags, meal('mb').uncertain], [['egg', 'wheat'], ['dairy']], 'a meal of several foods keeps its tags: which food held the egg is unknown');
  assert.deepEqual([food('Eggs').tags, food('Coffee').tags], [[], []], 'its foods start untagged, to review');
  for (const m of v1Diary().meals) {
    const now = L.mealTags(s, meal(m.id));
    assert.deepEqual([now.tags.sort(), now.uncertain.sort()], [m.tags.concat(m.id === 'mk' ? ['wheat'] : []).sort(), m.uncertain.sort()],
      `${m.name}: logs the same allergens (plus wheat where it now holds toast, which she tagged)`);
  }
  assert.deepEqual(meal('mk').items.map((id) => s.foodItems.find((it) => it.id === id).label), ['Chicken kebabs', 'Toast', 'Mayo', 'Coke zero']);
});

test('migration to v2: logged entries never change; a name matching a saved meal, ignoring case, gains a link to its foods', () => {
  const before = v1Diary();
  const s = L.readState(JSON.stringify(before)).state;
  s.foodLog.forEach((e, i) => {
    const { items, ...rest } = e;
    assert.deepEqual(rest, before.foodLog[i], `${e.id} keeps its name, tags, note, and time`);
  });
  const link = (id) => s.foodLog.find((e) => e.id === id).items;
  assert.equal(link('e1').length, 4);
  assert.equal(link('e2').length, 3);
  assert.deepEqual(link('e3'), [L.findItemByLabel(s.foodItems, 'Popcorn').id], '" popcorn " is the saved "Popcorn", as the old app treated it');
  assert.equal(link('e4'), undefined, 'never saved as a meal: an older entry');
  assert.deepEqual(s.symptomLog, before.symptomLog);
  const restored = L.readBackup(JSON.stringify({ app: 'food-diary', ...before }));
  assert.equal(restored.ok, true);
  assert.equal(restored.skipped, 0);
  assert.deepEqual(restored.state.foodItems.map((it) => it.id), s.foodItems.map((it) => it.id), 'restoring an old backup migrates it the same way');
});

test('restoring keeps long names whole instead of cutting them at the text box limit', () => {
  const long = `${'Hamachi roll, veggie roll, rainbow roll (took out the imitation krab), '}coconut aminos, tom kha soup`;
  const r = L.readBackup(JSON.stringify({ ...v1Diary(), meals: [{ id: 'm', name: long, tags: [], uncertain: [] }], foodLog: [{ ...food('e', '2026-09-11T16:59'), name: long }] }));
  assert.ok(long.length > 80);
  assert.equal(r.state.foodLog[0].name, long);
  assert.equal(r.state.meals[0].name, long);
  assert.equal(r.state.foodLog[0].items.length, 5);
});

test('the review card counts foods left to review and retires for good', () => {
  const food = (id, extra = {}) => ({ id, label: id, tags: [], uncertain: [], useCount: 0, lastUsed: null, reviewed: false, ...extra });
  const s = diary({ foodItems: [food('a'), food('b'), food('c', { reviewed: true }), food('d', { hidden: true }), food('e', { mergedInto: 'c' })] });
  assert.equal(L.foodsToReview(s), 2, 'reviewed, hidden, and merged-away foods are done with');
  assert.deepEqual(L.foodReviewCard(s), { count: 2 });
  assert.equal(L.foodReviewCard({ ...s, foodReviewDone: true }), null, 'dismissed, it stays gone');
  assert.equal(L.foodReviewCard({ ...s, foodItems: s.foodItems.map((f) => ({ ...f, reviewed: true })) }), null, 'nothing left, no card');
  assert.equal(L.foodReviewCard(diary()), null, 'a new diary has nothing to review');
  assert.equal(L.freshState().foodReviewDone, false);
  assert.equal(L.normalizeState({ v: 2 }).foodReviewDone, false, 'a diary from build 15 gains the field');
  assert.equal(L.normalizeState({ v: 2, foodReviewDone: 'yes' }).foodReviewDone, false);
  assert.equal(L.mergeStates({ ...s, foodReviewDone: true }, { ...s, foodReviewDone: false }).state.foodReviewDone, true, "a restore keeps the phone's choice");
  const migrated = L.readState(JSON.stringify(v1Diary())).state;
  assert.deepEqual(L.foodReviewCard(migrated), { count: migrated.foodItems.length }, 'after the update, every food split out of a meal is waiting');
});

test('foods: derived meal tags, lookup by label, and what the picker offers', () => {
  const s = { ...L.freshState(), foodItems: [
    { id: 'a', label: 'Pizza', tags: ['dairy', 'wheat'], uncertain: [], useCount: 3, lastUsed: '2026-09-18T12:00', reviewed: true },
    { id: 'b', label: 'Coke zero', tags: [], uncertain: [], useCount: 9, lastUsed: '2026-09-18T12:00', reviewed: true },
    { id: 'c', label: 'Takeout wings', tags: [], uncertain: ['dairy', 'soy'], useCount: 1, lastUsed: null, reviewed: true },
    { id: 'd', label: 'Old soda', tags: [], uncertain: [], useCount: 1, lastUsed: null, reviewed: true, mergedInto: 'b' },
    { id: 'h', label: 'Grapes', tags: [], uncertain: [], useCount: 0, lastUsed: null, reviewed: true, hidden: true },
  ] };
  assert.deepEqual(L.mealTags(s, { items: ['a', 'b', 'c'] }), { tags: ['dairy', 'wheat'], uncertain: ['soy'] }, 'contains outranks possibly hidden');
  assert.deepEqual(L.mealTags(s, { items: ['b'], tags: ['egg'], uncertain: [] }), { tags: ['egg'], uncertain: [] }, 'a meal keeps tags it carried over');
  assert.deepEqual(L.resolveItems(s.foodItems, ['d', 'b', 'x']).map((it) => it.id), ['b'], 'a merged food resolves to its target, once; unknown ids drop');
  assert.equal(L.findItemByLabel(s.foodItems, '  coke ZERO ').id, 'b');
  assert.equal(L.findItemByLabel(s.foodItems, 'old soda'), null, 'a merged-away food is no longer found by name');
  assert.deepEqual(L.pickableItems(s.foodItems).map((it) => it.id), ['a', 'b', 'c']);
  assert.deepEqual(L.searchMeals(s.foodItems, 'co').map((it) => it.label), ['Coke zero'], 'search works on foods');
  assert.deepEqual(L.rankMeals(L.pickableItems(s.foodItems), '2026-09-19T12:00', 2).map((it) => it.label), ['Coke zero', 'Pizza']);
  assert.equal(L.tagInUse({ ...s, meals: [], foodLog: [], phases: [] }, 'soy'), true, "a food's tags count as in use");
});

test('merging foods moves the library and saved meals, never past entries, and history follows', () => {
  const s = diary({
    foodItems: [
      { id: 'cz', label: 'Coke zero', tags: [], uncertain: [], useCount: 2, lastUsed: '2026-09-05T12:00', reviewed: true },
      { id: 'dc', label: 'Diet coke', tags: [], uncertain: [], useCount: 1, lastUsed: '2026-09-06T12:00', reviewed: false },
    ],
    meals: [{ id: 'm', name: 'Lunch', items: ['dc', 'cz'], useCount: 1, lastUsed: null }],
    foodLog: [
      { ...named('e2', '2026-09-02T12:00', 'Coke zero'), items: ['cz'] },
      { ...named('e3', '2026-09-03T12:00', 'Diet coke'), items: ['dc'] },
      { ...named('e4', '2026-09-04T12:00', 'Diet coke'), items: ['dc'] },
    ],
    symptomLog: [sym('s1', '2026-09-03T14:00', 'crying', 2)],
  });
  const log = JSON.stringify(s.foodLog);
  const m = L.mergeItem(s, 'dc', 'cz');
  assert.deepEqual(m.foodItems.find((it) => it.id === 'dc').mergedInto, 'cz');
  assert.deepEqual(m.foodItems.find((it) => it.id === 'cz'), { id: 'cz', label: 'Coke zero', tags: [], uncertain: [], useCount: 3, lastUsed: '2026-09-06T12:00', reviewed: true });
  assert.deepEqual(m.meals[0].items, ['cz'], 'the saved meal now holds the target, once');
  assert.equal(JSON.stringify(s.foodLog), log, 'past entries are untouched');
  assert.equal(L.mergeItem(s, 'cz', 'cz'), null);
  const merged = { ...s, ...m };
  const r = L.standingOut(merged, { fromDay: '2026-09-01', today: '2026-09-08', who: 'parent' });
  assert.deepEqual(r.rows.map((x) => [x.label, x.eatenDays]), [['Coke zero', 2]], "the old food's entries count toward the one it became, as one food; its Sep 2 entry predates symptom tracking");
  const grouped = L.standingOut({ ...merged, foodLog: [...merged.foodLog, { ...named('e5', '2026-09-05T12:00', 'Water'), items: [] }] },
    { fromDay: '2026-09-01', today: '2026-09-08', who: 'parent' });
  assert.equal(grouped.rows.length, 2);
  const chain = L.mergeItem({ ...merged, foodItems: [...merged.foodItems, { id: 'pz', label: 'Pepsi zero', tags: [], uncertain: [], useCount: 0, lastUsed: null, reviewed: true }] }, 'cz', 'pz');
  assert.equal(L.itemResolver(chain.foodItems)('dc').id, 'pz', 'merges chain');
});

test('restoring a backup never doubles a food: same name means same food', () => {
  const phone = diary({
    foodItems: [{ id: 'mine', label: 'Coke zero', tags: [], uncertain: [], useCount: 5, lastUsed: null, reviewed: true }],
    foodLog: [{ ...named('e1', '2026-09-02T12:00', 'Coke zero'), items: ['mine'] }],
  });
  const backup = diary({
    foodItems: [
      { id: 'theirs', label: 'coke Zero', tags: [], uncertain: [], useCount: 2, lastUsed: null, reviewed: true },
      { id: 'new', label: 'Grapes', tags: [], uncertain: [], useCount: 1, lastUsed: null, reviewed: true },
      { id: 'alias', label: 'Diet coke', tags: [], uncertain: [], useCount: 1, lastUsed: null, reviewed: true, mergedInto: 'theirs' },
    ],
    meals: [{ id: 'm2', name: 'Snack', items: ['theirs', 'new'], useCount: 1, lastUsed: null }],
    foodLog: [{ ...named('e2', '2026-09-03T12:00', 'coke Zero, grapes'), items: ['theirs', 'new'] }],
  });
  const before = JSON.stringify(phone);
  const { state: s, added } = L.mergeStates(phone, backup);
  assert.deepEqual([added.foodItems, added.meals, added.foodLog], [2, 1, 1]);
  assert.deepEqual(s.foodItems.map((it) => it.id), ['mine', 'new', 'alias']);
  assert.equal(s.foodItems.find((it) => it.id === 'alias').mergedInto, 'mine', 'an alias follows the food it pointed at');
  assert.deepEqual(s.meals[0].items, ['mine', 'new']);
  assert.deepEqual(s.foodLog.find((e) => e.id === 'e2').items, ['mine', 'new'], "the backup's entry points at the phone's food");
  assert.equal(JSON.stringify(phone), before, 'the diary on the phone is untouched');
  assert.equal(JSON.stringify(backup.foodLog[0].items), '["theirs","new"]', 'and so is the backup object');
});

test('restoring checks foods, saved meals, and the links between them', () => {
  const r = L.readBackup(JSON.stringify({ ...L.freshState(), onboarded: true,
    foodItems: [
      { id: 'a', label: '  Pizza ', tags: ['wheat', '<b>'], uncertain: ['wheat', 'soy'], useCount: -1, lastUsed: 'soon', reviewed: 'yes', hidden: 'no' },
      { id: 'b', label: 'B', tags: [], mergedInto: 'c' }, { id: 'c', label: 'C', tags: [], mergedInto: 'b' },   // a circle
      { id: 'd', label: 'D', tags: [], mergedInto: 'nowhere' },
      { id: 'e', label: '   ', tags: [] },
      { id: 'bad id!', label: 'X', tags: [] },
    ],
    meals: [
      { id: 'm1', name: 'Pie', items: ['a', 'zzz', 'a'], tags: ['egg'], uncertain: [] },
      { id: 'm2', name: 'Nothing', items: ['zzz'] },
    ],
    foodLog: [
      { ...named('f1', '2026-09-02T08:00', 'Pie'), items: ['a', 'gone'] },
      { ...named('f2', '2026-09-02T09:00', 'Old'), items: ['gone'] },
    ],
  }));
  const s = r.state;
  assert.deepEqual(s.foodItems.map((it) => it.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(s.foodItems[0], { id: 'a', label: 'Pizza', tags: ['wheat'], uncertain: ['soy'], useCount: 0, lastUsed: null, reviewed: false });
  assert.equal(s.foodItems.filter((it) => it.mergedInto).length, 1, 'the circle is broken');
  assert.equal(s.foodItems.find((it) => it.id === 'd').mergedInto, undefined, 'a merge into nothing is dropped');
  assert.deepEqual(s.meals.map((m) => [m.id, m.items, m.tags]), [['m1', ['a'], ['egg']]], 'a meal left with no foods is dropped');
  assert.deepEqual(s.foodLog.map((e) => [e.id, e.items]), [['f1', ['a']], ['f2', undefined]], 'an entry is never dropped; a broken link just makes it an older entry');
  assert.equal(r.skipped, 3);
});

// ---- what trends answers -----------------------------------------------------

test('where things stand: what is out and since when, and the days with entries since symptom tracking began', () => {
  const s = diary({
    foodLog: [food('f1', '2026-09-07T08:00'), food('f2', '2026-09-10T08:00'), food('f3', '2026-09-14T08:00'), food('f4', '2026-09-20T08:00')],
    symptomLog: [sym('s1', '2026-09-13T10:00', 'crying', 2), sym('s2', '2026-09-16T10:00', 'skin', 1)],
    phases: [
      { ...phase('2026-08-06T00:00'), id: 'dairy' },
      { ...phase('2026-09-11T00:00', null, { tag: 'soy' }), id: 'soy' },
      { ...phase('2026-08-20T00:00', '2026-09-01T00:00', { tag: 'egg' }), id: 'egg' },
      { ...phase('2026-10-05T00:00', null, { tag: 'corn' }), id: 'corn' },
      { ...phase('2026-09-15T00:00', null, { kind: 'reintroduce', tag: 'wheat' }), id: 'wheat-back' },
    ],
  });
  const st = L.statusNow(s, { fromDay: '2026-09-01', today: '2026-09-20' });
  assert.deepEqual(st.out.map((p) => [p.phase.id, p.startDay, p.day]), [['dairy', '2026-08-06', 46], ['soy', '2026-09-11', 10]],
    'active eliminations, oldest first, with the day number; ended and upcoming ones stay out');
  assert.deepEqual(st.back.map((p) => [p.phase.id, p.day]), [['wheat-back', 6]]);
  assert.equal(st.trackingStart, '2026-09-13', 'tracking begins with the first symptom entry, not the first food entry');
  assert.deepEqual([st.from, st.days, st.symptomDays], ['2026-09-13', 4, 2],
    'days with entries from the first symptom entry on: Sep 13, 14, 16, 20; the food logged on Sep 7 and 10 is not counted');
  assert.deepEqual(L.statusNow(diary(), { fromDay: '2026-09-01', today: '2026-09-20' }), { out: [], back: [], trackingStart: null, from: '2026-09-01', days: 0, symptomDays: 0 });
});

// A diary for the standing-out checks. Symptom tracking begins Sep 5 (16
// tracked days, oatmeal every day). Eggs on Sep 6, 11, 16 (and Sep 2, before
// tracking): a bad day (gut score 5: watery stool and gas), then 3, then 1.
// Shrimp on Sep 7 and 8, two days running. Rolls and weenies always together,
// on Sep 9, 14, 19. Almond milk every fourth day. A sesame bar once. Coke zero
// typed the old way. The other days are light (score 1 on Sep 5, 9, 14, 19)
// or quiet.
const day = (d) => `2026-09-${String(d).padStart(2, '0')}`;
const item = (id, label, tags = []) => ({ id, label, tags, uncertain: [], useCount: 1, lastUsed: null, reviewed: true });
const picked = (id, d, label, items, tags = [], h = '12:00') => ({ ...named(id, `${day(d)}T${h}`, label), items, tags });
function standoutDiary() {
  const foodLog = [], symptomLog = [];
  for (let d = 1; d <= 20; d++) foodLog.push(picked(`o${d}`, d, 'Oatmeal', ['oat'], ['oat'], '08:00'));
  for (const d of [2, 6, 11, 16]) foodLog.push(picked(`e${d}`, d, 'Eggs', ['egg'], ['egg']));
  for (const d of [6, 11, 16]) {
    symptomLog.push(sym(`c${d}`, `${day(d)}T15:00`, 'stool', 3, [], { consistency: 'watery' }), sym(`k${d}`, `${day(d)}T16:00`, 'gas', 2));   // 5
    symptomLog.push(sym(`n${d}`, `${day(d + 1)}T10:00`, 'gas', 3));                                                                   // 3 the next day
    symptomLog.push(sym(`a${d}`, `${day(d + 2)}T10:00`, 'spitup', 1));                                                                // 1 the day after
  }
  for (const d of [5, 9, 14, 19]) symptomLog.push(sym(`q${d}`, `${day(d)}T09:00`, 'spitup', 1));
  for (const d of [7, 8]) foodLog.push(picked(`h${d}`, d, 'Shrimp', ['shrimp'], ['shellfish'], '19:00'));
  for (const d of [9, 14, 19]) foodLog.push(picked(`r${d}`, d, "Annie's rolls", ['rolls']), picked(`w${d}`, d, 'Mini weenies', ['weenies']));
  for (const d of [6, 10, 14, 18]) foodLog.push(picked(`m${d}`, d, 'Almond milk', ['almond'], [], '07:00'));
  foodLog.push(picked('z9', 9, 'Sesame bar', ['ses'], [], '13:00'));
  foodLog.push(named('c2', `${day(2)}T13:00`, 'Coke zero'), named('c11', `${day(11)}T13:00`, 'Coke zero'), named('c15', `${day(15)}T13:00`, 'Coke zero'));
  return diary({
    foodItems: [item('oat', 'Oatmeal', ['oat']), item('egg', 'Eggs', ['egg']), item('shrimp', 'Shrimp', ['shellfish']), item('rolls', "Annie's rolls"),
      item('weenies', 'Mini weenies'), item('almond', 'Almond milk'), item('ses', 'Sesame bar')],
    foodLog, symptomLog,
  });
}
const OPTS = { fromDay: '2026-09-01', today: '2026-09-20', who: 'parent' };
const byLabel = (rows, label) => rows.find((x) => x.label === label);

test('standing out: each eating is its day and the two after, against the tracked days outside, by gut score, from the first symptom entry on', () => {
  const s = standoutDiary();
  const r = L.standingOut(s, OPTS);
  assert.deepEqual([r.trackingStart, r.from, r.loggedDays, r.enough], ['2026-09-05', '2026-09-05', 16, true], 'the range is clipped to when symptom tracking began');
  assert.equal(L.SHADOW_DAYS, 3);
  assert.deepEqual(r.standing.map((x) => x.label), ['egg']);
  const egg = r.standing[0];
  assert.deepEqual(egg.dates.map((d) => [d.day, d.score]), [['2026-09-06', 5], ['2026-09-11', 5], ['2026-09-16', 5]], 'the eggs eaten on Sep 2, before any symptom was logged, are not a day eaten');
  assert.deepEqual(egg.after.map((d) => [d.day.slice(8), d.score, d.eaten]),
    [['06', 5, true], ['07', 3, false], ['08', 1, false], ['11', 5, true], ['12', 3, false], ['13', 1, false], ['16', 5, true], ['17', 3, false], ['18', 1, false]],
    'the day eaten and the two after, each with its gut score');
  assert.deepEqual([egg.kind, egg.eatenDays, egg.afterDays, egg.notDays, egg.avgAfter, egg.heavier], ['tag', 3, 9, 7, 3, 3]);
  assert.ok(near(egg.avgNot, 4 / 7) && near(egg.gap, 3 - 4 / 7), 'the other days are Sep 5, 9, 10, 14, 15, 19, 20: four light, three quiet');
  assert.deepEqual(egg.also, [{ kind: 'food', label: 'Eggs', id: 'egg' }], 'the tag and the food, eaten on the same days, are one row');
  // Two days running: the shadows overlap, and a day counts once.
  const shrimp = byLabel(r.rows, 'shellfish');
  assert.deepEqual([shrimp.eatenDays, shrimp.afterDays, shrimp.after.map((d) => d.day.slice(8)), shrimp.notDays], [2, 4, ['07', '08', '09', '10'], 12],
    'Sep 7 and 8 cast shadows over Sep 7 to 10, four days, not six');
  assert.ok(!r.standing.includes(shrimp) && r.compared === 2, 'two days eaten is a single coincidence: shrimp is not compared; eggs and the rolls are');
  // Always eaten together: one row, both named.
  const rolls = byLabel(r.rows, "Annie's rolls");
  assert.deepEqual([rolls.eatenDays, rolls.also, byLabel(r.rows, 'Mini weenies')], [3, [{ kind: 'food', label: 'Mini weenies', id: 'weenies' }], undefined]);
  assert.ok(rolls.gap < 0 && rolls.notDays === 8, 'eaten on light days: compared, and below the other days');
  // Eaten most days: three-day shadows cover nearly everything, so there is nothing to compare against.
  assert.deepEqual(r.everyday.map((x) => [x.label, x.eatenDays, x.afterDays, x.notDays]), [['oat', 16, 16, 0], ['Almond milk', 4, 12, 4]],
    'almond milk every fourth day leaves only Sep 5, 9, 13, 17 outside its shadow: fewer than 5, so it is set aside');
  assert.deepEqual(byLabel(r.rows, 'oat').also, [{ kind: 'food', label: 'Oatmeal', id: 'oat' }]);
  assert.equal(r.rows.length, 7, 'egg, oat, shellfish, Almond milk, the rolls, Sesame bar, Coke zero');
  // Not eaten on enough separate days yet: named as such, closest to enough first.
  assert.deepEqual(r.few.map((x) => [x.label, x.eatenDays]), [['Coke zero', 2], ['shellfish', 2], ['Sesame bar', 1]], 'closest to enough first, then by name');
  assert.equal(r.compared + r.everyday.length + r.few.length, r.rows.length, 'every food is in exactly one of compared, everyday, or few');
  assert.ok(byLabel(r.rows, 'Coke zero').eatenDays === 2 && byLabel(r.rows, 'Coke zero').kind === 'name', 'older entries fold in by name; the Sep 2 one predates tracking');
  // The range chips narrow both sides.
  const recent = L.standingOut(s, { ...OPTS, fromDay: '2026-09-10' });
  const recentEgg = byLabel(recent.rows, 'egg');
  assert.deepEqual([recent.from, recent.loggedDays, recentEgg.eatenDays, recentEgg.afterDays, recentEgg.notDays, recent.standing], ['2026-09-10', 11, 2, 6, 5, []],
    'from Sep 10 the eggs have two days eaten: not enough');
  // Gut symptoms on most days regardless: nothing separates, and that is the answer.
  const heavy = [];
  for (let d = 5; d <= 20; d++) heavy.push(sym(`x${d}`, `${day(d)}T11:00`, 'gas', 2), sym(`y${d}`, `${day(d)}T11:30`, 'spitup', 2));
  const even = L.standingOut({ ...s, symptomLog: [...s.symptomLog, ...heavy] }, OPTS);
  assert.ok(near(even.rows.find((x) => x.label === 'egg').gap, 16 / 3 - 4), 'the egg days still average more (5.33 against 4)');
  assert.deepEqual([even.standing, even.compared], [[], 2], 'but not by 1.5');
  // Skin and crying alone move nothing: the same diary with those added everywhere reads the same.
  const noise = [];
  for (let d = 5; d <= 20; d++) noise.push(sym(`z${d}`, `${day(d)}T12:00`, 'crying', 3), sym(`v${d}`, `${day(d)}T12:30`, 'skin', 3, ['hives']));
  assert.deepEqual(L.standingOut({ ...s, symptomLog: [...s.symptomLog, ...noise] }, OPTS).rows.map((x) => [x.label, x.avgAfter, x.avgNot]), r.rows.map((x) => [x.label, x.avgAfter, x.avgNot]));
  assert.deepEqual(L.standingOut(s, { ...OPTS, who: 'baby' }).rows, [], 'nothing eaten directly yet');
});

test('standing out: one heavy stretch cannot carry a food; every eating has to be heavier than the days outside', () => {
  const foodLog = [], symptomLog = [];
  for (let d = 1; d <= 20; d++) foodLog.push(picked(`t${d}`, d, 'Toast', ['t'], [], '08:00'));
  for (const d of [9, 14, 19]) foodLog.push(picked(`p${d}`, d, 'Pepper', ['pep']));
  symptomLog.push(sym('s5', `${day(5)}T09:00`, 'crying', 1));   // tracking begins Sep 5 with any symptom, scored or not
  for (const d of [9, 14]) symptomLog.push(sym(`b${d}`, `${day(d)}T15:00`, 'stool', 3, [], { consistency: 'watery' }), sym(`c${d}`, `${day(d)}T15:10`, 'spitup', 3), sym(`k${d}`, `${day(d)}T15:20`, 'gas', 3));   // 9
  const s = diary({ foodItems: [item('t', 'Toast'), item('pep', 'Pepper')], foodLog, symptomLog });
  const r = L.standingOut(s, OPTS);
  const pepper = byLabel(r.rows, 'Pepper');
  assert.deepEqual([pepper.eatenDays, pepper.afterDays, pepper.notDays, pepper.heavier], [3, 8, 8, 2], 'Sep 19 and 20 were quiet: that eating is not higher than the days outside');
  assert.ok(pepper.gap >= L.STANDOUT_GAP && L.STANDOUT_GAP === 1.5, 'the two bad days lift the average past the gap on their own');
  assert.deepEqual([r.standing, r.compared], [[], 1], 'so pepper does not stand out');
  const third = L.standingOut({ ...s, symptomLog: [...symptomLog, sym('s19', `${day(19)}T15:00`, 'gas', 1)] }, OPTS);
  assert.deepEqual(third.standing.map((x) => [x.label, x.heavier]), [['Pepper', 3]], 'with the third stretch heavier too, it does');
  assert.equal(L.STANDOUT_MIN_EATEN, 3);
});

test('standing out: too few days is the normal answer, not a reason to loosen anything', () => {
  const sparse = diary({
    foodItems: [item('t', 'Toast')],
    foodLog: [1, 2, 3, 4, 5, 6, 7].map((d) => picked(`f${d}`, d, 'Toast', ['t'], [], '08:00')),
    symptomLog: [sym('s1', `${day(1)}T10:00`, 'crying', 1)],
  });
  const e = L.standingOut(sparse, { fromDay: '2026-08-20', today: day(7), who: 'parent' });
  assert.deepEqual([e.enough, e.loggedDays, e.standing, e.everyday, e.few, e.compared, e.rows.length], [false, 7, [], [], [], 0, 1],
    'seven days with entries: not enough for 3 eaten and 5 outside, and toast is neither an everyday food nor one eaten on too few days: one line covers it');
  assert.equal(L.STANDOUT_MIN_EATEN + L.STANDOUT_MIN_NOT, 8);
  const none = L.standingOut(diary({ foodLog: [food('f1', '2026-09-02T08:00', ['dairy'])] }), OPTS);
  assert.deepEqual([none.trackingStart, none.loggedDays, none.standing, none.rows], [null, 0, [], []], 'food but no symptom yet: tracking has not begun');
  assert.deepEqual(L.standingOut(diary(), OPTS).rows, []);
});

test('safe foods and tags are hers alone: left out of the comparison, kept by restore and merge, never set by the app', () => {
  const s = standoutDiary();
  const safeFood = { ...s, foodItems: s.foodItems.map((it) => (it.id === 'egg' ? { ...it, safe: true } : it)) };
  const r1 = L.standingOut(safeFood, OPTS);
  assert.deepEqual(r1.standing.map((x) => [x.label, x.also]), [['egg', []]], 'the food is out; the egg tag is its own thing until it is marked too');
  const safeBoth = { ...safeFood, settings: { ...s.settings, safeTags: ['egg'] } };
  const r2 = L.standingOut(safeBoth, OPTS);
  assert.deepEqual([r2.standing, r2.rows.map((x) => x.label), r2.compared, r2.everyday.length, r2.few.length], [[], ['oat', 'shellfish', 'Almond milk', "Annie's rolls", 'Sesame bar', 'Coke zero'], 1, 2, 3]);
  assert.deepEqual(L.newFoods({ ...s, foodItems: s.foodItems.map((it) => (it.id === 'ses' ? { ...it, safe: true } : it)) }, OPTS).map((n) => n.label),
    ["Annie's rolls", 'Mini weenies', 'Shrimp', 'Almond milk'], 'safe foods are left out of new foods too');
  // Restore keeps a true flag and drops anything else; merge unions the tags.
  const file = {
    ...L.freshState(), v: 2, onboarded: true, settings: { ...L.freshState().settings, safeTags: ['egg', '<b>'] },
    foodItems: [{ ...item('a', 'Apple'), safe: true }, { ...item('b', 'Bread'), safe: 'yes' }],
  };
  const back = L.readBackup(JSON.stringify(file)).state;
  assert.deepEqual(back.foodItems.map((it) => [it.id, it.safe]), [['a', true], ['b', undefined]]);
  assert.deepEqual(back.settings.safeTags, ['egg']);
  assert.deepEqual(L.normalizeState({ v: 2 }).settings.safeTags, []);
  const merged = L.mergeStates(diary({ settings: { ...L.freshState().settings, safeTags: ['egg'] } }), diary({ settings: { ...L.freshState().settings, safeTags: ['soy', 'egg'] } })).state;
  assert.deepEqual(merged.settings.safeTags, ['egg', 'soy']);
  const updated = L.readBackup(JSON.stringify({ ...L.freshState(), v: 1, onboarded: true, meals: [{ id: 'm', name: 'Toast, jam', tags: [], uncertain: [], useCount: 1, lastUsed: null }] })).state;
  assert.ok(updated.foodItems.length === 2 && updated.foodItems.every((it) => !('safe' in it)) && updated.settings.safeTags.length === 0, 'the update never marks anything safe');
});

test('new foods: first eaten in range, from the first symptom entry on, with that day and the two after against the other days', () => {
  const s = standoutDiary();
  const list = L.newFoods(s, OPTS);
  assert.deepEqual(list.map((n) => [n.label, n.day.slice(8), n.score, n.next.map((d) => d.score), n.otherDays]),
    [["Annie's rolls", '09', 1, [0, 5], 13], ['Mini weenies', '09', 1, [0, 5], 13], ['Sesame bar', '09', 1, [0, 5], 13], ['Shrimp', '07', 3, [1, 1], 13], ['Almond milk', '06', 5, [3, 1], 13]],
    'newest first; eggs, oatmeal, and coke zero were first eaten before tracking began, and tags are not foods here');
  assert.ok(near(list[2].others, (16 * 0 + 5 * 3 + 3 * 3 + 1 * 3 + 4 - 1 - 0 - 5) / 13), 'the other days leave out the three being described');
  assert.ok(list.every((n) => n.next.every((d) => !d.pending)));
  const late = L.newFoods({ ...s, foodItems: [...s.foodItems, item('pear', 'Pear'), item('plum', 'Plum')],
    foodLog: [...s.foodLog, picked('p19', 19, 'Pear', ['pear']), picked('p20', 20, 'Plum', ['plum'])] }, OPTS);
  assert.deepEqual(late.slice(0, 2).map((n) => [n.label, n.next.map((d) => [d.pending, d.score])]), [['Plum', [[true, null], [true, null]]], ['Pear', [[true, 0], [true, null]]]],
    'a day that is today or later is not over yet');
  const gap = L.newFoods(diary({ foodItems: [item('pear', 'Pear')],
    foodLog: [picked('p5', 5, 'Pear', ['pear']), picked('p9', 9, 'Pear', ['pear'])],
    symptomLog: [sym('s5', `${day(5)}T15:00`, 'gas', 2), sym('s9', `${day(9)}T15:00`, 'gas', 1)] }), OPTS);
  assert.deepEqual(gap.map((n) => [n.label, n.score, n.next.map((d) => [d.score, d.pending]), n.otherDays]), [['Pear', 2, [[null, false], [null, false]], 1]],
    'nothing logged on the two days after is said, not counted as quiet');
  assert.deepEqual(L.newFoods(s, { ...OPTS, who: 'baby' }), []);
  assert.deepEqual(L.newFoods(diary(), OPTS), []);
});

// ---- DST-adjacent days -------------------------------------------------------

test('DST: days bucket by local date and series never skip or repeat a day', () => {
  const log = [
    sym('a', '2026-03-08T01:30', 'gas', 1),
    sym('b', '2026-03-08T23:30', 'gas', 3),
    sym('c', '2026-11-01T01:30', 'spitup', 2),
  ];
  assert.equal(L.dayScore(log, '2026-03-08').score, 3);
  assert.deepEqual(L.scoreSeries(log, '2026-10-31', '2026-11-02').map((d) => [d.day, d.score]),
    [['2026-10-31', 0], ['2026-11-01', 2], ['2026-11-02', 0]]);
  assert.equal(L.scoreSeries(log, '2026-03-01', '2026-03-31').length, 31);
  assert.deepEqual([...L.bucketByDay(log).keys()], ['2026-03-08', '2026-11-01']);
});

test('DST: a 24h span after a time is 24 real hours across spring forward (the reintroduction watch counts this way)', () => {
  const log = [sym('in', '2026-03-08T12:30', 'gas', 2), sym('edge', '2026-03-08T13:00', 'gas', 1), sym('out', '2026-03-08T13:30', 'gas', 4)];
  const from = L.tsMs('2026-03-07T12:00');
  assert.deepEqual(L.symptomIndex(log).between(from, from + 24 * 3600000), { points: 3, count: 2 });
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
  assert.deepEqual(series.map((d) => [d.day, d.hasData, d.score]), [
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
  assert.deepEqual(added, { foodItems: 0, meals: 1, foodLog: 1, symptomLog: 1, phases: 0, symptomSets: 0 });
  assert.deepEqual(s.foodLog.map((e) => [e.id, e.tags.join()]), [['f1', 'wheat'], ['f2', 'soy']], 'current f1 wins');
  assert.equal(s.settings.windowHours, 48);
  assert.deepEqual(s.settings.customTags, [{ id: 'sesame', label: 'Sesame' }, { id: 'oats', label: 'Oats' }]);
  assert.deepEqual(s.settings.hiddenTags, ['corn', 'fish']);
  assert.deepEqual(s.settings.safeTags, [], 'diaries from before safe existed merge cleanly');
  assert.deepEqual(s.dismissed, ['f1:wheat', 'f2:soy']);
  assert.equal(s.babyName, 'Rowan', 'fills a missing name');
  assert.equal(s.lastBackup, '2026-09-10T10:00');
  assert.equal(JSON.stringify(current), before, 'current diary object untouched');
  assert.deepEqual(L.mergeStates(s, incoming).added, { foodItems: 0, meals: 0, foodLog: 0, symptomLog: 0, phases: 0, symptomSets: 0 }, 'merging twice adds nothing');
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
  assert.deepEqual(added, { foodItems: 0, meals: 0, foodLog: 0, symptomLog: 0, phases: 0, symptomSets: 1 });
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
    v: 1,   // an old backup: its meals are split into foods on the way in
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
  assert.deepEqual(s.meals.map((m) => [m.id, m.items.length, 'tags' in m]), [['m1', 1, false]], 'missing tag lists repaired, nameless meal dropped');
  assert.deepEqual(s.foodItems.map((it) => [it.label, it.tags, it.uncertain]), [['Toast', [], []]]);
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
  assert.equal(r.migrated, true, 'a version 1 diary is brought up to version 2');
  assert.equal(r.state.v, L.STATE_VERSION);
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
