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

test('ExportManager handles bridge errors during ZIP export', async () => {
  const mockBridge = {
    exportSessionZip: async () => {
      throw new Error("The data couldn't be read because it isn't in the correct format.");
    }
  };

  const exportManager = new ExportManager(mockBridge);
  await assert.rejects(
    async () => {
      await exportManager.prepareZipForSharing('session-corrupt');
    },
    {
      message: "The data couldn't be read because it isn't in the correct format."
    }
  );
});

