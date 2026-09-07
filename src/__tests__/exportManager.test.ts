import { ExportManager } from '../services/exportManager';
import { ITelemetryNativeBridge } from '../services/telemetryBridge';

describe('ExportManager Service', () => {
  let mockBridge: jest.Mocked<ITelemetryNativeBridge>;
  let exportManager: ExportManager;

  beforeEach(() => {
    mockBridge = {
      startRecording: jest.fn(),
      getRecordingState: jest.fn(),
      stopRecording: jest.fn(),
      listSessions: jest.fn(),
      deleteSession: jest.fn(),
      exportSessionZip: jest.fn().mockResolvedValue('/storage/emulated/0/Download/session-1.zip')
    };

    exportManager = new ExportManager(mockBridge);
  });

  test('packages and exports session as ZIP for C++ engine ingest', async () => {
    const zipPath = await exportManager.prepareZipForSharing('session-1');
    expect(mockBridge.exportSessionZip).toHaveBeenCalledWith('session-1');
    expect(zipPath).toBe('/storage/emulated/0/Download/session-1.zip');
  });
});
