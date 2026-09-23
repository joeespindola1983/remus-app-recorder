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

const ptBR = require('../src/i18n/locales/pt-BR.json');
const enUS = require('../src/i18n/locales/en-US.json');

const { parseRemusDeviceTelemetry } = loadActual('src/contracts/remusDeviceContract.ts');

test('remusDeviceContract - parses complete telemetry line with GPS fix and SD logging', () => {
  // Formato: timestamp_us,ax,ay,az,gx,gy,gz,lat,lon,speed_kmh,sats,sd_lines
  const rawLine = "123456789,-0.012,-0.051,1.013,1.2,-0.5,0.8,-15.832792,-47.914102,5.40,8,1420";
  const result = parseRemusDeviceTelemetry(rawLine);

  assert.notStrictEqual(result, null);
  assert.strictEqual(result.timestampUs, 123456789);
  assert.strictEqual(result.acceleration.x, -0.012);
  assert.strictEqual(result.acceleration.y, -0.051);
  assert.strictEqual(result.acceleration.z, 1.013);
  assert.strictEqual(result.gyroscope.x, 1.2);
  assert.strictEqual(result.gyroscope.y, -0.5);
  assert.strictEqual(result.gyroscope.z, 0.8);
  assert.strictEqual(result.gps.latitude, -15.832792);
  assert.strictEqual(result.gps.longitude, -47.914102);
  assert.strictEqual(result.gps.speedKmph, 5.40);
  assert.strictEqual(result.gps.satellitesInView, 8);
  assert.strictEqual(result.gps.satellitesInUse, 8);
  assert.strictEqual(result.gps.fix, true);
  assert.strictEqual(result.sdCard.logging, true);
  assert.strictEqual(result.sdCard.linesWritten, 1420);
});

test('remusDeviceContract - parses telemetry line without GPS fix', () => {
  const rawLine = "987654321,-0.010,-0.050,1.000,0.0,0.0,0.0,,,,5,850";
  const result = parseRemusDeviceTelemetry(rawLine);

  assert.notStrictEqual(result, null);
  assert.strictEqual(result.timestampUs, 987654321);
  assert.strictEqual(result.acceleration.z, 1.000);
  assert.strictEqual(result.gps.latitude, null);
  assert.strictEqual(result.gps.longitude, null);
  assert.strictEqual(result.gps.speedKmph, null);
  assert.strictEqual(result.gps.satellitesInView, 5);
  assert.strictEqual(result.gps.satellitesInUse, 0);
  assert.strictEqual(result.gps.fix, false);
  assert.strictEqual(result.sdCard.logging, true);
  assert.strictEqual(result.sdCard.linesWritten, 850);
});

test('remusDeviceContract - parses explicit inUse/inView sats format (e.g. 0/5 and 8/14)', () => {
  // Case 1: Searching for fix, 0 in use, 5 in view
  const lineSearching = "1000000,-0.01,-0.05,1.0,0,0,0,,,,0/5,100,500,0.0";
  const res1 = parseRemusDeviceTelemetry(lineSearching);
  assert.notStrictEqual(res1, null);
  assert.strictEqual(res1.gps.fix, false);
  assert.strictEqual(res1.gps.satellitesInUse, 0);
  assert.strictEqual(res1.gps.satellitesInView, 5);

  // Case 2: Locked 3D fix, 8 in use, 14 in view
  const lineLocked = "1000000,-0.01,-0.05,1.0,0,0,0,-15.83,-47.91,5.2,8/14,200,1000,24.0";
  const res2 = parseRemusDeviceTelemetry(lineLocked);
  assert.notStrictEqual(res2, null);
  assert.strictEqual(res2.gps.fix, true);
  assert.strictEqual(res2.gps.satellitesInUse, 8);
  assert.strictEqual(res2.gps.satellitesInView, 14);

  // Case 3: Locked with SNR and Accuracy (e.g. 9/14:40:1.8m)
  const lineWithSnrAcc = "1000000,-0.01,-0.05,1.0,0,0,0,-15.83,-47.91,5.2,9/14:40:1.8m,200,1000,24.0";
  const res3 = parseRemusDeviceTelemetry(lineWithSnrAcc);
  assert.notStrictEqual(res3, null);
  assert.strictEqual(res3.gps.satellitesInUse, 9);
  assert.strictEqual(res3.gps.satellitesInView, 14);
  assert.strictEqual(res3.gps.snrDb, 40);
  assert.strictEqual(res3.gps.accuracyMeters, 1.8);
});

test('remusDeviceContract - parses strokeRateSpm when provided', () => {
  const lineWithSpm = "1000000,0,0,1,0,0,0,-15.8,-47.9,5.0,8,1000,50000,28.5";
  const result = parseRemusDeviceTelemetry(lineWithSpm);

  assert.notStrictEqual(result, null);
  assert.strictEqual(result.strokeRateSpm, 28.5);

  const lineZeroSpm = "1000000,0,0,1,0,0,0,-15.8,-47.9,5.0,8,1000,50000,0.0";
  const resultZero = parseRemusDeviceTelemetry(lineZeroSpm);
  assert.strictEqual(resultZero.strokeRateSpm, null);
});

test('remusDeviceContract - parses firmware 0.3 receiver-native GNSS quality fields', () => {
  const line = "1000,0,0,1,0,0,0,-15.8,-47.9,18.0,10/14:38:1.2m,500,9000,32.0,1,1,0,5,0,0,0.18,271.25000,1.50000,3,456789000";
  const result = parseRemusDeviceTelemetry(line);

  assert.notStrictEqual(result, null);
  assert.strictEqual(result.gps.groundSpeedMetersPerSecond, 5);
  assert.strictEqual(result.gps.speedAccuracyMetersPerSecond, 0.18);
  assert.strictEqual(result.gps.courseDegrees, 271.25);
  assert.strictEqual(result.gps.courseAccuracyDegrees, 1.5);
  assert.strictEqual(result.gps.fixType, 3);
  assert.strictEqual(result.gps.gpsTimeOfWeekMilliseconds, 456789000);
});


test('remusDeviceContract - rejects empty or corrupt lines safely', () => {
  assert.strictEqual(parseRemusDeviceTelemetry(''), null);
  assert.strictEqual(parseRemusDeviceTelemetry('corrupt,line'), null);
  assert.strictEqual(parseRemusDeviceTelemetry('abc,def,ghi'), null);
});

test('remusDeviceContract - verifies device localization keys in pt-BR and en-US', () => {
  const requiredKeys = [
    'tabs.device',
    'device.title',
    'device.status.connected',
    'device.status.disconnected',
    'device.status.scanning',
    'device.button.connect',
    'device.button.disconnect',
    'device.imu.title',
    'device.imu.gravity',
    'device.gps.title',
    'device.gps.satellites',
    'device.gps.fix',
    'device.gps.fixLocked',
    'device.gps.fixSearching',
    'device.sd.title',
    'device.sd.logging',
    'device.sd.lines',
    'recorder.remus.connectedLockedDetail',
    'recorder.remus.connectedSearchingDetail',
  ];

  requiredKeys.forEach((key) => {
    assert.ok(ptBR[key], `Missing key in pt-BR: ${key}`);
    assert.ok(enUS[key], `Missing key in en-US: ${key}`);
  });
});
