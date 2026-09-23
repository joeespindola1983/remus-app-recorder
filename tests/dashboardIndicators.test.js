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

const { getGpsSignalLevel, resolveHeartRateDisplay, resolveRemusAntennaStatus, formatRemusGpsBadge } = loadActual('src/utils/dashboardIndicators.ts');

test('getGpsSignalLevel returns level 3 (green, 3 bars) for accuracy < 6m', () => {
  const res1 = getGpsSignalLevel(2.5);
  assert.strictEqual(res1.level, 3);
  assert.strictEqual(res1.bars, 3);
  assert.strictEqual(res1.color, '#22C55E');

  const res2 = getGpsSignalLevel(5.9);
  assert.strictEqual(res2.level, 3);
  assert.strictEqual(res2.bars, 3);
  assert.strictEqual(res2.color, '#22C55E');
});

test('getGpsSignalLevel returns level 2 (yellow, 2 bars) for accuracy between 6m and 15m', () => {
  const res1 = getGpsSignalLevel(6.0);
  assert.strictEqual(res1.level, 2);
  assert.strictEqual(res1.bars, 2);
  assert.strictEqual(res1.color, '#EAB308');

  const res2 = getGpsSignalLevel(10.5);
  assert.strictEqual(res2.level, 2);
  assert.strictEqual(res2.bars, 2);
  assert.strictEqual(res2.color, '#EAB308');

  const res3 = getGpsSignalLevel(15.0);
  assert.strictEqual(res3.level, 2);
  assert.strictEqual(res3.bars, 2);
  assert.strictEqual(res3.color, '#EAB308');
});

test('getGpsSignalLevel returns level 1 (red, 1 bar) for accuracy > 15m', () => {
  const res1 = getGpsSignalLevel(15.1);
  assert.strictEqual(res1.level, 1);
  assert.strictEqual(res1.bars, 1);
  assert.strictEqual(res1.color, '#EF4444');

  const res2 = getGpsSignalLevel(45.0);
  assert.strictEqual(res2.level, 1);
  assert.strictEqual(res2.bars, 1);
  assert.strictEqual(res2.color, '#EF4444');
});

test('getGpsSignalLevel returns level 0 (dimmed, 0 bars) for null, undefined or non-positive values', () => {
  assert.deepStrictEqual(getGpsSignalLevel(null), { level: 0, bars: 0, color: '#64748B' });
  assert.deepStrictEqual(getGpsSignalLevel(undefined), { level: 0, bars: 0, color: '#64748B' });
  assert.deepStrictEqual(getGpsSignalLevel(0), { level: 0, bars: 0, color: '#64748B' });
  assert.deepStrictEqual(getGpsSignalLevel(-1), { level: 0, bars: 0, color: '#64748B' });
});

test('resolveHeartRateDisplay shows red heart when watch is active, even without sample', () => {
  const res = resolveHeartRateDisplay({
    isWatchActive: true,
    lastHeartRate: null,
    now: 100000,
  });
  assert.strictEqual(res.isActive, true);
  assert.strictEqual(res.color, '#EF4444');
  assert.strictEqual(res.icon, '♥');
  assert.strictEqual(res.value, '—');
});

test('resolveHeartRateDisplay shows red heart with bpm value when watch is active and sample exists', () => {
  const res = resolveHeartRateDisplay({
    isWatchActive: true,
    lastHeartRate: { value: 142.4, timestamp: 95000 },
    now: 100000,
  });
  assert.strictEqual(res.isActive, true);
  assert.strictEqual(res.color, '#EF4444');
  assert.strictEqual(res.icon, '♥');
  assert.strictEqual(res.value, '142');
});

test('resolveHeartRateDisplay shows gray outline when watch is inactive and no sample', () => {
  const res = resolveHeartRateDisplay({
    isWatchActive: false,
    lastHeartRate: null,
    now: 100000,
  });
  assert.strictEqual(res.isActive, false);
  assert.strictEqual(res.color, '#94A3B8');
  assert.strictEqual(res.icon, '♡');
  assert.strictEqual(res.value, '—');
});

test('resolveHeartRateDisplay shows red heart if recent sample exists (< 20s) even if isWatchActive is false', () => {
  const res = resolveHeartRateDisplay({
    isWatchActive: false,
    lastHeartRate: { value: 138, timestamp: 90000 },
    now: 100000, // 10s elapsed
  });
  assert.strictEqual(res.isActive, true);
  assert.strictEqual(res.color, '#EF4444');
  assert.strictEqual(res.icon, '♥');
  assert.strictEqual(res.value, '138');
});

test('resolveHeartRateDisplay shows gray outline if sample is stale (> 20s) and watch is inactive', () => {
  const res = resolveHeartRateDisplay({
    isWatchActive: false,
    lastHeartRate: { value: 138, timestamp: 75000 },
    now: 100000, // 25s elapsed
  });
  assert.strictEqual(res.isActive, false);
  assert.strictEqual(res.color, '#94A3B8');
  assert.strictEqual(res.icon, '♡');
  assert.strictEqual(res.value, '138');
});

