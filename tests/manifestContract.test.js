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

const { normalizeManifest } = loadActual('src/contracts/manifestContract.ts');

test('manifestContract: full iOS manifest passes through with normalized types', () => {
  const iosRaw = {
    id: '12345678-1234-1234-1234-123456789abc',
    startedAt: '2026-09-08T12:00:00.000Z',
    endedAt: '2026-09-08T13:00:00.000Z',
    appVersion: '2.1.0',
    deviceModel: 'iPhone 15 Pro',
    systemVersion: 'iOS 18.0',
    notes: 'Morning row',
    motionFrequencyHertz: 100,
    placement: 'hull',
    motionSampleCount: 360000,
    locationSampleCount: 3600,
    headingSampleCount: 3600,
    altimeterSampleCount: 3600,
    weatherSampleCount: 4,
    status: 'completed',
    failureMessage: undefined,
    databaseFilename: 'telemetry.sqlite'
  };

  const normalized = normalizeManifest(iosRaw);
  assert.deepEqual(normalized, iosRaw);
});

test('manifestContract: partial Android manifest fills default values for missing fields', () => {
  // Android stopRecording() currently returns only partial fields:
  const androidRaw = {
    id: 'abcdef12-3456-7890-abcd-ef1234567890',
    startedAt: '2026-09-08T12:00:00.000Z',
    endedAt: '2026-09-08T13:00:00.000Z',
    motionSampleCount: 350000,
    locationSampleCount: 3500,
    placement: 'hull',
    status: 'completed'
  };

  const normalized = normalizeManifest(androidRaw);
  assert.equal(normalized.id, 'abcdef12-3456-7890-abcd-ef1234567890');
  assert.equal(normalized.appVersion, 'unknown');
  assert.equal(normalized.deviceModel, 'unknown');
  assert.equal(normalized.systemVersion, 'unknown');
  assert.equal(normalized.notes, '');
  assert.equal(normalized.motionFrequencyHertz, 100);
  assert.equal(normalized.headingSampleCount, 0);
  assert.equal(normalized.altimeterSampleCount, 0);
  assert.equal(normalized.weatherSampleCount, 0);
  assert.equal(normalized.status, 'completed');
  assert.equal(normalized.databaseFilename, 'telemetry.sqlite');
});

test('manifestContract: maps status "interrupted" to "failed"', () => {
  const interrupted = {
    id: 'test-id',
    status: 'interrupted'
  };
  const normalized = normalizeManifest(interrupted);
  assert.equal(normalized.status, 'failed');
});

test('manifestContract: preserves valid status values', () => {
  assert.equal(normalizeManifest({ id: '1', status: 'recording' }).status, 'recording');
  assert.equal(normalizeManifest({ id: '2', status: 'completed' }).status, 'completed');
  assert.equal(normalizeManifest({ id: '3', status: 'failed' }).status, 'failed');
  assert.equal(normalizeManifest({ id: '4' }).status, 'completed');
});
