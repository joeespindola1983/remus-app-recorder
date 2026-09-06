const test = require('node:test');
const assert = require('node:assert');

class ExportManager {
  constructor(bridge) {
    this.bridge = bridge;
  }

  async prepareZipForSharing(sessionId) {
    return await this.bridge.exportSessionZip(sessionId);
  }
}

test('ExportManager exports session ZIP correctly', async () => {
  const mockBridge = {
    exportSessionZip: async (sessionId) => `/storage/emulated/0/Download/${sessionId}.zip`
  };

  const exportManager = new ExportManager(mockBridge);
  const zipPath = await exportManager.prepareZipForSharing('session-1');
  assert.strictEqual(zipPath, '/storage/emulated/0/Download/session-1.zip');
});
