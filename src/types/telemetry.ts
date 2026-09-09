export type SensorPlacement =
  | 'hull'
  | 'left_wrist'
  | 'right_wrist'
  | 'body'
  | 'oar'
  | 'paddle'
  | 'unknown';

export const VALID_PLACEMENTS: SensorPlacement[] = [
  'hull',
  'left_wrist',
  'right_wrist',
  'body',
  'oar',
  'paddle',
  'unknown'
];

export function validatePlacement(placement: string): placement is SensorPlacement {
  return VALID_PLACEMENTS.includes(placement as SensorPlacement);
}

export interface SessionMetadata {
  sessionId: string;
  startedAt: string; // ISO 8601 string
  appVersion: string;
  deviceModel: string;
  systemVersion: string;
  motionFrequencyHertz: number;
  placement: SensorPlacement;
  notes: string;
}

export interface RecordingManifest {
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
  headingSampleCount?: number;
  altimeterSampleCount?: number;
  weatherSampleCount?: number;
  status: 'recording' | 'completed' | 'failed' | 'interrupted';
  failureMessage?: string;
  databaseFilename: string;
}

export function createInitialManifest(metadata: SessionMetadata): RecordingManifest {
  return {
    id: metadata.sessionId,
    startedAt: metadata.startedAt,
    appVersion: metadata.appVersion,
    deviceModel: metadata.deviceModel,
    systemVersion: metadata.systemVersion,
    notes: metadata.notes,
    motionFrequencyHertz: metadata.motionFrequencyHertz,
    placement: metadata.placement,
    motionSampleCount: 0,
    locationSampleCount: 0,
    headingSampleCount: 0,
    altimeterSampleCount: 0,
    weatherSampleCount: 0,
    status: 'recording',
    databaseFilename: 'telemetry.sqlite'
  };
}

export interface RecordingSessionSummary {
  contextCompleteness?: import('./recordingContext').ContextCompleteness;
  status?: string;
  id: string;
  folderUri: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  sizeBytes: number;
  sampleCount: number;
  placement: SensorPlacement;
  hasWatchRecording: boolean;
  sessionTitle?: string | null;
}