test('resolveRemusAntennaStatus returns no_uart when gps is null or charsProcessed is 0', () => {
  const resNull = resolveRemusAntennaStatus(null);
  assert.strictEqual(resNull.quality, 'no_uart');
  assert.strictEqual(resNull.bars, 0);
  assert.strictEqual(resNull.titleKey, 'device.gps.antennaNoUart');

  const resZero = resolveRemusAntennaStatus({ charsProcessed: 0, satellitesInView: 0, satellitesInUse: 0, fix: false });
  assert.strictEqual(resZero.quality, 'no_uart');
  assert.strictEqual(resZero.bars, 0);
  assert.strictEqual(resZero.titleKey, 'device.gps.antennaNoUart');
});

test('resolveRemusAntennaStatus returns no_rf when UART works but no sats or RF detected', () => {
  const res = resolveRemusAntennaStatus({
    charsProcessed: 1420,
    snrDb: 0,
    satellitesInView: 0,
    satellitesInUse: 0,
    fix: false,
  });
  assert.strictEqual(res.quality, 'no_rf');
  assert.strictEqual(res.bars, 0);
  assert.strictEqual(res.titleKey, 'device.gps.antennaNoRf');
});

test('resolveRemusAntennaStatus returns weak when SNR < 26 dB-Hz', () => {
  const res = resolveRemusAntennaStatus({
    charsProcessed: 3200,
    snrDb: 22,
    satellitesInView: 4,
    satellitesInUse: 0,
    fix: false,
  });
  assert.strictEqual(res.quality, 'weak');
  assert.strictEqual(res.bars, 1);
  assert.strictEqual(res.titleKey, 'device.gps.antennaWeak');
  assert.strictEqual(res.snrFormatted, '22 dB-Hz');
});

test('resolveRemusAntennaStatus returns regular when SNR is between 26 and 29 dB-Hz', () => {
  const res = resolveRemusAntennaStatus({
    charsProcessed: 4500,
    snrDb: 28,
    satellitesInView: 7,
    satellitesInUse: 2,
    fix: false,
  });
  assert.strictEqual(res.quality, 'regular');
  assert.strictEqual(res.bars, 2);
  assert.strictEqual(res.titleKey, 'device.gps.antennaRegular');
  assert.strictEqual(res.snrFormatted, '28 dB-Hz');
});

test('resolveRemusAntennaStatus returns excellent when SNR >= 30 dB-Hz or 3D fix locked', () => {
  const res1 = resolveRemusAntennaStatus({
    charsProcessed: 7800,
    snrDb: 34,
    satellitesInView: 9,
    satellitesInUse: 5,
    accuracyMeters: 2.5,
    fix: true,
  });
  assert.strictEqual(res1.quality, 'excellent');
  assert.strictEqual(res1.bars, 4);
  assert.strictEqual(res1.titleKey, 'device.gps.antennaExcellent');
  assert.strictEqual(res1.snrFormatted, '34 dB-Hz');
  assert.strictEqual(res1.accuracyFormatted, '± 2.5m');
  assert.strictEqual(res1.satellitesFormatted, '5 / 9');
});

test('formatRemusGpsBadge formats satellites and accuracy in meters when fix is active', () => {
  const badge1 = formatRemusGpsBadge({ satellites: 4, accuracyMeters: 5.2, fix: true });
  assert.strictEqual(badge1, '📡 4 sats · 5m');

  const badge2 = formatRemusGpsBadge({ satellites: 8, accuracyMeters: 3.0, fix: true });
  assert.strictEqual(badge2, '📡 8 sats · 3m');

  const badge3 = formatRemusGpsBadge({ satellites: 3, accuracyMeters: 9.8, fix: true });
  assert.strictEqual(badge3, '📡 3 sats · 10m');
});

test('formatRemusGpsBadge falls back to 3D when fix is active but accuracy is null or zero', () => {
  const badge1 = formatRemusGpsBadge({ satellites: 6, accuracyMeters: null, fix: true });
  assert.strictEqual(badge1, '📡 6 sats · 3D');

  const badge2 = formatRemusGpsBadge({ satellites: 5, accuracyMeters: 0, fix: true });
  assert.strictEqual(badge2, '📡 5 sats · 3D');
});

test('formatRemusGpsBadge formats searching state with satellite count and localized searching label', () => {
  const badgePt = formatRemusGpsBadge({ satellites: 4, accuracyMeters: null, fix: false, searchingLabel: 'buscando' });
  assert.strictEqual(badgePt, '⏳ 4 sats · buscando');

  const badgeEn = formatRemusGpsBadge({ satellites: 0, accuracyMeters: null, fix: false, searchingLabel: 'searching' });
  assert.strictEqual(badgeEn, '⏳ 0 sats · searching');
});

test('formatRemusGpsBadge includes accuracy distance even if fix is not full if valid distance is reported', () => {
  const badge = formatRemusGpsBadge({ satellites: 4, accuracyMeters: 14.8, fix: false });
  assert.strictEqual(badge, '⏳ 4 sats · 15m');
});
