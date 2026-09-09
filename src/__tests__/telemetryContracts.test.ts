import {
  SensorPlacement,
  SessionMetadata,
  RecordingManifest,
  createInitialManifest,
  validatePlacement
} from '../types/telemetry';

describe('Telemetry Domain Contracts', () => {
  test('validates sensor placements according to C++ engine spec', () => {
    expect(validatePlacement('hull')).toBe(true);
    expect(validatePlacement('left_wrist')).toBe(true);
    expect(validatePlacement('right_wrist')).toBe(true);
    expect(validatePlacement('body')).toBe(true);
    expect(validatePlacement('oar')).toBe(true);
    expect(validatePlacement('unknown')).toBe(true);
    expect(validatePlacement('invalid_placement' as SensorPlacement)).toBe(false);
  });

  test('creates a valid initial manifest with default counts', () => {
    const metadata: SessionMetadata = {
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      startedAt: '2026-09-05T14:30:00.000Z',
      appVersion: '1.0.0',
      deviceModel: 'iPhone 15 Pro',
      systemVersion: 'iOS 18.0',
      motionFrequencyHertz: 100,
      placement: 'hull',
      notes: 'Test sculling session'
    };

    const manifest: RecordingManifest = createInitialManifest(metadata);

    expect(manifest.id).toBe(metadata.sessionId);
    expect(manifest.status).toBe('recording');
    expect(manifest.motionSampleCount).toBe(0);
    expect(manifest.locationSampleCount).toBe(0);
    expect(manifest.headingSampleCount).toBe(0);
    expect(manifest.altimeterSampleCount).toBe(0);
    expect(manifest.databaseFilename).toBe('telemetry.sqlite');
    expect(manifest.placement).toBe('hull');
  });

  describe('resolveStrokeRateDisplay', () => {
    test('Disponível: 21.0 SPM', () => {
      const current = { strokeRateStatus: 'available' as const, strokeRateSpm: 21.0 };
      const res = require('../contracts/telemetryContract').resolveStrokeRateDisplay(current, null, 100000);
      expect(res).toEqual({ value: 21.0, status: 'available', staleSeconds: 0 });
    });

    test('Indisponível por até 30 s: 21.0 SPM com "última leitura há 12 s"', () => {
      const current = { strokeRateStatus: 'unavailable' as const, strokeRateSpm: null };
      const res = require('../contracts/telemetryContract').resolveStrokeRateDisplay(current, { value: 21.0, timestamp: 100000 }, 112000);
      expect(res).toEqual({ value: 21.0, status: 'stale', staleSeconds: 12 });
    });

    test('Indisponível por mais de 30 s: — SPM', () => {
      const current = { strokeRateStatus: 'unavailable' as const, strokeRateSpm: null };
      const res = require('../contracts/telemetryContract').resolveStrokeRateDisplay(current, { value: 21.0, timestamp: 100000 }, 131000);
      expect(res).toEqual({ value: null, status: 'unavailable', staleSeconds: 0 });
    });

    test('Coletando sem leitura anterior: manter contagem inicial', () => {
      const current = { strokeRateStatus: 'collecting' as const, strokeRateSpm: null };
      const res = require('../contracts/telemetryContract').resolveStrokeRateDisplay(current, null, 100000);
      expect(res).toEqual({ value: null, status: 'collecting', staleSeconds: 0 });
    });
  });
});
