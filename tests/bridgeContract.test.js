const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const moduleCache = new Map();

function loadActual(relative, mocks = {}) {
  const root = path.resolve(__dirname, '..');
  const filename = path.resolve(root, relative);
  if (moduleCache.has(filename)) {
    return moduleCache.get(filename);
  }

  const compiled = babel.transformFileSync(filename, {
    configFile: false,
    babelrc: false,
    presets: [require.resolve('@react-native/babel-preset')]
  }).code;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.')) {
      const dir = path.dirname(filename);
      const resolved = path.resolve(dir, name);
      const withExt = [resolved, resolved + '.ts', resolved + '.tsx', resolved + '.js', resolved + '.json'].find(p => fs.existsSync(p));
      if (withExt) {
        if (withExt.endsWith('.json')) {
          return JSON.parse(fs.readFileSync(withExt, 'utf8'));
        }
        return loadActual(path.relative(root, withExt), mocks);
      }
    }
    return originalRequire(name);
  };
  mod._compile(compiled, filename);
  moduleCache.set(filename, mod.exports);
  return mod.exports;
}

const { deleteSession, getRecordingState, stopRecording } = loadActual('src/contracts/bridgeContract.ts', {
  'react-native': {
    NativeModules: {
      RemusTelemetryModule: {
        getRecordingState: async () => ({ isRecording: false }),
        stopRecording: async () => ({ id: 'default', status: 'completed' }),
        deleteSession: async () => true,
      }
    },
    Platform: { OS: 'ios', Version: '18.0' },
    PermissionsAndroid: {}
  }
});

test('bridgeContract: deleteSession iOS path (resolves false) returns false', async () => {
  const mockBridge = {
    deleteSession: async () => false
  };
  const result = await deleteSession('non-existent-id', mockBridge);
  assert.equal(result, false);
});

test('bridgeContract: deleteSession Android path (rejects NOT_FOUND) returns false', async () => {
  const mockBridge = {
    deleteSession: async () => {
      const err = new Error('Session folder not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
  };
  const result = await deleteSession('non-existent-id', mockBridge);
  assert.equal(result, false);
});

test('bridgeContract: deleteSession success returns true', async () => {
  const mockBridge = {
    deleteSession: async () => true
  };
  const result = await deleteSession('valid-id', mockBridge);
  assert.equal(result, true);
});

test('bridgeContract: getRecordingState iOS (missing motionSampleCount) defaults to 0', async () => {
  const mockBridge = {
    getRecordingState: async () => ({
      isRecording: true,
      sessionId: 'test-session',
      elapsedSeconds: 12.5
    })
  };
  const state = await getRecordingState(mockBridge);
  assert.equal(state.isRecording, true);
  assert.equal(state.sessionId, 'test-session');
  assert.equal(state.elapsedSeconds, 12.5);
  assert.equal(state.motionSampleCount, 0);
});

test('bridgeContract: getRecordingState Android preserves motionSampleCount', async () => {
  const mockBridge = {
    getRecordingState: async () => ({
      isRecording: true,
      sessionId: 'test-session',
      elapsedSeconds: 12.5,
      motionSampleCount: 1250
    })
  };
  const state = await getRecordingState(mockBridge);
  assert.equal(state.motionSampleCount, 1250);
});

test('bridgeContract: stopRecording normalizes raw manifest', async () => {
  const mockBridge = {
    stopRecording: async () => ({
      id: 'session-123',
      status: 'interrupted'
    })
  };
  const manifest = await stopRecording(mockBridge);
  assert.equal(manifest.id, 'session-123');
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.headingSampleCount, 0);
  assert.equal(manifest.altimeterSampleCount, 0);
});

test('bridgeContract: requestWatchStopAndTransfer delegates to native bridge', async () => {
  const { BridgeContract } = loadActual('src/contracts/bridgeContract.ts');
  let requestedTimeout = null;
  const mockBridge = {
    requestWatchStopAndTransfer: async (timeout) => {
      requestedTimeout = timeout;
      return true;
    }
  };
  const contract = new BridgeContract(mockBridge);
  const result = await contract.requestWatchStopAndTransfer(5000);
  assert.equal(result, true);
  assert.equal(requestedTimeout, 5000);
});
