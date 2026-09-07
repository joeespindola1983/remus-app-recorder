// Boundary for legacy native event names. Stored raw recordings retain their
// producer schema; product consumers use canonical units and nullable vectors.
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function normalizeTelemetryEvent(event: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  const fields: Record<string, string> = {
    distanceMeters:'distanceMeters', courseDegrees:'courseDegrees', headingDegrees:'headingDegrees',
    gpsAccuracyMeters:'horizontalAccuracyMeters', heartRateBpm:'heartRateBeatsPerMinute',
    weatherTemperatureC:'airTemperatureCelsius', gpsRateHz:'samplingRateHertz', imuSamples:'imuSamples',
    altitudeMeters:'altitudeMeters', pressureKPa:'pressureKPa',
    weatherHumidityPercent:'weatherHumidityPercent', accelerationG:'accelerationG'
  };
  for (const [legacy, canonical] of Object.entries(fields)) if (Object.prototype.hasOwnProperty.call(event, legacy)) result[canonical] = finite(event[legacy]);
  for (const [legacy, canonical] of [['speedKmh','groundSpeedMetersPerSecond'],['weatherWindKmh','windSpeedMetersPerSecond']]) {
    if (Object.prototype.hasOwnProperty.call(event,legacy)) {const value = finite(event[legacy]);result[canonical] = value === null ? null : value / 3.6;}
  }
  if (['rotationXRad','rotationYRad','rotationZRad'].some(k => Object.prototype.hasOwnProperty.call(event,k))) {
    const [x,y,z] = ['rotationXRad','rotationYRad','rotationZRad'].map(k => finite(event[k]));
    result.rotationRateRadiansPerSecond = x === null || y === null || z === null ? null : {x,y,z};
  }
  if (typeof event.weatherStatus === 'string') result.weatherStatus = event.weatherStatus;
  return result;
}
