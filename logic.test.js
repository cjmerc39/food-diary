// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';

// Pinned to a US zone with DST so 23h and 25h days behave the same on every
// machine. Safe to set after the import: logic.js creates no Dates on load.
process.env.TZ = 'America/New_York';

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

test('hoursBetween counts real elapsed hours, so DST days are 23h and 25h', () => {
  assert.equal(L.hoursBetween('2026-03-08T00:00', '2026-03-09T00:00'), 23);
  assert.equal(L.hoursBetween('2026-11-01T00:00', '2026-11-02T00:00'), 25);
  assert.equal(L.hoursBetween('2026-09-13T08:00', '2026-09-13T14:30'), 6.5);
});

// ---- phases ------------------------------------------------------------------

const phase = (start, end = null, extra = {}) =>
  ({ id: start, kind: 'eliminate', tag: 'dairy', start, end, note: '', ...extra });

test('phaseDay counts the start day as day 1', () => {
  assert.equal(L.phaseDay(phase('2026-09-01T00:00'), '2026-09-01T09:00'), 1);
  assert.equal(L.phaseDay(phase('2026-09-01T00:00'), '2026-09-12T23:59'), 12);
  // spans a DST change without drifting
  assert.equal(L.phaseDay(phase('2026-03-01T00:00'), '2026-03-15T08:00'), 15);
});

test('phaseDay stops at the end of a closed phase and is 0 before the start', () => {
  const closed = phase('2026-08-01T00:00', '2026-08-10T00:00');
  assert.equal(L.phaseDay(closed, '2026-09-13T12:00'), 10);
  assert.equal(L.phaseDay(phase('2026-09-20T00:00'), '2026-09-13T12:00'), 0);
});

test('isPhaseActive covers open, closed, and upcoming phases', () => {
  const now = '2026-09-13T12:00';
  assert.equal(L.isPhaseActive(phase('2026-09-01T00:00'), now), true);
  assert.equal(L.isPhaseActive(phase('2026-09-01T00:00', '2026-09-14T00:00'), now), true);
  assert.equal(L.isPhaseActive(phase('2026-09-01T00:00', '2026-09-10T00:00'), now), false);
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

// ---- tags --------------------------------------------------------------------

test('slugify makes stable ids from labels', () => {
  assert.equal(L.slugify('Tree nuts'), 'tree-nuts');
  assert.equal(L.slugify('Crème fraîche'), 'creme-fraiche');
  assert.equal(L.slugify('  Nightshades!! '), 'nightshades');
  assert.equal(L.slugify('Red dye #40'), 'red-dye-40');
  assert.equal(L.slugify('!!!'), '');
});

test('allTags lists starters then customs, and hidden tags stay resolvable', () => {
  const settings = {
    customTags: [{ id: 'oats', label: 'Oats' }, { id: 'dairy', label: 'Dupe' }, null],
    hiddenTags: ['corn', 'oats'],
  };
  const tags = L.allTags(settings);
  assert.equal(tags.length, 13);
  assert.deepEqual(tags[0], { id: 'dairy', label: 'Dairy', hidden: false });
  assert.deepEqual(tags[12], { id: 'oats', label: 'Oats', hidden: true });
  assert.equal(tags.find((t) => t.id === 'corn').hidden, true);
  assert.equal(L.tagLabel(settings, 'oats'), 'Oats');
  assert.equal(L.tagLabel(settings, 'mystery'), 'mystery');
  assert.equal(L.allTags(undefined).length, 12);
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
    meals: {}, dismissed: null, lastBackup: 'yesterday',
  });
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
