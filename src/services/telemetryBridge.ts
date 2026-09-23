import { NativeModules, Platform, PermissionsAndroid } from 'react-native';
import { RecordingContext, prepareContext } from '../types/recordingContext';
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

export interface ActiveRecordingState {
  isRecording: boolean;
  sessionId?: string;
  elapsedSeconds?: number;
  motionSampleCount?: number;
}

export interface WatchTransferProgressEvent {
  percentage: number;
  progress: number;
  status: 'waiting' | 'transferring' | 'completed' | 'failed';
  sessionID?: string;
  error?: string;
}

export interface ITelemetryNativeBridge {
  requestPermissions(): Promise<boolean>;
  startRecording(params: StartRecordingParams): Promise<StartRecordingResult>;
  getRecordingState(): Promise<ActiveRecordingState>;
  stopRecording(): Promise<RecordingManifest>;
  listSessions(): Promise<RecordingSessionSummary[]>;
  deleteSession(sessionId: string): Promise<boolean>;
  exportSessionZip(sessionId: string): Promise<string>;
  playBeep(isLoud: boolean): Promise<void>;
  requestWatchStopAndTransfer(timeoutMs?: number): Promise<boolean>;
}

const { RemusTelemetryModule } = NativeModules;

export class TelemetryNativeBridge implements ITelemetryNativeBridge {
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
        return (
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
            PermissionsAndroid.RESULTS.GRANTED ||
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      } catch (err) {
        console.warn('Failed to request android permissions', err);
        return false;
      }
    } else if (Platform.OS === 'ios') {
      try {
        if (RemusTelemetryModule && RemusTelemetryModule.requestPermissions) {
          const res = await RemusTelemetryModule.requestPermissions();
          return res?.authorized ?? true;
        }
      } catch (err) {
        console.warn('Failed to request ios permissions', err);
        return false;
      }
    }
    return true;
  }

  async getRecordingContext(recordingId: string): Promise<RecordingContext> {
    return JSON.parse(await RemusTelemetryModule.getRecordingContext(recordingId));
  }

  async saveRecordingContext(context: RecordingContext, finalize: boolean): Promise<RecordingContext> {
    const prepared = prepareContext(context, finalize);
    return JSON.parse(await RemusTelemetryModule.saveRecordingContext(context.recordingId, JSON.stringify(prepared), finalize));
  }

  async exportRawSessionZip(recordingId: string): Promise<string> {
    return RemusTelemetryModule.exportRawSessionZip(recordingId);
  }
  async startRecording(params: StartRecordingParams): Promise<StartRecordingResult> {
    if (RemusTelemetryModule && RemusTelemetryModule.startRecording) {
      return await RemusTelemetryModule.startRecording(params);
    }
    throw new Error('RemusTelemetryModule native module is not available');
  }

  async getRecordingState(): Promise<ActiveRecordingState> {
    if (RemusTelemetryModule && RemusTelemetryModule.getRecordingState) {
      return await RemusTelemetryModule.getRecordingState();
    }
    return { isRecording: false };
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

  async playBeep(isLoud: boolean): Promise<void> {
    if (RemusTelemetryModule && RemusTelemetryModule.playBeep) {
      await RemusTelemetryModule.playBeep(isLoud);
    }
  }

  async requestWatchStopAndTransfer(_timeoutMs = 15000): Promise<boolean> {
    if (Platform.OS === 'ios' && RemusTelemetryModule && RemusTelemetryModule.requestWatchStopAndTransfer) {
      try {
        return await RemusTelemetryModule.requestWatchStopAndTransfer();
      } catch {
        return true;
      }
    }
    return true;
  }
}

export const telemetryBridge = new TelemetryNativeBridge();
