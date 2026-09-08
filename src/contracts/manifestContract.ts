import { SensorPlacement, RecordingManifest } from '../types/telemetry';

export interface NormalizedManifest {
  id: string;
  startedAt: string;
  endedAt?: string;
  appVersion: string;
  deviceModel: string;
  systemVersion: string;
  notes: string;
  motionFrequencyHertz: number;
  placement: SensorPlacement;
  motionSampleCount: number;
  locationSampleCount: number;
  headingSampleCount: number;   // default 0 if missing (Android)
  altimeterSampleCount: number; // default 0 if missing (Android)
  weatherSampleCount: number;   // default 0 if missing (Android stopRecording)
  status: 'recording' | 'completed' | 'failed';  // 'interrupted' → 'failed'
  failureMessage?: string;
  databaseFilename: string;     // default 'telemetry.sqlite' if missing
}

export function normalizeManifest(raw: Record<string, any>): NormalizedManifest {
  const status = raw?.status === 'interrupted' ? 'failed' : (raw?.status ?? 'completed');
  return {
    id: raw?.id ?? '',
    startedAt: raw?.startedAt ?? '',
    endedAt: raw?.endedAt ?? undefined,
    appVersion: raw?.appVersion ?? 'unknown',
    deviceModel: raw?.deviceModel ?? 'unknown',
    systemVersion: raw?.systemVersion ?? 'unknown',
    notes: raw?.notes ?? '',
    motionFrequencyHertz: raw?.motionFrequencyHertz ?? 100,
    placement: raw?.placement ?? 'unknown',
    motionSampleCount: raw?.motionSampleCount ?? 0,
    locationSampleCount: raw?.locationSampleCount ?? 0,
    headingSampleCount: raw?.headingSampleCount ?? 0,
    altimeterSampleCount: raw?.altimeterSampleCount ?? 0,
    weatherSampleCount: raw?.weatherSampleCount ?? 0,
    status: status === 'recording' || status === 'completed' || status === 'failed' ? status : 'failed',
    failureMessage: raw?.failureMessage,
    databaseFilename: raw?.databaseFilename ?? 'telemetry.sqlite',
  };
}
