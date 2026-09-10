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

const { getGpsSignalLevel, resolveHeartRateDisplay } = loadActual('src/utils/dashboardIndicators.ts');

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
