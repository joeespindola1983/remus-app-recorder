const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

function loadActual(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = babel.transformFileSync(filename, {
    configFile: false,
    babelrc: false,
    presets: [require.resolve('@react-native/babel-preset')]
  }).code;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  mod._compile(compiled, filename);
  return mod.exports;
}

const { contextErrors, prepareContext, boatCapacity } = loadActual('src/types/recordingContext.ts');

const baseContext = () => ({
  schemaVersion: '1.0.0',
  dictionaryVersion: '1.7.0',
  recordingId: 'test-rec-1',
  activityId: 'act-1',
  ingestionChannel: 'native_capture',
  contextCompleteness: 'needs_required_context',
  sportDiscipline: 'rowing',
  rowingBoatClass: 'single_sculls',
  boatClassSystem: null,
  outriggerBoatClassCode: null,
  originalBoatClassCode: '1x',
  paddlerCapacity: null,
  sensorPlacement: 'hull',
  placementProvenance: 'user_declared',
  startedAt: '2026-09-08T12:00:00.000Z',
  endedAt: '2026-09-08T13:00:00.000Z',
  timeZoneId: null,
  timeZoneProvenance: 'unavailable',
  participants: [],
  seatNumberingConvention: 'source_declared',
  notes: ''
});

test('wizard boat mapping: simplified rowing boats produce valid catalog records', () => {
  const rowingBoats = [
    { key: '1x', classKey: 'single_sculls', expectedCapacity: 1 },
    { key: '2x', classKey: 'double_sculls', expectedCapacity: 2 },
    { key: '4x', classKey: 'quadruple_sculls', expectedCapacity: 4 },
    { key: '8+', classKey: 'eight', expectedCapacity: 8 },
  ];

  for (const boat of rowingBoats) {
    const ctx = {
      ...baseContext(),
      sportDiscipline: 'rowing',
      rowingBoatClass: boat.classKey,
      boatClassSystem: null,
      outriggerBoatClassCode: null,
      originalBoatClassCode: boat.key,
      paddlerCapacity: null,
    };
    assert.deepEqual(contextErrors(ctx), []);
    assert.equal(boatCapacity(ctx), boat.expectedCapacity);
  }
});

test('wizard boat mapping: simplified vaa boats produce valid catalog records', () => {
  const vaaBoats = [
    { code: 'oc1', system: 'outrigger_oc', expectedCapacity: 1 },
    { code: 'oc2', system: 'outrigger_oc', expectedCapacity: 2 },
    { code: 'oc3', system: 'outrigger_oc', expectedCapacity: 3 },
    { code: 'oc6', system: 'outrigger_oc', expectedCapacity: 6 },
    { code: 'v12', system: 'vaa_v', expectedCapacity: 12 },
  ];

  for (const boat of vaaBoats) {
    const ctx = {
      ...baseContext(),
      sportDiscipline: 'vaa',
      rowingBoatClass: null,
      boatClassSystem: boat.system,
      outriggerBoatClassCode: boat.code,
      originalBoatClassCode: boat.code.toUpperCase(),
      paddlerCapacity: boat.expectedCapacity,
    };
    assert.deepEqual(contextErrors(ctx), []);
    assert.equal(boatCapacity(ctx), boat.expectedCapacity);
  }
});

test('wizard crew assignment: optional athletes in assigned seats pass validation', () => {
  const ctx = {
    ...baseContext(),
    rowingBoatClass: 'eight',
    participants: [
      {
        activityParticipantId: 'act-1:participant:seat-1',
        personId: null,
        displayName: 'Lucas',
        crewSeatNumber: 1
      },
      {
        activityParticipantId: 'act-1:participant:seat-8',
        personId: null,
        displayName: 'Pedro',
        crewSeatNumber: 8
      }
    ]
  };

  assert.deepEqual(contextErrors(ctx), []);
  const finalized = prepareContext(ctx, true);
  assert.equal(finalized.contextCompleteness, 'complete');
  assert.equal(finalized.participants.length, 2);
});

test('wizard crew assignment: skipping crew members entirely produces valid finalization', () => {
  const ctx = {
    ...baseContext(),
    rowingBoatClass: 'quadruple_sculls',
    participants: []
  };

  assert.deepEqual(contextErrors(ctx), []);
  const finalized = prepareContext(ctx, true);
  assert.equal(finalized.contextCompleteness, 'complete');
  assert.equal(finalized.participants.length, 0);
});
