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
    const manifest = await this.bridge.stopRecording();
    this.recording = false;
    this.currentSessionId = undefined;
    return manifest;
  }

  async restore(): Promise<boolean> {
    const state = await this.bridge.getRecordingState();
    this.recording = state.isRecording;
    this.currentSessionId = state.sessionId;
    return state.isRecording;
  }

  async list(): Promise<RecordingSessionSummary[]> {
    const list = await this.bridge.listSessions();
    return [...list].sort((a, b) => {
      const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return timeB - timeA;
    });
  }

  async delete(sessionId: string): Promise<boolean> {
    return await this.bridge.deleteSession(sessionId);
  }
}
