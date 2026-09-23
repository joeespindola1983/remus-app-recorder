/**
 * Canonical contract for telemetry received from the external REMUS ESP32-C3 hardware.
 * The first 20 fields are the legacy contract. Firmware 0.3 appends native
 * receiver quality fields without changing their positions.
 */

export interface RemusDeviceAcceleration {
  x: number;
  y: number;
  z: number;
}

export interface RemusDeviceGyroscope {
  x: number;
  y: number;
  z: number;
}

export interface RemusDeviceGps {
  latitude: number | null;
  longitude: number | null;
  speedKmph: number | null;
  groundSpeedMetersPerSecond: number | null;
  speedAccuracyMetersPerSecond: number | null;
  courseDegrees: number | null;
  courseAccuracyDegrees: number | null;
  fixType: number | null;
  gpsTimeOfWeekMilliseconds: number | null;
  satellitesInView: number;
  satellitesInUse: number;
  snrDb?: number | null;
  accuracyMeters?: number | null;
  fix: boolean;
  charsProcessed: number;
}

export interface RemusDeviceSdCard {
  logging: boolean;
  linesWritten: number;
}

export interface RemusDeviceTelemetry {
  timestampUs: number;
  acceleration: RemusDeviceAcceleration;
  gyroscope: RemusDeviceGyroscope;
  gps: RemusDeviceGps;
  sdCard: RemusDeviceSdCard;
  strokeRateSpm: number | null;
  rawCsv: string;
}

export function parseRemusDeviceTelemetry(rawCsv: string): RemusDeviceTelemetry | null {
  if (!rawCsv || typeof rawCsv !== 'string') {
    return null;
  }

  const parts = rawCsv.trim().split(',');
  if (parts.length < 4) {
    return null;
  }

  const timestampUs = Number(parts[0]);
  const ax = Number(parts[1]);
  const ay = Number(parts[2]);
  const az = Number(parts[3]);
  const gx = parts.length > 4 ? Number(parts[4]) : 0;
  const gy = parts.length > 5 ? Number(parts[5]) : 0;
  const gz = parts.length > 6 ? Number(parts[6]) : 0;

  if (isNaN(timestampUs) || isNaN(ax) || isNaN(ay) || isNaN(az)) {
    return null;
  }

  const latRaw = parts.length > 7 ? parts[7] : '';
  const lonRaw = parts.length > 8 ? parts[8] : '';
  const speedRaw = parts.length > 9 ? parts[9] : '';
  const satsRaw = parts.length > 10 ? parts[10] : '0';
  const sdLinesRaw = parts.length > 11 ? parts[11] : '0';
  const charsRxRaw = parts.length > 12 ? parts[12] : '0';
  const spmRaw = parts.length > 13 ? parts[13] : '';
  const speedAccuracyRaw = parts.length > 20 ? parts[20] : '';
  const courseRaw = parts.length > 21 ? parts[21] : '';
  const courseAccuracyRaw = parts.length > 22 ? parts[22] : '';
  const fixTypeRaw = parts.length > 23 ? parts[23] : '';
  const gpsTimeOfWeekRaw = parts.length > 24 ? parts[24] : '';

  const latitude = latRaw !== '' && !isNaN(Number(latRaw)) ? Number(latRaw) : null;
  const longitude = lonRaw !== '' && !isNaN(Number(lonRaw)) ? Number(lonRaw) : null;
  const speedKmph = speedRaw !== '' && !isNaN(Number(speedRaw)) ? Number(speedRaw) : null;
  const speedAccuracyMetersPerSecond = speedAccuracyRaw !== '' && !isNaN(Number(speedAccuracyRaw))
    ? Number(speedAccuracyRaw) : null;
  const courseDegrees = courseRaw !== '' && !isNaN(Number(courseRaw)) ? Number(courseRaw) : null;
  const courseAccuracyDegrees = courseAccuracyRaw !== '' && !isNaN(Number(courseAccuracyRaw))
    ? Number(courseAccuracyRaw) : null;
  const fixType = fixTypeRaw !== '' && !isNaN(Number(fixTypeRaw)) ? Number(fixTypeRaw) : null;
  const gpsTimeOfWeekMilliseconds = gpsTimeOfWeekRaw !== '' && !isNaN(Number(gpsTimeOfWeekRaw))
    ? Number(gpsTimeOfWeekRaw) : null;
  const hasFix = latitude !== null && longitude !== null;

  let satellitesInUse = 0;
  let satellitesInView = 0;
  let snrDb: number | null = null;
  let accuracyMeters: number | null = null;

  if (satsRaw.includes('/')) {
    const [useStr, rest] = satsRaw.split('/');
    satellitesInUse = !isNaN(Number(useStr)) ? Number(useStr) : 0;
    if (rest) {
      const parts = rest.split(':');
      satellitesInView = !isNaN(Number(parts[0])) ? Number(parts[0]) : 0;
      if (parts.length > 1 && !isNaN(Number(parts[1]))) {
        snrDb = Number(parts[1]);
      }
      if (parts.length > 2) {
        const cleanAcc = parts[2].replace('m', '').trim();
        if (!isNaN(Number(cleanAcc))) {
          accuracyMeters = Number(cleanAcc);
        }
      }
    }
  } else {
    const satsNum = !isNaN(Number(satsRaw)) ? Number(satsRaw) : 0;
    satellitesInView = satsNum;
    satellitesInUse = hasFix ? satsNum : 0;
  }

  const linesWritten = !isNaN(Number(sdLinesRaw)) ? Number(sdLinesRaw) : 0;
  const charsProcessed = !isNaN(Number(charsRxRaw)) ? Number(charsRxRaw) : 0;
  const strokeRateSpm =
    spmRaw !== '' && !isNaN(Number(spmRaw)) && Number(spmRaw) > 0
      ? Number(spmRaw)
      : null;

  return {
    timestampUs,
    acceleration: { x: ax, y: ay, z: az },
    gyroscope: {
      x: isNaN(gx) ? 0 : gx,
      y: isNaN(gy) ? 0 : gy,
      z: isNaN(gz) ? 0 : gz,
    },
    gps: {
      latitude,
      longitude,
      speedKmph,
      groundSpeedMetersPerSecond: speedKmph === null ? null : speedKmph / 3.6,
      speedAccuracyMetersPerSecond,
      courseDegrees,
      courseAccuracyDegrees,
      fixType,
      gpsTimeOfWeekMilliseconds,
      satellitesInView,
      satellitesInUse,
      snrDb,
      accuracyMeters,
      fix: hasFix,
      charsProcessed,
    },
    sdCard: {
      logging: linesWritten > 0,
      linesWritten,
    },
    strokeRateSpm,
    rawCsv: rawCsv.trim(),
  };
}
