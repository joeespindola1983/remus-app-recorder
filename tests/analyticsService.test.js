const test = require('node:test');
const assert = require('node:assert');

// Mockable AnalyticsService implementation for testing
class AnalyticsService {
  constructor(analyticsInstance = null, crashlyticsInstance = null) {
    this.analytics = analyticsInstance;
    this.crashlytics = crashlyticsInstance;
  }

  async logRecordingStarted(params) {
    try {
      if (this.analytics && typeof this.analytics.logEvent === 'function') {
        await this.analytics.logEvent('recording_started', {
          session_id: params.sessionId,
          sport: params.sport || 'default',
          athlete_weight_kg: params.athleteWeightKg ?? null,
          sensor_profile: params.sensorProfile || 'standard',
        });
      }
    } catch (err) {
      this.recordError(err, 'Failed to log recording_started event');
    }
  }

  async logRecordingStopped(params) {
    try {
      if (this.analytics && typeof this.analytics.logEvent === 'function') {
        await this.analytics.logEvent('recording_stopped', {
          session_id: params.sessionId,
          duration_seconds: params.durationSeconds ?? 0,
          motion_samples: params.motionSampleCount ?? 0,
          location_samples: params.locationSampleCount ?? 0,
        });
      }
    } catch (err) {
      this.recordError(err, 'Failed to log recording_stopped event');
    }
  }

  async logSessionExported(sessionId) {
    try {
      if (this.analytics && typeof this.analytics.logEvent === 'function') {
        await this.analytics.logEvent('session_exported', {
          session_id: sessionId,
        });
      }
    } catch (err) {
      this.recordError(err, 'Failed to log session_exported event');
    }
  }

  recordError(error, context) {
    try {
      if (this.crashlytics) {
        if (context && typeof this.crashlytics.log === 'function') {
          this.crashlytics.log(`[Context: ${context}] ${error && error.message ? error.message : String(error)}`);
        }
        if (typeof this.crashlytics.recordError === 'function') {
          this.crashlytics.recordError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } catch {
      // Safe fallback - do not rethrow in Crashlytics reporter
    }
  }
}

test('AnalyticsService logs recording_started event', async () => {
  const events = [];
  const mockAnalytics = {
    logEvent: async (name, params) => {
      events.push({ name, params });
    },
  };

  const service = new AnalyticsService(mockAnalytics, null);
  await service.logRecordingStarted({
    sessionId: 'session-abc',
    sport: 'running',
    athleteWeightKg: 75,
    sensorProfile: 'high-freq',
  });

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].name, 'recording_started');
  assert.strictEqual(events[0].params.session_id, 'session-abc');
  assert.strictEqual(events[0].params.sport, 'running');
  assert.strictEqual(events[0].params.athlete_weight_kg, 75);
  assert.strictEqual(events[0].params.sensor_profile, 'high-freq');
});

test('AnalyticsService logs recording_stopped event', async () => {
  const events = [];
  const mockAnalytics = {
    logEvent: async (name, params) => {
      events.push({ name, params });
    },
  };

  const service = new AnalyticsService(mockAnalytics, null);
  await service.logRecordingStopped({
    sessionId: 'session-abc',
    durationSeconds: 120,
    motionSampleCount: 6000,
    locationSampleCount: 120,
  });

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].name, 'recording_stopped');
  assert.strictEqual(events[0].params.session_id, 'session-abc');
  assert.strictEqual(events[0].params.duration_seconds, 120);
  assert.strictEqual(events[0].params.motion_samples, 6000);
  assert.strictEqual(events[0].params.location_samples, 120);
});

test('AnalyticsService logs session_exported event', async () => {
  const events = [];
  const mockAnalytics = {
    logEvent: async (name, params) => {
      events.push({ name, params });
    },
  };

  const service = new AnalyticsService(mockAnalytics, null);
  await service.logSessionExported('session-xyz');

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].name, 'session_exported');
  assert.strictEqual(events[0].params.session_id, 'session-xyz');
});

test('AnalyticsService records errors to crashlytics with context', () => {
  const logged = [];
  const recordedErrors = [];
  const mockCrashlytics = {
    log: (msg) => logged.push(msg),
    recordError: (err) => recordedErrors.push(err),
  };

  const service = new AnalyticsService(null, mockCrashlytics);
  const testErr = new Error('SQLite disk full');
  service.recordError(testErr, 'recorder_save');

  assert.strictEqual(logged.length, 1);
  assert.strictEqual(logged[0], '[Context: recorder_save] SQLite disk full');
  assert.strictEqual(recordedErrors.length, 1);
  assert.strictEqual(recordedErrors[0].message, 'SQLite disk full');
});

test('AnalyticsService handles null instances gracefully without throwing', async () => {
  const service = new AnalyticsService(null, null);

  await assert.doesNotReject(async () => {
    await service.logRecordingStarted({ sessionId: 's1' });
    await service.logRecordingStopped({ sessionId: 's1' });
    await service.logSessionExported('s1');
    service.recordError(new Error('test'));
  });
});

module.exports = { AnalyticsService };
