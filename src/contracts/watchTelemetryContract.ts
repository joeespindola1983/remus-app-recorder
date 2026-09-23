/**
 * watchTelemetryContract.ts
 *
 * Defines the canonical telemetry structure and CSV serializing / parsing
 * for smartwatch stream records (Apple Watch, WearOS / Galaxy Watch).
 */

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface AttitudeEuler {
  roll: number;
  pitch: number;
  yaw: number;
}

export interface WatchGps {
  latitude: number;
  longitude: number;
  speedMps: number | null;
  accuracyMeters: number | null;
}

export interface WatchTelemetryRecord {
  timestampIso: string;
  elapsedSeconds: number;
  heartRateBpm: number | null;
  userAcceleration: Vector3D | null;
  gravity: Vector3D | null;
  rotationRate: Vector3D | null;
  attitude: AttitudeEuler | null;
  gps: WatchGps | null;
  activeEnergyKcal: number | null;
  batteryPercent: number | null;
}

export const WATCH_CSV_HEADER =
  'timestamp_iso,elapsed_s,heart_rate_bpm,user_ax_g,user_ay_g,user_az_g,gravity_x_g,gravity_y_g,gravity_z_g,rotation_x_rads,rotation_y_rads,rotation_z_rads,roll_rad,pitch_rad,yaw_rad,latitude,longitude,speed_mps,accuracy_m,active_energy_kcal,battery_pct\n';

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const num = Number.parseFloat(val.trim());
  return Number.isFinite(num) ? num : null;
}

export function parseWatchTelemetryCsvLine(rawLine: string): WatchTelemetryRecord | null {
  if (!rawLine || typeof rawLine !== 'string') return null;
  const line = rawLine.trim();
  if (line === '' || line.startsWith('timestamp_iso')) return null;

  const parts = line.split(',');
  if (parts.length < 20) return null;

  const timestampIso = parts[0]?.trim();
  if (!timestampIso) return null;

  const elapsedSeconds = parseNum(parts[1]) ?? 0;
  const heartRateBpm = parseNum(parts[2]);

  const uAx = parseNum(parts[3]);
  const uAy = parseNum(parts[4]);
  const uAz = parseNum(parts[5]);
  const userAcceleration = (uAx !== null && uAy !== null && uAz !== null)
    ? { x: uAx, y: uAy, z: uAz }
    : null;

  const gX = parseNum(parts[6]);
  const gY = parseNum(parts[7]);
  const gZ = parseNum(parts[8]);
  const gravity = (gX !== null && gY !== null && gZ !== null)
    ? { x: gX, y: gY, z: gZ }
    : null;

  const rX = parseNum(parts[9]);
  const rY = parseNum(parts[10]);
  const rZ = parseNum(parts[11]);
  const rotationRate = (rX !== null && rY !== null && rZ !== null)
    ? { x: rX, y: rY, z: rZ }
    : null;

  const roll = parseNum(parts[12]);
  const pitch = parseNum(parts[13]);
  const yaw = parseNum(parts[14]);
  const attitude = (roll !== null && pitch !== null && yaw !== null)
    ? { roll, pitch, yaw }
    : null;

  const lat = parseNum(parts[15]);
  const lon = parseNum(parts[16]);
  const speedMps = parseNum(parts[17]);
  const accuracyMeters = parseNum(parts[18]);
  const gps = (lat !== null && lon !== null)
    ? { latitude: lat, longitude: lon, speedMps, accuracyMeters }
    : null;

  const activeEnergyKcal = parseNum(parts[19]);
  const batteryPercent = parseNum(parts[20]);

  return {
    timestampIso,
    elapsedSeconds,
    heartRateBpm,
    userAcceleration,
    gravity,
    rotationRate,
    attitude,
    gps,
    activeEnergyKcal,
    batteryPercent
  };
}

export function formatWatchTelemetryCsvLine(record: WatchTelemetryRecord): string {
  const hrStr = record.heartRateBpm !== null ? record.heartRateBpm.toFixed(1) : '';
  const uAx = record.userAcceleration ? record.userAcceleration.x.toFixed(4) : '';
  const uAy = record.userAcceleration ? record.userAcceleration.y.toFixed(4) : '';
  const uAz = record.userAcceleration ? record.userAcceleration.z.toFixed(4) : '';
  const gX = record.gravity ? record.gravity.x.toFixed(4) : '';
  const gY = record.gravity ? record.gravity.y.toFixed(4) : '';
  const gZ = record.gravity ? record.gravity.z.toFixed(4) : '';
  const rX = record.rotationRate ? record.rotationRate.x.toFixed(4) : '';
  const rY = record.rotationRate ? record.rotationRate.y.toFixed(4) : '';
  const rZ = record.rotationRate ? record.rotationRate.z.toFixed(4) : '';
  const roll = record.attitude ? record.attitude.roll.toFixed(4) : '';
  const pitch = record.attitude ? record.attitude.pitch.toFixed(4) : '';
  const yaw = record.attitude ? record.attitude.yaw.toFixed(4) : '';
  const lat = record.gps ? record.gps.latitude.toFixed(7) : '';
  const lon = record.gps ? record.gps.longitude.toFixed(7) : '';
  const speed = record.gps && record.gps.speedMps !== null ? record.gps.speedMps.toFixed(2) : '';
  const acc = record.gps && record.gps.accuracyMeters !== null ? record.gps.accuracyMeters.toFixed(1) : '';
  const energy = record.activeEnergyKcal !== null ? record.activeEnergyKcal.toFixed(1) : '';
  const batt = record.batteryPercent !== null ? record.batteryPercent.toFixed(1) : '';

  return `${record.timestampIso},${record.elapsedSeconds.toFixed(2)},${hrStr},${uAx},${uAy},${uAz},${gX},${gY},${gZ},${rX},${rY},${rZ},${roll},${pitch},${yaw},${lat},${lon},${speed},${acc},${energy},${batt}\n`;
}
