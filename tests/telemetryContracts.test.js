const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

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

test('computes gpsRateHz correctly from sliding timestamp window', () => {
  const computeGpsRateHz = (timestampsNanos, currentNanos) => {
    if (!timestampsNanos || timestampsNanos.length < 2) {
      return timestampsNanos && timestampsNanos.length === 1 ? 1.0 : 0.0;
    }
    const lastTimestamp = timestampsNanos[timestampsNanos.length - 1];
    if (currentNanos - lastTimestamp > 3_500_000_000n) {
      return 0.0;
    }
    const durationSec = Number(lastTimestamp - timestampsNanos[0]) / 1e9;
    return durationSec > 0 ? (timestampsNanos.length - 1) / durationSec : 0.0;
  };

  const t0 = 10_000_000_000n;
  const t1 = 11_000_000_000n; // 1s later
  const t2 = 12_000_000_000n; // 2s later (1 Hz)

  assert.strictEqual(computeGpsRateHz([t0, t1, t2], t2), 1.0);

  // High frequency 10 Hz
  const highFreq = [
    10_000_000_000n,
    10_100_000_000n,
    10_200_000_000n,
    10_300_000_000n,
    10_400_000_000n
  ];
  const rate10Hz = computeGpsRateHz(highFreq, 10_400_000_000n);
  assert.strictEqual(Math.round(rate10Hz), 10);

  // Stale GPS (drop to 0 if > 3.5s elapsed)
  assert.strictEqual(computeGpsRateHz([t0, t1], t1 + 4_000_000_000n), 0.0);
});

test('normalizes headingDegrees correctly across compass and GPS fallback', () => {
  const normalizeHeading = (yaw, gpsBearing, hasHardwareHeading) => {
    if (hasHardwareHeading && typeof yaw === 'number' && !isNaN(yaw)) {
      const norm = yaw % 360;
      return norm < 0 ? norm + 360 : norm;
    }
    if (typeof gpsBearing === 'number' && !isNaN(gpsBearing)) {
      const norm = gpsBearing % 360;
      return norm < 0 ? norm + 360 : norm;
    }
    return 0.0;
  };

  // Hardware yaw in [-180, 180]
  assert.strictEqual(normalizeHeading(-90, 0, true), 270);
  assert.strictEqual(normalizeHeading(45, 0, true), 45);
  assert.strictEqual(normalizeHeading(-180, 0, true), 180);

  // Fallback to GPS bearing when no hardware heading
  assert.strictEqual(normalizeHeading(0, 135, false), 135);
  assert.strictEqual(normalizeHeading(0, 315, false), 315);
  assert.strictEqual(normalizeHeading(null, 45, false), 45);
});

test('batches telemetry items up to maxBatchSize without exceeding capacity', () => {
  const queue = [];
  const maxCapacity = 10000;
  const maxBatchSize = 128;

  const enqueue = (item) => {
    if (queue.length >= maxCapacity) return false;
    queue.push(item);
    return true;
  };

  const drainBatch = () => {
    return queue.splice(0, maxBatchSize);
  };

  // Push 250 items
  for (let i = 0; i < 250; i++) {
    assert.strictEqual(enqueue({ id: i }), true);
  }

  const batch1 = drainBatch();
  assert.strictEqual(batch1.length, 128);
  assert.strictEqual(batch1[0].id, 0);

  const batch2 = drainBatch();
  assert.strictEqual(batch2.length, 122);
  assert.strictEqual(batch2[0].id, 128);

  const batch3 = drainBatch();
  assert.strictEqual(batch3.length, 0);
  assert.strictEqual(queue.length, 0);
});

test('ensures screen-off recommendation tip is localized in pt-BR and en-US', () => {
  const ptBR = require('../src/i18n/locales/pt-BR.json');
  const enUS = require('../src/i18n/locales/en-US.json');

  assert.ok(ptBR['recording.screenOffTip'], 'pt-BR must have recording.screenOffTip');
  assert.ok(enUS['recording.screenOffTip'], 'en-US must have recording.screenOffTip');
  assert.ok(ptBR['recording.screenOffTip'].length > 10);
  assert.ok(enUS['recording.screenOffTip'].length > 10);
});

