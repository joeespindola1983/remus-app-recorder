const test = require('node:test');
const assert = require('node:assert');

class SessionManager {
  constructor(bridge) {
    this.bridge = bridge;
    this.recording = false;
    this.currentSessionId = undefined;
  }

  isRecording() {
    return this.recording;
  }

  getCurrentSessionId() {
    return this.currentSessionId;
  }

  async start(params) {
    if (this.recording) {
      throw new Error('A recording is already in progress');
    }

    const result = await this.bridge.startRecording(params);
    this.recording = true;
    this.currentSessionId = result.sessionId;
    return result;
  }

  async stop() {
    if (!this.recording) {
      throw new Error('No recording session in progress');
    }

    try {
      const manifest = await this.bridge.stopRecording();
      return manifest;
    } finally {
      this.recording = false;
      this.currentSessionId = undefined;
    }
  }

  async list() {
    return await this.bridge.listSessions();
  }

  async delete(sessionId) {
    return await this.bridge.deleteSession(sessionId);
  }
}

test('SessionManager starts and stops recording cleanly', async () => {
  const mockBridge = {
    startRecording: async () => ({ folderUri: '/mock/session-1', sessionId: 'session-123' }),
    stopRecording: async () => ({
      id: 'session-123',
      startedAt: '2026-09-05T14:00:00Z',
      endedAt: '2026-09-05T14:10:00Z',
      motionSampleCount: 60000,
      locationSampleCount: 600,
      status: 'completed',
      placement: 'hull'
    }),
    listSessions: async () => [],
    deleteSession: async () => true,
    exportSessionZip: async () => '/mock/session-1.zip'
  };

  const manager = new SessionManager(mockBridge);

  assert.strictEqual(manager.isRecording(), false);

  const startRes = await manager.start({
    deviceModel: 'Test Device',
    systemVersion: '1.0',
    motionFrequencyHertz: 100,
    placement: 'hull',
    notes: 'Testing'
  });

  assert.strictEqual(startRes.sessionId, 'session-123');
  assert.strictEqual(manager.isRecording(), true);

  await assert.rejects(
    async () => {
      await manager.start({});
    },
    { message: 'A recording is already in progress' }
  );

  const manifest = await manager.stop();
  assert.strictEqual(manifest.status, 'completed');
  assert.strictEqual(manifest.motionSampleCount, 60000);
  assert.strictEqual(manager.isRecording(), false);
});
