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

const {
  WATCH_CSV_HEADER,
  parseWatchTelemetryCsvLine,
  formatWatchTelemetryCsvLine
} = loadActual('src/contracts/watchTelemetryContract.ts');

test('watchTelemetryContract - header is correct', () => {
  assert.strictEqual(
    WATCH_CSV_HEADER,
    'timestamp_iso,elapsed_s,heart_rate_bpm,user_ax_g,user_ay_g,user_az_g,gravity_x_g,gravity_y_g,gravity_z_g,rotation_x_rads,rotation_y_rads,rotation_z_rads,roll_rad,pitch_rad,yaw_rad,latitude,longitude,speed_mps,accuracy_m,active_energy_kcal,battery_pct\n'
  );
});

test('watchTelemetryContract - parses complete valid CSV line', () => {
  const line = '2026-09-12T16:45:00.123Z,12.50,145.0,0.0512,-0.0234,0.9812,0.0102,-0.0210,-0.9991,0.0210,0.0120,-0.0540,0.0230,-0.1520,1.2340,-23.5505000,-46.6333000,3.20,4.5,15.2,85.0';
  const parsed = parseWatchTelemetryCsvLine(line);

  assert.notStrictEqual(parsed, null);
  assert.strictEqual(parsed.timestampIso, '2026-09-12T16:45:00.123Z');
  assert.strictEqual(parsed.elapsedSeconds, 12.5);
  assert.strictEqual(parsed.heartRateBpm, 145.0);
  assert.strictEqual(parsed.userAcceleration.x, 0.0512);
  assert.strictEqual(parsed.userAcceleration.y, -0.0234);
  assert.strictEqual(parsed.userAcceleration.z, 0.9812);
  assert.strictEqual(parsed.gravity.x, 0.0102);
  assert.strictEqual(parsed.gravity.y, -0.0210);
  assert.strictEqual(parsed.gravity.z, -0.9991);
  assert.strictEqual(parsed.rotationRate.x, 0.0210);
  assert.strictEqual(parsed.rotationRate.y, 0.0120);
  assert.strictEqual(parsed.rotationRate.z, -0.0540);
  assert.strictEqual(parsed.attitude.roll, 0.0230);
  assert.strictEqual(parsed.attitude.pitch, -0.1520);
  assert.strictEqual(parsed.attitude.yaw, 1.2340);
  assert.strictEqual(parsed.gps.latitude, -23.5505);
  assert.strictEqual(parsed.gps.longitude, -46.6333);
  assert.strictEqual(parsed.gps.speedMps, 3.2);
  assert.strictEqual(parsed.gps.accuracyMeters, 4.5);
  assert.strictEqual(parsed.activeEnergyKcal, 15.2);
  assert.strictEqual(parsed.batteryPercent, 85.0);
});

test('watchTelemetryContract - parses CSV line with missing/optional fields', () => {
  // 21 columns: iso, elapsed, hr, [3 uA], [3 g], [3 rot], [3 att], [4 gps], energy, batt
  const line = '2026-09-12T16:45:00.123Z,1.00,132.0,,,,,,,,,,,,,,,,,,35.0';
  const parsed = parseWatchTelemetryCsvLine(line);

  assert.notStrictEqual(parsed, null);
  assert.strictEqual(parsed.timestampIso, '2026-09-12T16:45:00.123Z');
  assert.strictEqual(parsed.elapsedSeconds, 1.0);
  assert.strictEqual(parsed.heartRateBpm, 132.0);
  assert.strictEqual(parsed.userAcceleration, null);
  assert.strictEqual(parsed.gravity, null);
  assert.strictEqual(parsed.rotationRate, null);
  assert.strictEqual(parsed.attitude, null);
  assert.strictEqual(parsed.gps, null);
  assert.strictEqual(parsed.batteryPercent, 35.0);
});

test('watchTelemetryContract - formatWatchTelemetryCsvLine formats correctly', () => {
  const record = {
    timestampIso: '2026-09-12T16:45:00.000Z',
    elapsedSeconds: 5.0,
    heartRateBpm: 150.0,
    userAcceleration: { x: 0.1, y: 0.2, z: 0.3 },
    gravity: { x: 0.0, y: 0.0, z: -1.0 },
    rotationRate: { x: 0.01, y: 0.02, z: 0.03 },
    attitude: { roll: 0.1, pitch: 0.2, yaw: 0.3 },
    gps: { latitude: -23.5, longitude: -46.6, speedMps: 2.5, accuracyMeters: 5.0 },
    activeEnergyKcal: 10.0,
    batteryPercent: 90.0
  };

  const line = formatWatchTelemetryCsvLine(record);
  assert.strictEqual(
    line,
    '2026-09-12T16:45:00.000Z,5.00,150.0,0.1000,0.2000,0.3000,0.0000,0.0000,-1.0000,0.0100,0.0200,0.0300,0.1000,0.2000,0.3000,-23.5000000,-46.6000000,2.50,5.0,10.0,90.0\n'
  );
});

test('watchTelemetryContract - rejects invalid line', () => {
  assert.strictEqual(parseWatchTelemetryCsvLine(''), null);
  assert.strictEqual(parseWatchTelemetryCsvLine('invalid,csv'), null);
});