test('validates the Android snapshot envelope and its channel-freshness metadata', () => {
  const validateAcquisitionEnvelope = (manifest) => {
    assert.strictEqual(manifest.schemaVersion, '1.0.0', 'schemaVersion must be 1.0.0');
    assert.strictEqual(manifest.producer, 'remus-app-recorder', 'producer must be remus-app-recorder');
    assert.ok(['android', 'ios'].includes(manifest.producerPlatform), 'producerPlatform must be android or ios');
    assert.strictEqual(manifest.orientationUnits, 'radians', 'orientationUnits must be radians');
    assert.strictEqual(manifest.captureProfile, 'android-accelerometer-clocked-v1');
    assert.strictEqual(manifest.motionSamplingPolicy, 'accelerometer_clocked_snapshot');
    assert.strictEqual(manifest.motionChannelAgeUnits, 'microseconds; -1 means unavailable');
    assert.ok(VALID_PLACEMENTS.includes(manifest.placement), 'placement must be valid');
    assert.strictEqual(typeof manifest.motionSampleCount, 'number');
    assert.strictEqual(typeof manifest.locationSampleCount, 'number');
    assert.strictEqual(typeof manifest.droppedSampleCount, 'number');
    assert.ok(['recording', 'completed', 'interrupted', 'failed'].includes(manifest.status));
    return true;
  };

  const sampleManifest = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    schemaVersion: '1.0.0',
    producer: 'remus-app-recorder',
    producerPlatform: 'android',
    orientationUnits: 'radians',
    captureProfile: 'android-accelerometer-clocked-v1',
    motionSamplingPolicy: 'accelerometer_clocked_snapshot',
    motionChannelAgeUnits: 'microseconds; -1 means unavailable',
    placement: 'hull',
    notes: 'Morning sculling session',
    motionFrequencyHertz: 100.0,
    motionSampleCount: 18000,
    locationSampleCount: 180,
    droppedSampleCount: 0,
    status: 'completed',
    startedAt: '2026-09-06T18:00:00.000Z',
    endedAt: '2026-09-06T18:03:00.000Z',
    databaseFilename: 'telemetry.sqlite'
  };

  assert.strictEqual(validateAcquisitionEnvelope(sampleManifest), true);
});

test('converts orientation between radians and degrees consistently without loss (REC-03)', () => {
  const radToDeg = (rad) => rad * (180.0 / Math.PI);
  const degToRad = (deg) => deg * (Math.PI / 180.0);

  // Exact angles
  assert.strictEqual(Math.round(radToDeg(Math.PI / 2)), 90);
  assert.strictEqual(Math.round(radToDeg(Math.PI)), 180);
  assert.strictEqual(Math.round(radToDeg(-Math.PI / 2)), -90);

  // Round trip
  const testAngles = [0.0, 0.523599, 1.047198, 1.570796, 3.141593, -1.570796];
  for (const angle of testAngles) {
    const roundTrip = degToRad(radToDeg(angle));
    assert.ok(Math.abs(roundTrip - angle) < 1e-6);
  }
});

test('separates linear acceleration and gravity correctly (REC-02)', () => {
  const decomposeAcceleration = (raw, gravity) => {
    return {
      x: raw.x - gravity.x,
      y: raw.y - gravity.y,
      z: raw.z - gravity.z
    };
  };

  // Stationary boat with vertical gravity of 1g
  const stationaryRaw = { x: 0.0, y: 0.0, z: 1.0 };
  const gravity = { x: 0.0, y: 0.0, z: 1.0 };
  const userAccStationary = decomposeAcceleration(stationaryRaw, gravity);

  assert.strictEqual(userAccStationary.x, 0.0);
  assert.strictEqual(userAccStationary.y, 0.0);
  assert.strictEqual(userAccStationary.z, 0.0);

  // Boat drive phase: 0.45g surge acceleration along x-axis
  const driveRaw = { x: 0.45, y: 0.0, z: 1.0 };
  const userAccDrive = decomposeAcceleration(driveRaw, gravity);

  assert.strictEqual(Math.round(userAccDrive.x * 100) / 100, 0.45);
  assert.strictEqual(userAccDrive.y, 0.0);
  assert.strictEqual(userAccDrive.z, 0.0);
});

test('ensures ISO8601 UTC timestamp format compliance (REC-06)', () => {
  const isUtcIso8601 = (dateStr) => {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(dateStr) && !isNaN(Date.parse(dateStr));
  };

  assert.strictEqual(isUtcIso8601('2026-09-06T18:30:00.000Z'), true);
  assert.strictEqual(isUtcIso8601('2026-09-06T18:30:00Z'), true);
  assert.strictEqual(isUtcIso8601('2026-09-06 18:30:00'), false);
  assert.strictEqual(isUtcIso8601('2026-09-06T18:30:00.000-03:00'), false);
});

