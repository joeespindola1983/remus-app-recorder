import {
  ITelemetryNativeBridge,
  StartRecordingParams,
  StartRecordingResult
} from './telemetryBridge';
import { RecordingManifest, RecordingSessionSummary } from '../types/telemetry';

export class SessionManager {
  private bridge: ITelemetryNativeBridge;
  private recording: boolean = false;
  private currentSessionId?: string;

  constructor(bridge: ITelemetryNativeBridge) {
    this.bridge = bridge;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }

  async start(params: StartRecordingParams): Promise<StartRecordingResult> {
    if (this.recording) {
      throw new Error('A recording is already in progress');
    }

    const result = await this.bridge.startRecording(params);
    this.recording = true;
    this.currentSessionId = result.sessionId;
    return result;
  }

  async stop(): Promise<RecordingManifest> {
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

  async list(): Promise<RecordingSessionSummary[]> {
    return await this.bridge.listSessions();
  }

  async delete(sessionId: string): Promise<boolean> {
    return await this.bridge.deleteSession(sessionId);
  }
}
