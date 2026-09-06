const test = require('node:test');
const assert = require('node:assert');

const VALID_PLACEMENTS = [
  'hull',
  'left_wrist',
  'right_wrist',
  'body',
  'oar',
  'unknown'
];

function validatePlacement(placement) {
  return VALID_PLACEMENTS.includes(placement);
}

function createInitialManifest(metadata) {
  return {
    id: metadata.sessionId,
    startedAt: metadata.startedAt,
    appVersion: metadata.appVersion,
    deviceModel: metadata.deviceModel,
    systemVersion: metadata.systemVersion,
    notes: metadata.notes,
    motionFrequencyHertz: metadata.motionFrequencyHertz,
    placement: metadata.placement,
    motionSampleCount: 0,
    locationSampleCount: 0,
    headingSampleCount: 0,
    altimeterSampleCount: 0,
    weatherSampleCount: 0,
    status: 'recording',
    databaseFilename: 'telemetry.sqlite'
  };
}

test('validates sensor placements according to C++ engine spec', () => {
  assert.strictEqual(validatePlacement('hull'), true);
  assert.strictEqual(validatePlacement('left_wrist'), true);
  assert.strictEqual(validatePlacement('right_wrist'), true);
  assert.strictEqual(validatePlacement('body'), true);
  assert.strictEqual(validatePlacement('oar'), true);
  assert.strictEqual(validatePlacement('unknown'), true);
  assert.strictEqual(validatePlacement('invalid_placement'), false);
});

test('creates a valid initial manifest with default counts', () => {
  const metadata = {
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    startedAt: '2026-09-05T14:30:00.000Z',
    appVersion: '1.0.0',
    deviceModel: 'iPhone 15 Pro',
    systemVersion: 'iOS 18.0',
    motionFrequencyHertz: 100,
    placement: 'hull',
    notes: 'Test sculling session'
  };

  const manifest = createInitialManifest(metadata);

  assert.strictEqual(manifest.id, metadata.sessionId);
  assert.strictEqual(manifest.status, 'recording');
  assert.strictEqual(manifest.motionSampleCount, 0);
  assert.strictEqual(manifest.locationSampleCount, 0);
  assert.strictEqual(manifest.headingSampleCount, 0);
  assert.strictEqual(manifest.altimeterSampleCount, 0);
  assert.strictEqual(manifest.databaseFilename, 'telemetry.sqlite');
  assert.strictEqual(manifest.placement, 'hull');
});

test('parses and validates manifest dates in standard and millisecond ISO8601 format', () => {
  const parseManifestDate = (dateStr) => {
    const timestamp = Date.parse(dateStr);
    if (isNaN(timestamp)) {
      throw new Error('Invalid date format');
    }
    return new Date(timestamp);
  };

  const isoStandard = '2026-09-05T23:36:38Z';
  const isoWithMillis = '2026-09-05T23:36:38.123Z';

  const date1 = parseManifestDate(isoStandard);
  const date2 = parseManifestDate(isoWithMillis);

  assert.strictEqual(date1.toISOString(), '2026-09-05T23:36:38.000Z');
  assert.strictEqual(date2.toISOString(), '2026-09-05T23:36:38.123Z');
});