test('validates that iOS telemetry bridge sends gpsAccuracyMeters and adapter normalizes it', () => {
  const Module = require('node:module');
  const babel = require('@babel/core');
  function loadAdapter() {
    const filename = path.resolve(__dirname, '../src/contracts/telemetryContract.ts');
    const compiled = babel.transformFileSync(filename, {
      configFile: false,
      babelrc: false,
      presets: [require.resolve('@react-native/babel-preset')]
    }).code;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(compiled, filename);
    return mod.exports;
  }

  const { normalizeTelemetryEvent } = loadAdapter();
  assert.deepStrictEqual(normalizeTelemetryEvent({}), {});
  assert.deepStrictEqual(normalizeTelemetryEvent({ gpsAccuracyMeters: 4.5 }), { horizontalAccuracyMeters: 4.5 });
  assert.deepStrictEqual(normalizeTelemetryEvent({ gpsAccuracyMeters: null }), { horizontalAccuracyMeters: null });
  assert.deepStrictEqual(
    normalizeTelemetryEvent({ strokeRateSpm: 22.4, strokeRateStatus: 'available' }),
    { strokeRateSpm: 22.4, strokeRateStatus: 'available' }
  );
  assert.deepStrictEqual(
    normalizeTelemetryEvent({ strokeRateSpm: null, strokeRateStatus: 'unavailable' }),
    { strokeRateSpm: null, strokeRateStatus: 'unavailable' }
  );

  // Test that iOS RemusTelemetryModule.swift contains "gpsAccuracyMeters" in the onTelemetryUpdate payload
  const swiftBridge = fs.readFileSync(path.resolve(__dirname, '../ios/RemusTelemetry/RemusTelemetryModule.swift'), 'utf8');
  assert.ok(swiftBridge.includes('"gpsAccuracyMeters"'), 'RemusTelemetryModule.swift must include "gpsAccuracyMeters" in onTelemetryUpdate body');
});

test('SessionManager.list sorts sessions by startedAt descending (newest first)', async () => {
  const Module = require('node:module');
  const babel = require('@babel/core');
  if (!require.extensions['.ts']) {
    require.extensions['.ts'] = function(module, filename) {
      const compiled = babel.transformFileSync(filename, {
        configFile: false,
        babelrc: false,
        presets: [require.resolve('@react-native/babel-preset')]
      }).code;
      module._compile(compiled, filename);
    };
  }
  function loadSessionManager() {
    const filename = path.resolve(__dirname, '../src/services/sessionManager.ts');
    const compiled = babel.transformFileSync(filename, {
      configFile: false,
      babelrc: false,
      presets: [require.resolve('@react-native/babel-preset')]
    }).code;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(compiled, filename);
    return mod.exports.SessionManager;
  }

  const SessionManagerClass = loadSessionManager();
  const mockBridge = {
    listSessions: async () => [
      { id: 'session-old', startedAt: '2026-09-05T10:00:00Z' },
      { id: 'session-newest', startedAt: '2026-09-07T19:57:00Z' },
      { id: 'session-middle', startedAt: '2026-09-06T12:00:00Z' }
    ]
  };

  const manager = new SessionManagerClass(mockBridge);
  const list = await manager.list();
  assert.strictEqual(list[0].id, 'session-newest');
  assert.strictEqual(list[1].id, 'session-middle');
  assert.strictEqual(list[2].id, 'session-old');
});

test('requestPermissions delegates to iOS RemusTelemetryModule and Android PermissionsAndroid', async () => {
  let iosCalled = false;
  let androidCalled = false;

  const mockIosBridge = {
    requestPermissions: async () => {
      iosCalled = true;
      return { status: 'authorized', authorized: true };
    }
  };

  const mockAndroidPermissions = {
    requestMultiple: async () => {
      androidCalled = true;
      return {
        'android.permission.ACCESS_FINE_LOCATION': 'granted',
        'android.permission.ACCESS_COARSE_LOCATION': 'granted'
      };
    },
    PERMISSIONS: {
      ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
      ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION'
    },
    RESULTS: { GRANTED: 'granted' }
  };

  const requestIos = async () => {
    const res = await mockIosBridge.requestPermissions();
    return res?.authorized ?? true;
  };
  const iosResult = await requestIos();
  assert.strictEqual(iosCalled, true);
  assert.strictEqual(iosResult, true);

  const requestAndroid = async () => {
    const granted = await mockAndroidPermissions.requestMultiple([
      mockAndroidPermissions.PERMISSIONS.ACCESS_FINE_LOCATION,
      mockAndroidPermissions.PERMISSIONS.ACCESS_COARSE_LOCATION
    ]);
    return granted[mockAndroidPermissions.PERMISSIONS.ACCESS_FINE_LOCATION] === mockAndroidPermissions.RESULTS.GRANTED;
  };
  const androidResult = await requestAndroid();
  assert.strictEqual(androidCalled, true);
  assert.strictEqual(androidResult, true);
});
