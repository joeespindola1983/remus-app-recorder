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

export type RemusAntennaQualityLevel = 'no_uart' | 'no_rf' | 'weak' | 'regular' | 'excellent';

export interface RemusAntennaStatusInfo {
  quality: RemusAntennaQualityLevel;
  bars: number; // 0 to 4
  color: string;
  badgeBg: string;
  titleKey: string;
  descriptionKey: string;
  snrFormatted: string;
  satellitesFormatted: string;
  accuracyFormatted: string;
}

export interface RemusDeviceGpsInput {
  latitude?: number | null;
  longitude?: number | null;
  speedKmph?: number | null;
  satellitesInView?: number;
  satellitesInUse?: number;
  snrDb?: number | null;
  accuracyMeters?: number | null;
  fix?: boolean;
  charsProcessed?: number;
}

export function resolveRemusAntennaStatus(gps: RemusDeviceGpsInput | null | undefined): RemusAntennaStatusInfo {
  if (!gps || (gps.charsProcessed ?? 0) === 0) {
    return {
      quality: 'no_uart',
      bars: 0,
      color: '#EF4444',
      badgeBg: '#7F1D1D',
      titleKey: 'device.gps.antennaNoUart',
      descriptionKey: 'device.gps.antennaNoUartDesc',
      snrFormatted: '-- dB-Hz',
      satellitesFormatted: '0 / 0',
      accuracyFormatted: '--',
    };
  }

  const snr = gps.snrDb ?? 0;
  const inView = gps.satellitesInView ?? 0;
  const inUse = gps.satellitesInUse ?? 0;
  const snrFormatted = snr > 0 ? `${snr} dB-Hz` : '-- dB-Hz';
  const satellitesFormatted = `${inUse} / ${inView}`;
  const accuracyFormatted = gps.accuracyMeters != null && gps.accuracyMeters > 0
    ? `± ${gps.accuracyMeters.toFixed(1)}m`
    : (gps.fix ? '3D' : '--');

  if (snr === 0 && inView === 0 && !gps.fix) {
    return {
      quality: 'no_rf',
      bars: 0,
      color: '#F87171',
      badgeBg: '#450A0A',
      titleKey: 'device.gps.antennaNoRf',
      descriptionKey: 'device.gps.antennaNoRfDesc',
      snrFormatted,
      satellitesFormatted,
      accuracyFormatted,
    };
  }

  if (snr < 26 && !gps.fix) {
    return {
      quality: 'weak',
      bars: 1,
      color: '#F59E0B',
      badgeBg: '#78350F',
      titleKey: 'device.gps.antennaWeak',
      descriptionKey: 'device.gps.antennaWeakDesc',
      snrFormatted,
      satellitesFormatted,
      accuracyFormatted,
    };
  }

  if (snr < 30 && !gps.fix) {
    return {
      quality: 'regular',
      bars: 2,
      color: '#FBBF24',
      badgeBg: '#713F12',
      titleKey: 'device.gps.antennaRegular',
      descriptionKey: 'device.gps.antennaRegularDesc',
      snrFormatted,
      satellitesFormatted,
      accuracyFormatted,
    };
  }

  return {
    quality: 'excellent',
    bars: 4,
    color: '#22C55E',
    badgeBg: '#14532D',
    titleKey: 'device.gps.antennaExcellent',
    descriptionKey: 'device.gps.antennaExcellentDesc',
    snrFormatted,
    satellitesFormatted,
    accuracyFormatted,
  };
}

export interface FormatRemusGpsBadgeOptions {
  satellites: number;
  accuracyMeters?: number | null;
  fix?: boolean;
  searchingLabel?: string;
}

export function formatRemusGpsBadge({
  satellites,
  accuracyMeters,
  fix = false,
  searchingLabel = 'buscando',
}: FormatRemusGpsBadgeOptions): string {
  const icon = fix ? '📡' : '⏳';
  const satsText = `${satellites} sats`;

  if (accuracyMeters != null && accuracyMeters > 0) {
    const roundedMeters = Math.round(accuracyMeters);
    return `${icon} ${satsText} · ${roundedMeters}m`;
  }

  if (fix) {
    return `${icon} ${satsText} · 3D`;
  }

  return `${icon} ${satsText} · ${searchingLabel}`;
}
