export interface NormalizedTelemetry {
  // GPS & Navigation
  groundSpeedMetersPerSecond: number | null;
  distanceMeters: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  horizontalAccuracyMeters: number | null;
  samplingRateHertz: number | null;
  altitudeMeters: number | null;

  // IMU
  accelerationG: number | null;
  rotationRateRadiansPerSecond: { x: number; y: number; z: number } | null;
  imuSamples: number | null;

  // Environment
  pressureKPa: number | null;
  airTemperatureCelsius: number | null;
  weatherHumidityPercent: number | null;
  windSpeedMetersPerSecond: number | null;
  weatherStatus: string | null;
  weatherConfidenceScore: number | null;
  weatherPressureDeltaHpa: number | null;

  // Biometrics
  heartRateBeatsPerMinute: number | null;

  // Stroke Rate
  strokeRateSpm: number | null;
  strokeRateStatus: 'collecting' | 'available' | 'unavailable' | null;
  strokeRateReason: string | null;
  strokeRatePeriodicity: number | null;
  strokeRateProgress: number | null;
  strokeRateWindowSeconds: number | null;
  strokeRateObservedHertz: number | null;
  strokeRateAlgorithmVersion: string | null;
  strokeRateOrigin: string | null;
}

const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

export function normalizeTelemetryEvent(
  raw: Record<string, any>,
  previous: Partial<NormalizedTelemetry> = {}
): Partial<NormalizedTelemetry> {
  const result: Partial<NormalizedTelemetry> = { ...previous };

  // Fields that map 1:1 with renaming
  const mappings: Record<string, keyof NormalizedTelemetry> = {
    distanceMeters: 'distanceMeters',
    courseDegrees: 'courseDegrees',
    headingDegrees: 'headingDegrees',
    gpsAccuracyMeters: 'horizontalAccuracyMeters',
    heartRateBpm: 'heartRateBeatsPerMinute',
    weatherTemperatureC: 'airTemperatureCelsius',
    gpsRateHz: 'samplingRateHertz',
    imuSamples: 'imuSamples',
    altitudeMeters: 'altitudeMeters',
    pressureKPa: 'pressureKPa',
    weatherHumidityPercent: 'weatherHumidityPercent',
    accelerationG: 'accelerationG',
    strokeRateSpm: 'strokeRateSpm',
    strokeRatePeriodicity: 'strokeRatePeriodicity',
    strokeRateProgress: 'strokeRateProgress',
    strokeRateWindowSeconds: 'strokeRateWindowSeconds',
    strokeRateObservedHertz: 'strokeRateObservedHertz',
    weatherConfidenceScore: 'weatherConfidenceScore',
    weatherPressureDeltaHpa: 'weatherPressureDeltaHpa',
  };

  for (const [legacy, canonical] of Object.entries(mappings)) {
    if (Object.prototype.hasOwnProperty.call(raw, legacy)) {
      if (isDev && raw[legacy] !== null && typeof raw[legacy] !== 'number') {
        console.warn(`[TelemetryContract] ${legacy} received as ${typeof raw[legacy]}, expected number`);
      }
      (result as any)[canonical] = raw[legacy] === null ? null : finite(raw[legacy]);
    }
  }

  // Velocity mappings (km/h -> m/s)
  for (const [legacy, canonical] of [
    ['speedKmh', 'groundSpeedMetersPerSecond'],
    ['weatherWindKmh', 'windSpeedMetersPerSecond']
  ]) {
    if (Object.prototype.hasOwnProperty.call(raw, legacy)) {
      if (isDev && raw[legacy] !== null && typeof raw[legacy] !== 'number') {
        console.warn(`[TelemetryContract] ${legacy} received as ${typeof raw[legacy]}, expected number`);
      }
      const value = raw[legacy] === null ? null : finite(raw[legacy]);
      (result as any)[canonical] = value === null ? null : value / 3.6;
    }
  }

  // Rotation Vector
  if (['rotationXRad', 'rotationYRad', 'rotationZRad'].some(k => Object.prototype.hasOwnProperty.call(raw, k))) {
    const x = Object.prototype.hasOwnProperty.call(raw, 'rotationXRad') ? raw.rotationXRad : (previous.rotationRateRadiansPerSecond?.x ?? null);
    const y = Object.prototype.hasOwnProperty.call(raw, 'rotationYRad') ? raw.rotationYRad : (previous.rotationRateRadiansPerSecond?.y ?? null);
    const z = Object.prototype.hasOwnProperty.call(raw, 'rotationZRad') ? raw.rotationZRad : (previous.rotationRateRadiansPerSecond?.z ?? null);

    const fx = x === null ? null : finite(x);
    const fy = y === null ? null : finite(y);
    const fz = z === null ? null : finite(z);

    if (fx === null || fy === null || fz === null) {
      result.rotationRateRadiansPerSecond = null;
    } else {
      result.rotationRateRadiansPerSecond = { x: fx, y: fy, z: fz };
    }
  }

  // String fields
  if (Object.prototype.hasOwnProperty.call(raw, 'weatherStatus')) {
    result.weatherStatus = raw.weatherStatus === null ? null : String(raw.weatherStatus);
  }

  for (const field of ['strokeRateStatus', 'strokeRateReason', 'strokeRateAlgorithmVersion', 'strokeRateOrigin']) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      (result as any)[field] = raw[field] === null ? null : String(raw[field]);
    }
  }

  return result;
}
