import {
  telemetryBridge,
  ITelemetryNativeBridge,
  ActiveRecordingState,
  StartRecordingParams,
  StartRecordingResult
} from '../services/telemetryBridge';
import { RecordingManifest, RecordingSessionSummary } from '../types/telemetry';
import { normalizeManifest, NormalizedManifest } from './manifestContract';

export interface RecordingState {
  isRecording: boolean;
  sessionId?: string;
  elapsedSeconds: number;
  motionSampleCount: number;
}

export async function deleteSession(id: string, bridge: ITelemetryNativeBridge = telemetryBridge): Promise<boolean> {
  try {
    const result = await bridge.deleteSession(id);
    return result !== false;
  } catch {
    return false;
  }
}

export async function getRecordingState(bridge: ITelemetryNativeBridge = telemetryBridge): Promise<RecordingState> {
  try {
    const raw = await bridge.getRecordingState();
    return {
      isRecording: raw.isRecording ?? false,
      sessionId: raw.sessionId,
      elapsedSeconds: raw.elapsedSeconds ?? 0,
      motionSampleCount: raw.motionSampleCount ?? 0,
    };
  } catch {
    return {
      isRecording: false,
      elapsedSeconds: 0,
      motionSampleCount: 0,
    };
  }
}

export async function stopRecording(bridge: ITelemetryNativeBridge = telemetryBridge): Promise<NormalizedManifest> {
  const raw = await bridge.stopRecording();
  return normalizeManifest(raw);
}

export class BridgeContract implements ITelemetryNativeBridge {
  private bridge: ITelemetryNativeBridge;

  constructor(bridge: ITelemetryNativeBridge = telemetryBridge) {
    this.bridge = bridge;
  }

  async requestPermissions(): Promise<boolean> {
    return this.bridge.requestPermissions();
  }

  async startRecording(params: StartRecordingParams): Promise<StartRecordingResult> {
    return this.bridge.startRecording(params);
  }

  async getRecordingState(): Promise<ActiveRecordingState> {
    return getRecordingState(this.bridge);
  }

  async stopRecording(): Promise<RecordingManifest> {
    return stopRecording(this.bridge);
  }

  async listSessions(): Promise<RecordingSessionSummary[]> {
    return this.bridge.listSessions();
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return deleteSession(sessionId, this.bridge);
  }

  async exportSessionZip(sessionId: string): Promise<string> {
    return this.bridge.exportSessionZip(sessionId);
  }

  async playBeep(isLoud: boolean): Promise<void> {
    return this.bridge.playBeep(isLoud);
  }

  async requestWatchStopAndTransfer(timeoutMs?: number): Promise<boolean> {
    return this.bridge.requestWatchStopAndTransfer(timeoutMs);
  }
}

export const bridgeContract = new BridgeContract(telemetryBridge);
