const test = require('node:test');
const assert = require('node:assert');

class SyncService {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || 'https://remus-app-recorder-backend.onrender.com').replace(/\/+$/, '');
    this.bridge = options.bridge;
    this.fetchFn = options.fetchFn;
  }

  async checkSync(sessionIds, deviceId) {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/sessions/sync-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          deviceId: deviceId || 'mobile-app',
          sessionIds
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        requiredSessionIds: data.requiredSessionIds || [],
        existingSessionIds: data.existingSessionIds || []
      };
    } catch (e) {
      return {
        requiredSessionIds: [],
        existingSessionIds: [],
        error: e.message || 'Unknown network error'
      };
    }
  }

  async uploadSession(sessionId, zipPath) {
    const FormDataConstructor = globalThis.FormData || class MockFormData {
      constructor() { this.fields = []; }
      append(k, v) { this.fields.push({ k, v }); }
    };
    const formData = new FormDataConstructor();
    formData.append('file', { uri: zipPath, name: `${sessionId}.zip`, type: 'application/zip' });
    formData.append('sessionId', sessionId);

    const response = await this.fetchFn(`${this.baseUrl}/api/sessions/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
    return true;
  }

  async syncSessions(sessions) {
    const sessionIds = sessions.map(s => s.id);
    const checkResult = await this.checkSync(sessionIds);

    if (checkResult.error) {
      return {
        syncedCount: 0,
        skippedCount: 0,
        errors: [{ sessionId: 'all', error: checkResult.error }]
      };
    }

    const requiredSet = new Set(checkResult.requiredSessionIds);
    let syncedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const session of sessions) {
      if (!requiredSet.has(session.id)) {
        skippedCount++;
        continue;
      }

      try {
        const zipPath = await this.bridge.exportSessionZip(session.id);
        await this.uploadSession(session.id, zipPath);
        syncedCount++;
      } catch (e) {
        errors.push({
          sessionId: session.id,
          error: e.message || 'Upload error'
        });
      }
    }

    return {
      syncedCount,
      skippedCount,
      errors
    };
  }
}

test('SyncService checkSync queries backend and returns required sessions', async () => {
  const mockFetch = async (url, options) => {
    assert.ok(url.endsWith('/api/sessions/sync-check'));
    assert.strictEqual(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepStrictEqual(body.sessionIds, ['uuid-1', 'uuid-2']);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        requiredSessionIds: ['uuid-2'],
        existingSessionIds: ['uuid-1']
      })
    };
  };

  const syncService = new SyncService({
    baseUrl: 'https://remus-app-recorder-backend.onrender.com',
    fetchFn: mockFetch
  });

  const result = await syncService.checkSync(['uuid-1', 'uuid-2']);
  assert.deepStrictEqual(result.requiredSessionIds, ['uuid-2']);
  assert.deepStrictEqual(result.existingSessionIds, ['uuid-1']);
});

test('SyncService syncSessions exports and uploads only required sessions', async () => {
  const exported = [];
  const uploaded = [];

  const mockBridge = {
    exportSessionZip: async (id) => {
      exported.push(id);
      return `/path/to/exported-${id}.zip`;
    }
  };

  const mockFetch = async (url, options) => {
    if (url.endsWith('/api/sessions/sync-check')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          requiredSessionIds: ['session-2'],
          existingSessionIds: ['session-1']
        })
      };
    }
    if (url.endsWith('/api/sessions/upload')) {
      assert.strictEqual(options.method, 'POST');
      uploaded.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sessionId: 'session-2',
          status: 'STORED',
          sizeBytes: 1234
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const syncService = new SyncService({
    baseUrl: 'https://remus-app-recorder-backend.onrender.com',
    bridge: mockBridge,
    fetchFn: mockFetch
  });

  const sessions = [
    { id: 'session-1', sampleCount: 100 },
    { id: 'session-2', sampleCount: 200 }
  ];

  const report = await syncService.syncSessions(sessions);

  assert.strictEqual(report.syncedCount, 1);
  assert.strictEqual(report.skippedCount, 1);
  assert.strictEqual(report.errors.length, 0);
  assert.deepStrictEqual(exported, ['session-2']);
  assert.strictEqual(uploaded.length, 1);
});

test('SyncService handles network errors gracefully without throwing', async () => {
  const mockFetch = async () => {
    throw new Error('Network request failed');
  };

  const syncService = new SyncService({
    baseUrl: 'https://remus-app-recorder-backend.onrender.com',
    fetchFn: mockFetch
  });

  const result = await syncService.checkSync(['session-1']);
  assert.strictEqual(result.error, 'Network request failed');
  assert.deepStrictEqual(result.requiredSessionIds, []);
});
