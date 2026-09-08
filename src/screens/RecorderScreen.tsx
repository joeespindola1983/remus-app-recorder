import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  SafeAreaView,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid
} from 'react-native';
import { t } from '../i18n';
import { SensorPlacement } from '../types/telemetry';
import { SessionManager } from '../services/sessionManager';
import { telemetryBridge } from '../services/telemetryBridge';
import { analyticsService } from '../services/analyticsService';
import { RecordingContextForm } from './RecordingContextForm';
import { normalizeTelemetryEvent } from '../contracts/telemetryContract';
import { getRecordingState } from '../contracts/bridgeContract';
import { APP_DISPLAY_VERSION } from '../version';

const sessionManager = new SessionManager(telemetryBridge);
const { RemusTelemetryModule } = NativeModules;
const telemetryEmitter = RemusTelemetryModule ? new NativeEventEmitter(RemusTelemetryModule) : null;

// Canonical product view; raw producer schemas are adapted at the event boundary.
interface MetricsState {
  groundSpeedMetersPerSecond: number | null;
  speedOrigin: 'reported' | 'coordinate_derived' | 'unavailable' | null;
  distanceMeters: number | null;
  courseDegrees: number | null;
  courseOrigin: 'reported' | 'coordinate_derived' | 'unavailable' | null;
  headingDegrees: number | null;
  accelerationG: number | null;
  rotationRateRadiansPerSecond: {x: number; y: number; z: number} | null;
  horizontalAccuracyMeters: number | null;
  samplingRateHertz: number | null;
  imuSamples: number | null;
  altitudeMeters: number | null;
  pressureKPa: number | null;
  heartRateBeatsPerMinute: number | null;
  weatherStatus: string;
  airTemperatureCelsius: number | null;
  weatherHumidityPercent: number | null;
  windSpeedMetersPerSecond: number | null;
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

const INITIAL_METRICS: MetricsState = {
  groundSpeedMetersPerSecond: null,
  speedOrigin: null,
  distanceMeters: null,
  courseDegrees: null,
  courseOrigin: null,
  headingDegrees: null,
  accelerationG: null,
  rotationRateRadiansPerSecond: null,
  horizontalAccuracyMeters: null,
  samplingRateHertz: null,
  imuSamples: 0,
  altitudeMeters: null,
  pressureKPa: null,
  heartRateBeatsPerMinute: null,
  weatherStatus: 'Waiting for location…',
  airTemperatureCelsius: null,
  weatherHumidityPercent: null,
  windSpeedMetersPerSecond: null,
  strokeRateSpm: null,
  strokeRateStatus: null,
  strokeRateReason: null,
  strokeRatePeriodicity: null,
  strokeRateProgress: null,
  strokeRateWindowSeconds: null,
  strokeRateObservedHertz: null,
  strokeRateAlgorithmVersion: null,
  strokeRateOrigin: null
};

export const RecorderScreen: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isAcquiringGPS, setIsAcquiringGPS] = useState(false);
  const [duration, setDuration] = useState(0);
  const [placement] = useState<SensorPlacement>('unknown');
  const [pendingRecordingId, setPendingRecordingId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // A missing observation is not a measured zero.
  const [metrics, setMetrics] = useState<MetricsState>(INITIAL_METRICS);

  const resetScreenState = () => {
    setDuration(0);
    setMetrics(INITIAL_METRICS);
    setIsAcquiringGPS(false);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording) {
      interval = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  useEffect(() => {
    let mounted = true;
    const restoreRecording = async () => {
      try {
        const state = await getRecordingState();
        if (!mounted) return;
        setIsRecording(state.isRecording);
        setDuration(Math.max(0, Math.floor(state.elapsedSeconds ?? 0)));
        if (state.motionSampleCount !== undefined) {
          setMetrics(prev => ({ ...prev, imuSamples: state.motionSampleCount ?? 0 }));
        }
      } catch (err) {
        analyticsService.recordError(err, 'RecorderScreen:restoreRecording');
      }
    };
    restoreRecording();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!telemetryEmitter) return;
    const subscription = telemetryEmitter.addListener('onTelemetryUpdate', (data: Partial<MetricsState>) => {
      setMetrics(prev => ({ ...prev, ...normalizeTelemetryEvent(data, prev) }));
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    telemetryBridge.requestPermissions().catch(console.warn);
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = async () => {
    if (transitioning) return;
    setTransitioning(true);
    try {
      await sessionManager.restore();
      await telemetryBridge.requestPermissions();
      const res = await sessionManager.start({
        deviceModel: Platform.OS === 'ios' ? 'iOS Device' : 'Android Device',
        systemVersion: String(Platform.Version),
        motionFrequencyHertz: 100,
        placement,
        notes: ''
      });
      setIsRecording(true);
      setDuration(0);
      setMetrics(prev => ({...prev, strokeRateSpm: null, strokeRateStatus: 'collecting', strokeRateProgress: 0}));
      await analyticsService.logRecordingStarted({
        sessionId: res.sessionId,
        sensorProfile: placement,
      });
    } catch (err: any) {
      console.error(err);
      analyticsService.recordError(err, 'RecorderScreen:handleStart');
    } finally {
      setTransitioning(false);
    }
  };

  const handleStop = async () => {
    if (transitioning) return;
    setTransitioning(true);
    try {
      const manifest = await sessionManager.stop();
      setIsRecording(false);
      setPendingRecordingId(manifest.id);
      await analyticsService.logRecordingStopped({
        sessionId: manifest.id,
        durationSeconds: duration,
        motionSampleCount: manifest.motionSampleCount,
        locationSampleCount: manifest.locationSampleCount,
      });
      resetScreenState();
    } catch (err: any) {
      console.error(err);
      analyticsService.recordError(err, 'RecorderScreen:handleStop');
    } finally {
      setTransitioning(false);
    }
  };

  const originBadge = (origin: 'reported' | 'coordinate_derived' | 'unavailable' | null) => {
    if (!origin) return null;
    if (origin === 'unavailable') return t('recorder.origin.unavailable');
    if (origin === 'coordinate_derived') return t('recorder.origin.coordinateDerived');
    return t('recorder.origin.reported');
  };

  const renderMetricTile = (title: string, value: string, unit: string, badge?: string | null) => (
    <View style={styles.metricTile}>
      <View style={styles.metricTitleRow}>
        <Text style={styles.metricTitle}>{title}</Text>
        {badge ? (
          <View style={styles.originBadge}>
            <Text style={styles.originBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );

  const rotationValue = () => {
    const vector = metrics.rotationRateRadiansPerSecond;
    if (vector === null) {
      return 'Indisponível';
    }
    return `X ${vector.x.toFixed(2)} · Y ${vector.y.toFixed(2)} · Z ${vector.z.toFixed(2)}`;
  };

  const strokeRateDetail = () => {
    if (!isRecording) return t('recorder.spm.ready');
    if (metrics.strokeRateStatus === 'available' && metrics.strokeRateSpm !== null) {
      return t('recorder.spm.liveDetail');
    }
    if (metrics.strokeRateStatus === 'unavailable') return t('recorder.spm.unavailable');
    const remaining = Math.max(0, Math.ceil(15 * (1 - (metrics.strokeRateProgress ?? Math.min(duration / 15, 1)))));
    return t('recorder.spm.collecting').replace('{{seconds}}', String(remaining));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {pendingRecordingId && (
        <RecordingContextForm
          recordingId={pendingRecordingId}
          onClose={() => {
            setPendingRecordingId(null);
            resetScreenState();
          }}
        />
      )}
      <ScrollView contentContainerStyle={styles.container}>
        
        {/* Recording Card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: isRecording ? '#EF4444' : '#64748B' }]} />
              <Text style={styles.statusText}>
                {isRecording ? t('recorder.status.recording') : (isAcquiringGPS ? t('recorder.status.acquiringGps') : t('recorder.status.ready'))}
              </Text>
            </View>
            {isRecording && (
              <Text style={styles.timerText}>{formatDuration(duration)}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.mainButton,
              isRecording ? styles.stopButton : styles.startButton
            ]}
            onPress={isRecording ? handleStop : handleStart}
            disabled={transitioning}
          >
            <Text style={styles.mainButtonText}>
              {isRecording ? t('recording.stop') : t('recording.start')}
            </Text>
          </TouchableOpacity>

          {isRecording && (
            <View style={styles.tipContainer}>
              <Text style={styles.tipIcon}>💡</Text>
              <Text style={styles.tipText}>{t('recording.screenOffTip')}</Text>
            </View>
          )}
        </View>

        <View style={styles.spmCard}>
          <View>
            <Text style={styles.spmTitle}>{t('recorder.spm.title')}</Text>
            <Text style={styles.spmDetail}>{strokeRateDetail()}</Text>
          </View>
          <View style={styles.spmValueRow}>
            <Text style={styles.spmValue}>
              {metrics.strokeRateStatus === 'available' && metrics.strokeRateSpm !== null ? metrics.strokeRateSpm.toFixed(1) : '—'}
            </Text>
            <Text style={styles.spmUnit}>SPM</Text>
          </View>
        </View>

        {/* Metrics Grid */}
        <View style={styles.metricsGrid}>
          {renderMetricTile('Speed', metrics.groundSpeedMetersPerSecond === null ? '—' : (metrics.groundSpeedMetersPerSecond * 3.6).toFixed(1), 'km/h', originBadge(metrics.speedOrigin))}
          {renderMetricTile('Distance', metrics.distanceMeters?.toFixed(0) ?? '—', 'm')}
          {renderMetricTile('Course', metrics.courseDegrees === null ? '—' : `${metrics.courseDegrees.toFixed(0)}°`, 'movement', originBadge(metrics.courseOrigin))}
          {renderMetricTile('Heading', metrics.headingDegrees === null ? '—' : `${metrics.headingDegrees.toFixed(0)}°`, 'phone')}
          {renderMetricTile('Acceleration', metrics.accelerationG?.toFixed(3) ?? '—', 'g')}
          {renderMetricTile('Rotation (X/Y/Z)', rotationValue(), 'rad/s')}
          {renderMetricTile('GPS accuracy', metrics.horizontalAccuracyMeters !== null ? metrics.horizontalAccuracyMeters.toFixed(0) : '—', 'm')}
          {renderMetricTile('GPS rate', metrics.samplingRateHertz?.toFixed(2) ?? '—', 'Hz delivered')}
          {renderMetricTile('IMU samples', metrics.imuSamples?.toString() ?? '—', '100 Hz target')}
          {renderMetricTile('Rel. altitude', metrics.altitudeMeters !== null ? metrics.altitudeMeters.toFixed(1) : '—', 'm')}
          {renderMetricTile('Pressure', metrics.pressureKPa !== null ? metrics.pressureKPa.toFixed(2) : '—', 'kPa')}
          {renderMetricTile('Heart Rate', metrics.heartRateBeatsPerMinute ? metrics.heartRateBeatsPerMinute.toString() : '—', 'bpm (Watch/BLE)')}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Weather</Text>
          {metrics.airTemperatureCelsius === null ? (
            <Text style={styles.secondaryText}>{metrics.weatherStatus}</Text>
          ) : (
            <Text style={styles.secondaryText}>
              {metrics.airTemperatureCelsius.toFixed(1)}°C · {metrics.weatherHumidityPercent?.toFixed(0) ?? '—'}% humidity · {(metrics.windSpeedMetersPerSecond === null ? undefined : (metrics.windSpeedMetersPerSecond * 3.6).toFixed(1)) ?? '—'} km/h wind
            </Text>
          )}
        </View>
        <View style={styles.versionFooter}>
          <Text style={styles.versionFooterText}>{APP_DISPLAY_VERSION}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  container: {
    padding: 16,
    gap: 16
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6
  },
  statusText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600'
  },
  timerText: {
    color: '#94A3B8',
    fontSize: 16,
    fontVariant: ['tabular-nums']
  },
  mainButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%'
  },
  startButton: {
    backgroundColor: '#0284C7'
  },
  stopButton: {
    backgroundColor: '#EF4444'
  },
  mainButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold'
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between'
  },
  spmCard: {
    backgroundColor: '#0C4A6E',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  spmTitle: { color: '#E0F2FE', fontSize: 16, fontWeight: '700' },
  spmDetail: { color: '#7DD3FC', fontSize: 11, marginTop: 4, maxWidth: 190 },
  spmValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  spmValue: { color: '#FFFFFF', fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spmUnit: { color: '#BAE6FD', fontSize: 12, fontWeight: '600' },
  metricTile: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 12,
    minHeight: 110,
    justifyContent: 'space-between'
  },
  metricTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  metricTitle: {
    color: '#94A3B8',
    fontSize: 12
  },
  originBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  originBadgeText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '700',
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums']
  },
  metricUnit: {
    color: '#64748B',
    fontSize: 10
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12
  },
  secondaryText: {
    color: '#94A3B8',
    fontSize: 14
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  tipIcon: {
    fontSize: 16,
    marginRight: 8
  },
  tipText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },
  versionFooter: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionFooterText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  }
});
