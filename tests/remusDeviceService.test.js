const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

const moduleCache = new Map();
const nativeListeners = new Map();
const sentCommands = [];
const savedFiles = [];

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

const { RemusDeviceService } = loadActual('src/services/remusDeviceService.ts', {
  'react-native': {
    NativeModules: {
      RemusTelemetryModule: {
        connectRemusBle: async () => true,
        disconnectRemusBle: async () => true,
        sendRemusBleCommand: async (cmd) => {
          sentCommands.push(cmd);
          return true;
        },
        saveRemusSessionFile: async (recordingId, filename, base64) => {
          savedFiles.push({ recordingId, filename, base64 });
          return `/sessions/${recordingId}/remus_sensor.rbp2`;
        },
      },
    },
    NativeEventEmitter: class MockEmitter {
      addListener(name, listener) {
        nativeListeners.set(name, listener);
        return { remove: () => nativeListeners.delete(name) };
      }
      removeAllListeners() {}
    },
  },
});

test('remusDeviceService - initial state is disconnected', () => {
  const service = new RemusDeviceService();
  assert.strictEqual(service.getConnectionState(), 'disconnected');
  assert.strictEqual(service.getLatestTelemetry(), null);
});

test('remusDeviceService - emits telemetry to subscribers when telemetry received', () => {
  const service = new RemusDeviceService();
  let received = null;
  const unsubscribe = service.subscribe((telemetry) => {
    received = telemetry;
  });

  const rawSample = "1000000,-0.010,-0.050,1.010,0.1,-0.2,0.3,-15.832792,-47.914102,5.2,7,500";
  service.handleIncomingRawLine(rawSample);

  assert.notStrictEqual(received, null);
  assert.strictEqual(received.acceleration.z, 1.010);
  assert.strictEqual(received.gps.satellitesInView, 7);
  assert.strictEqual(received.sdCard.linesWritten, 500);

  unsubscribe();
  service.handleIncomingRawLine("2000000,0,0,1,0,0,0,-15,-47,0,5,550");
  assert.strictEqual(received.timestampUs, 1000000);
});

test('remusDeviceService - connect changes state and disconnect resets it', async () => {
  const service = new RemusDeviceService();

  await service.connect('REMUS-ESP32');
  assert.strictEqual(service.getConnectionState(), 'connected');
  assert.strictEqual(service.getConnectedDeviceName(), 'REMUS-ESP32');

  service.disconnect();
  assert.strictEqual(service.getConnectionState(), 'disconnected');
  assert.strictEqual(service.getConnectedDeviceName(), null);
});

test('remusDeviceService - ensureConnection connects when disconnected and is idempotent when already connected', async () => {
  const service = new RemusDeviceService();
  assert.strictEqual(service.getConnectionState(), 'disconnected');

  const res1 = await service.ensureConnection('REMUS-ESP32');
  assert.strictEqual(res1, true);
  assert.strictEqual(service.getConnectionState(), 'connected');

  // Calling again should return true without re-scanning
  const res2 = await service.ensureConnection('REMUS-ESP32');
  assert.strictEqual(res2, true);
  assert.strictEqual(service.getConnectionState(), 'connected');
});

test('remusDeviceService - position-only GPS aiding is disabled', async () => {
  const service = new RemusDeviceService();
  // When disconnected, sendAiding should return false
  const discResult = await service.sendAiding(-15.83257, -47.91404, 1172.5);
  assert.strictEqual(discResult, false);

  // Connect
  await service.connect('REMUS-ESP32');
  assert.strictEqual(service.getConnectionState(), 'connected');

  // A phone coordinate is not valid u-blox assistance data, even when connected.
  const connResult = await service.sendAiding(-15.83257, -47.91404, 1172.5);
  assert.strictEqual(connResult, false);
});

test('remusDeviceService - startWorkout and stopWorkout send BLE commands when connected', async () => {
  const service = new RemusDeviceService();
  // When disconnected, should return false
  assert.strictEqual(await service.startWorkout(), false);
  assert.strictEqual(await service.stopWorkout(), false);

  // When connected, should return true
  await service.connect('REMUS-ESP32');
  assert.strictEqual(await service.startWorkout(), true);
  assert.strictEqual(await service.stopWorkout(), true);
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function fileChunk(offset, payload) {
  const frame = Buffer.alloc(7 + payload.length);
  frame[0] = 0x20;
  frame.writeUInt32LE(offset, 1);
  frame.writeUInt16LE(payload.length, 5);
  payload.copy(frame, 7);
  return frame.toString('base64');
}

test('remusDeviceService - downloads a complete RBP2 file and validates firmware CRC', async () => {
  sentCommands.length = 0;
  const service = new RemusDeviceService();
  await service.connect('REMUS-ESP32');

  const file = Buffer.from('RBP2complete-file-evidence');
  const progress = [];
  const resultPromise = service.downloadSessionFile(
    (percent, received, total) => progress.push([percent, received, total]),
    'session.rbp2'
  );
  await new Promise(resolve => setImmediate(resolve));

  const emit = nativeListeners.get('onRemusDeviceTelemetry');
  assert.ok(emit);
  emit({ csv: `FILE_START:session.rbp2:${file.length}` });
  emit({ rawBase64: fileChunk(0, file.subarray(0, 9)) });
  emit({ rawBase64: fileChunk(9, file.subarray(9)) });
  emit({ csv: `FILE_END:session.rbp2:${file.length}:${crc32(file).toString(16).padStart(8, '0')}` });

  const result = await resultPromise;
  assert.strictEqual(sentCommands.at(-1), 'GET session.rbp2');
  assert.strictEqual(result.filename, 'session.rbp2');
  assert.deepStrictEqual(result.data, file);
  assert.deepStrictEqual(progress.at(-1), [100, file.length, file.length]);
});

test('remusDeviceService - rejects incomplete or corrupted BLE file evidence', async () => {
  const service = new RemusDeviceService();
  await service.connect('REMUS-ESP32');
  const file = Buffer.from('RBP2missing-tail');
  const resultPromise = service.downloadSessionFile();
  await new Promise(resolve => setImmediate(resolve));

  const emit = nativeListeners.get('onRemusDeviceTelemetry');
  emit({ csv: `FILE_START:session.rbp2:${file.length}` });
  emit({ rawBase64: fileChunk(0, file.subarray(0, 8)) });
  emit({ csv: `FILE_END:session.rbp2:${file.length}:${crc32(file).toString(16).padStart(8, '0')}` });

  await assert.rejects(resultPromise, /INCOMPLETE_TRANSFER/);
});

test('remusDeviceService - persists a validated artifact in the phone recording package', async () => {
  savedFiles.length = 0;
  const service = new RemusDeviceService();
  const data = Buffer.from('RBP2artifact');
  const path = await service.persistDownloadedFile('recording-1', {
    filename: '/remus_sensor_1.bin',
    data,
  });

  assert.strictEqual(path, '/sessions/recording-1/remus_sensor.rbp2');
  assert.deepStrictEqual(savedFiles, [{
    recordingId: 'recording-1',
    filename: '/remus_sensor_1.bin',
    base64: data.toString('base64'),
  }]);
});
