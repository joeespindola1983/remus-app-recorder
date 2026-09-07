export interface RecordingStartParams {
  sessionId: string;
  sport?: string;
  athleteWeightKg?: number;
  sensorProfile?: string;
}

export interface RecordingStopParams {
  sessionId: string;
  durationSeconds?: number;
  motionSampleCount?: number;
  locationSampleCount?: number;
}

export class AnalyticsService {
  private analyticsInstance: any;
  private crashlyticsInstance: any;

  constructor(analyticsInstance?: any, crashlyticsInstance?: any) {
    this.analyticsInstance = analyticsInstance;
    this.crashlyticsInstance = crashlyticsInstance;
  }

  private getAnalytics() {
    if (this.analyticsInstance !== undefined) {
      return this.analyticsInstance;
    }
    try {
      // Lazy require with try-catch so TurboModule resolution failure doesn't crash the app
      const analyticsModule = require('@react-native-firebase/analytics');
      const fn = analyticsModule.default || analyticsModule;
      return typeof fn === 'function' ? fn() : null;
    } catch {
      return null;
    }
  }

  private getCrashlytics() {
    if (this.crashlyticsInstance !== undefined) {
      return this.crashlyticsInstance;
    }
    try {
      // Lazy require with try-catch so TurboModule resolution failure doesn't crash the app
      const crashlyticsModule = require('@react-native-firebase/crashlytics');
      const fn = crashlyticsModule.default || crashlyticsModule;
      return typeof fn === 'function' ? fn() : null;
    } catch {
      return null;
    }
  }

  async logRecordingStarted(params: RecordingStartParams): Promise<void> {
    try {
      const a = this.getAnalytics();
      if (a && typeof a.logEvent === 'function') {
        await a.logEvent('recording_started', {
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

  async logRecordingStopped(params: RecordingStopParams): Promise<void> {
    try {
      const a = this.getAnalytics();
      if (a && typeof a.logEvent === 'function') {
        await a.logEvent('recording_stopped', {
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

  async logSessionExported(sessionId: string): Promise<void> {
    try {
      const a = this.getAnalytics();
      if (a && typeof a.logEvent === 'function') {
        await a.logEvent('session_exported', {
          session_id: sessionId,
        });
      }
    } catch (err) {
      this.recordError(err, 'Failed to log session_exported event');
    }
  }

  recordError(error: unknown, context?: string): void {
    try {
      const c = this.getCrashlytics();
      if (c) {
        if (context && typeof c.log === 'function') {
          const errMessage = error instanceof Error ? error.message : String(error);
          c.log(`[Context: ${context}] ${errMessage}`);
        }
        if (typeof c.recordError === 'function') {
          c.recordError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } catch {
      // Fallback
    }
  }
}

export const analyticsService = new AnalyticsService();
