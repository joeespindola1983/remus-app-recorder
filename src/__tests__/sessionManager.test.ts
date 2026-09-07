import { SessionManager } from '../services/sessionManager';
import { ITelemetryNativeBridge } from '../services/telemetryBridge';

describe('SessionManager Service', () => {
  let mockBridge: jest.Mocked<ITelemetryNativeBridge>;
  let manager: SessionManager;

  beforeEach(() => {
    mockBridge = {
      startRecording: jest.fn().mockResolvedValue({ folderUri: '/mock/path/session-1', sessionId: 'mock-session-id' }),
      getRecordingState: jest.fn().mockResolvedValue({ isRecording: false }),
      stopRecording: jest.fn().mockResolvedValue({
        id: 'mock-session-id',
        startedAt: '2026-09-05T14:00:00Z',
        endedAt: '2026-09-05T14:10:00Z',
        motionSampleCount: 60000,
        locationSampleCount: 600,
        headingSampleCount: 600,
        altimeterSampleCount: 600,
        status: 'completed',
        placement: 'hull'
      }),
      listSessions: jest.fn().mockResolvedValue([]),
      deleteSession: jest.fn().mockResolvedValue(true),
      exportSessionZip: jest.fn().mockResolvedValue('/mock/path/session-1.zip')
    };

    manager = new SessionManager(mockBridge);
  });

  test('starts a recording session and updates active state', async () => {
    expect(manager.isRecording()).toBe(false);

    const result = await manager.start({
      deviceModel: 'Test Device',
      systemVersion: '1.0',
      motionFrequencyHertz: 100,
      placement: 'hull',
      notes: 'Testing'
    });

    expect(mockBridge.startRecording).toHaveBeenCalled();
    expect(result.sessionId).toBe('mock-session-id');
    expect(manager.isRecording()).toBe(true);
  });

  test('prevents starting a new recording when already recording', async () => {
    await manager.start({
      deviceModel: 'Test Device',
      systemVersion: '1.0',
      motionFrequencyHertz: 100,
      placement: 'hull',
      notes: ''
    });

    await expect(
      manager.start({
        deviceModel: 'Test Device',
        systemVersion: '1.0',
        motionFrequencyHertz: 100,
        placement: 'hull',
        notes: ''
      })
    ).rejects.toThrow('A recording is already in progress');
  });

  test('stops an active recording session and returns manifest', async () => {
    await manager.start({
      deviceModel: 'Test Device',
      systemVersion: '1.0',
      motionFrequencyHertz: 100,
      placement: 'hull',
      notes: ''
    });

    const manifest = await manager.stop();
    expect(mockBridge.stopRecording).toHaveBeenCalled();
    expect(manifest.status).toBe('completed');
    expect(manifest.motionSampleCount).toBe(60000);
    expect(manager.isRecording()).toBe(false);
  });

  test('restores native recording state after the screen is recreated', async () => {
    mockBridge.getRecordingState.mockResolvedValue({ isRecording: true, sessionId: 'active-session' });

    await expect(manager.restore()).resolves.toBe(true);
    expect(manager.isRecording()).toBe(true);
    expect(manager.getCurrentSessionId()).toBe('active-session');
  });
});
