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

const { normalizeTelemetryEvent } = loadActual('src/contracts/telemetryContract.ts');

test('telemetryContract: empty event returns empty object when previous is empty or omitted', () => {
  assert.deepEqual(normalizeTelemetryEvent({}), {});
  assert.deepEqual(normalizeTelemetryEvent({}, {}), {});
});

test('telemetryContract: iOS-shaped event with NSNull converts null and preserves existing fields', () => {
  const previous = {
    groundSpeedMetersPerSecond: 5,
    distanceMeters: 100,
    horizontalAccuracyMeters: 3.5,
  };
  const event = {
    speedKmh: null,
    gpsAccuracyMeters: null,
  };
  const result = normalizeTelemetryEvent(event, previous);
  assert.equal(result.groundSpeedMetersPerSecond, null);
  assert.equal(result.horizontalAccuracyMeters, null);
  assert.equal(result.distanceMeters, 100);
});

test('telemetryContract: Android-shaped event (omitted fields) preserves previous state', () => {
  const previous = {
    groundSpeedMetersPerSecond: 4.2,
    distanceMeters: 550,
    headingDegrees: 180,
    horizontalAccuracyMeters: 2.0,
  };
  // Android omits gpsAccuracyMeters when not updated, but sends speedKmh and distanceMeters
  const event = {
    speedKmh: 18.0,
    distanceMeters: 560,
  };
  const result = normalizeTelemetryEvent(event, previous);
  assert.equal(result.groundSpeedMetersPerSecond, 5.0); // 18 / 3.6
  assert.equal(result.distanceMeters, 560);
  assert.equal(result.headingDegrees, 180);
  assert.equal(result.horizontalAccuracyMeters, 2.0);
});

test('telemetryContract: unit conversion for speed and wind (km/h to m/s)', () => {
  const event = {
    speedKmh: 36,
    weatherWindKmh: 18,
    headingDegrees: 0,
  };
  const result = normalizeTelemetryEvent(event);
  assert.equal(result.groundSpeedMetersPerSecond, 10);
  assert.equal(result.windSpeedMetersPerSecond, 5);
  assert.equal(result.headingDegrees, 0);
});

test('telemetryContract: rotation vector normalization requires all 3 axes', () => {
  const complete = normalizeTelemetryEvent({
    rotationXRad: 0.1,
    rotationYRad: 0.2,
    rotationZRad: 0.3,
  });
  assert.deepEqual(complete.rotationRateRadiansPerSecond, { x: 0.1, y: 0.2, z: 0.3 });

  const incomplete = normalizeTelemetryEvent({
    rotationXRad: 0.1,
    rotationYRad: null,
    rotationZRad: 0.3,
  });
  assert.equal(incomplete.rotationRateRadiansPerSecond, null);
});

test('telemetryContract: non-finite or invalid types are safely converted to null', () => {
  const invalid = normalizeTelemetryEvent({
    speedKmh: NaN,
    distanceMeters: Infinity,
    gpsAccuracyMeters: 'invalid',
  });
  assert.equal(invalid.groundSpeedMetersPerSecond, null);
  assert.equal(invalid.distanceMeters, null);
  assert.equal(invalid.horizontalAccuracyMeters, null);
});

test('telemetryContract: stroke rate strings and numeric properties normalize correctly', () => {
  const result = normalizeTelemetryEvent({
    strokeRateSpm: 24.5,
    strokeRateStatus: 'available',
    strokeRateReason: 'collecting_window',
    strokeRateAlgorithmVersion: '1.0',
    strokeRateOrigin: 'phone_accel',
  });
  assert.equal(result.strokeRateSpm, 24.5);
  assert.equal(result.strokeRateStatus, 'available');
  assert.equal(result.strokeRateReason, 'collecting_window');
  assert.equal(result.strokeRateAlgorithmVersion, '1.0');
  assert.equal(result.strokeRateOrigin, 'phone_accel');
});

test('telemetryContract: speedOrigin and courseOrigin normalize correctly', () => {
  const result = normalizeTelemetryEvent({
    speedKmh: 10.8,
    speedOrigin: 'coordinate_derived',
    courseDegrees: 90,
    courseOrigin: 'reported',
  });
  assert.equal(result.groundSpeedMetersPerSecond, 3.0);
  assert.equal(result.speedOrigin, 'coordinate_derived');
  assert.equal(result.courseDegrees, 90);
  assert.equal(result.courseOrigin, 'reported');

  const unavailable = normalizeTelemetryEvent({
    speedKmh: null,
    speedOrigin: 'unavailable',
    courseDegrees: null,
    courseOrigin: 'unavailable',
  });
  assert.equal(unavailable.groundSpeedMetersPerSecond, null);
  assert.equal(unavailable.speedOrigin, 'unavailable');
  assert.equal(unavailable.courseDegrees, null);
  assert.equal(unavailable.courseOrigin, 'unavailable');
});

