export type GpsSignalLevel = 0 | 1 | 2 | 3;

export interface GpsSignalInfo {
  level: GpsSignalLevel;
  bars: number;
  color: string;
}

export function getGpsSignalLevel(accuracyMeters: number | null | undefined): GpsSignalInfo {
  if (accuracyMeters === null || accuracyMeters === undefined || accuracyMeters <= 0 || !Number.isFinite(accuracyMeters)) {
    return { level: 0, bars: 0, color: '#64748B' };
  }
  if (accuracyMeters < 6) {
    return { level: 3, bars: 3, color: '#22C55E' };
  }
  if (accuracyMeters <= 15) {
    return { level: 2, bars: 2, color: '#EAB308' };
  }
  return { level: 1, bars: 1, color: '#EF4444' };
}

export interface HeartRateDisplayInfo {
  isActive: boolean;
  color: string;
  icon: string;
  value: string;
}

export interface ResolveHeartRateParams {
  isWatchActive: boolean;
  lastHeartRate: { value: number; timestamp: number } | null;
  now?: number;
}

export function resolveHeartRateDisplay({
  isWatchActive,
  lastHeartRate,
  now = Date.now(),
}: ResolveHeartRateParams): HeartRateDisplayInfo {
  const hasRecentReading = lastHeartRate !== null && (now - lastHeartRate.timestamp < 20000);
  const isActive = isWatchActive || Boolean(hasRecentReading);
  const color = isActive ? '#EF4444' : '#94A3B8';
  const icon = isActive ? '♥' : '♡';
  const value = lastHeartRate !== null ? Math.round(lastHeartRate.value).toString() : '—';

  return { isActive, color, icon, value };
}
