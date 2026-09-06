import { NativeModules, Platform } from 'react-native';
import { RecordingManifest, RecordingSessionSummary, SensorPlacement } from '../types/telemetry';

export interface StartRecordingParams {
  deviceModel: string;
  systemVersion: string;
  motionFrequencyHertz: number;
  placement: SensorPlacement;
  notes: string;
}

export interface StartRecordingResult {
  sessionId: string;
  folderUri: string;
}

export interface ITelemetryNativeBridge {
  startRecording(params: StartRecordingParams): Promise<StartRecordingResult>;
  stopRecording(): Promise<RecordingManifest>;
  listSessions(): Promise<RecordingSessionSummary[]>;
  deleteSession(sessionId: string): Promise<boolean>;
  exportSessionZip(sessionId: string): Promise<string>;
}

const { RemusTelemetryModule } = NativeModules;

export class TelemetryNativeBridge implements ITelemetryNativeBridge {
  async startRecording(params: StartRecordingParams): Promise<StartRecordingResult> {
    if (RemusTelemetryModule && RemusTelemetryModule.startRecording) {
      return await RemusTelemetryModule.startRecording(params);
    }
    throw new Error('RemusTelemetryModule native module is not available');
  }

  async stopRecording(): Promise<RecordingManifest> {
    if (RemusTelemetryModule && RemusTelemetryModule.stopRecording) {
      return await RemusTelemetryModule.stopRecording();
    }
    throw new Error('RemusTelemetryModule native module is not available');
  }

  async listSessions(): Promise<RecordingSessionSummary[]> {
    if (RemusTelemetryModule && RemusTelemetryModule.listSessions) {
      return await RemusTelemetryModule.listSessions();
    }
    return [];
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    if (RemusTelemetryModule && RemusTelemetryModule.deleteSession) {
      return await RemusTelemetryModule.deleteSession(sessionId);
    }
    return false;
  }

  async exportSessionZip(sessionId: string): Promise<string> {
    if (RemusTelemetryModule && RemusTelemetryModule.exportSessionZip) {
      return await RemusTelemetryModule.exportSessionZip(sessionId);
    }
    throw new Error('RemusTelemetryModule native module is not available');
  }
}

export const telemetryBridge = new TelemetryNativeBridge();
