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
import { normalizeTelemetryEvent, resolveStrokeRateDisplay, StrokeRateDisplay } from '../contracts/telemetryContract';
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

  const [activeTab, setActiveTab] = useState<'treino' | 'sprints' | 'sensores'>('treino');
  const [completedSprints, setCompletedSprints] = useState<{ targetDistance: number; durationSeconds: number; startedAt: string; }[]>([]);
  const [activeSprint, setActiveSprint] = useState<{ target: number; startDistance: number; startTime: number } | null>(null);
  const [sprintPending, setSprintPending] = useState<number | null>(null); // pending sprint target
  const [sprintCountdown, setSprintCountdown] = useState<number | null>(null);

  const [isAcquiringGPS, setIsAcquiringGPS] = useState(false);
  const [duration, setDuration] = useState(0);
  const [placement] = useState<SensorPlacement>('unknown');
  const [pendingRecordingId, setPendingRecordingId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // A missing observation is not a measured zero.
  const [metrics, setMetrics] = useState<MetricsState>(INITIAL_METRICS);
  const [lastAvailableSpm, setLastAvailableSpm] = useState<{value: number, timestamp: number} | null>(null);

  const resetScreenState = () => {
    setDuration(0);
    setMetrics(INITIAL_METRICS);
    setLastAvailableSpm(null);
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
      setMetrics(prev => {
        const normalized = normalizeTelemetryEvent(data, prev);
        if (normalized.strokeRateStatus === 'available' && normalized.strokeRateSpm != null) {
          setLastAvailableSpm({ value: normalized.strokeRateSpm, timestamp: Date.now() });
        }
        return { ...prev, ...normalized };
      });
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    telemetryBridge.requestPermissions().catch(console.warn);
  }, []);

  
  useEffect(() => {
    if (isRecording && mode !== 'free' && targetDistance != null) {
      if (metrics.distanceMeters != null && metrics.distanceMeters >= targetDistance) {
        telemetryBridge.playBeep(true);
        handleStop();
      }
    }
  }, [isRecording, metrics.distanceMeters, mode, targetDistance]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  
  
  useEffect(() => {
    if (activeSprint && metrics.distanceMeters != null) {
      const dist = metrics.distanceMeters - activeSprint.startDistance;
      if (dist >= activeSprint.target) {
        telemetryBridge.playBeep(true);
        const durationSeconds = (Date.now() - activeSprint.startTime) / 1000;
        setCompletedSprints(prev => [...prev, {
          targetDistance: activeSprint.target,
          durationSeconds,
          startedAt: new Date(activeSprint.startTime).toISOString()
        }]);
        setActiveSprint(null);
      }
    }
  }, [metrics.distanceMeters, activeSprint]);

  const isGpsReady = metrics.horizontalAccuracyMeters != null && metrics.horizontalAccuracyMeters <= 5;
  const isBoatStopped = metrics.groundSpeedMetersPerSecond != null && metrics.groundSpeedMetersPerSecond < 0.3;
  const isReadyToSprint = isGpsReady && isBoatStopped;

  useEffect(() => {
    if (sprintPending && isReadyToSprint && sprintCountdown === null) {
      let timeLeft = 10;
      setSprintCountdown(timeLeft);
      
      const interval = setInterval(async () => {
        timeLeft -= 1;
        if (timeLeft > 0 && timeLeft <= 3) {
          await telemetryBridge.playBeep(false);
        }
        
        if (timeLeft <= 0) {
          clearInterval(interval);
          setSprintCountdown(null);
          await telemetryBridge.playBeep(true);
          
          setActiveSprint({
            target: sprintPending,
            startDistance: metrics.distanceMeters || 0,
            startTime: Date.now()
          });
          setSprintPending(null);
        } else {
          setSprintCountdown(timeLeft);
        }
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [sprintPending, isReadyToSprint, sprintCountdown]);

  const cancelSprint = () => {
    setSprintPending(null);
    setSprintCountdown(null);
    setActiveSprint(null);
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

  const spmDisplay = resolveStrokeRateDisplay(metrics, lastAvailableSpm, Date.now());

  const strokeRateDetail = () => {
    if (!isRecording) return t('recorder.spm.ready');
    if (spmDisplay.status === 'available') {
      return t('recorder.spm.liveDetail');
    }
    if (spmDisplay.status === 'stale') {
      return t('recorder.spm.lastReading', { seconds: Math.floor(spmDisplay.staleSeconds) });
    }
    if (spmDisplay.status === 'unavailable') return t('recorder.spm.unavailable');
    const remaining = Math.max(0, Math.ceil(15 * (1 - (metrics.strokeRateProgress ?? Math.min(duration / 15, 1)))));
    return t('recorder.spm.collecting').replace('{{seconds}}', String(remaining));
  };


  const pace = metrics.groundSpeedMetersPerSecond && metrics.groundSpeedMetersPerSecond > 0 
    ? 500 / metrics.groundSpeedMetersPerSecond 
    : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      {pendingRecordingId && (
        <RecordingContextForm 
          recordingId={pendingRecordingId} 
          sprints={completedSprints}
          onClose={() => {
            setPendingRecordingId(null);
            resetScreenState();
          }} 
        />
      )}

      {/* Global Header */}
      <View style={styles.globalHeader}>
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
          style={[styles.mainButton, isRecording ? styles.stopButton : styles.startButton]}
          onPress={isRecording ? handleStop : handleStart}
          disabled={transitioning || sprintPending !== null || activeSprint !== null}
        >
          <Text style={styles.mainButtonText}>
            {isRecording ? t('recording.stop') : t('recording.start')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      {isRecording && (
        <View style={styles.tabsRow}>
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'treino' && styles.tabBtnActive]} onPress={() => setActiveTab('treino')}>
            <Text style={[styles.tabText, activeTab === 'treino' && styles.tabTextActive]}>Treino</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'sprints' && styles.tabBtnActive]} onPress={() => setActiveTab('sprints')}>
            <Text style={[styles.tabText, activeTab === 'sprints' && styles.tabTextActive]}>Sprints</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'sensores' && styles.tabBtnActive]} onPress={() => setActiveTab('sensores')}>
            <Text style={[styles.tabText, activeTab === 'sensores' && styles.tabTextActive]}>Sensores</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.container}>
        {!isRecording ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Pressione GRAVAR para iniciar.</Text>
          </View>
        ) : activeTab === 'treino' ? (
          <View style={styles.treinoTab}>
            
            <View style={styles.spmCard}>
              <View>
                <Text style={styles.spmTitle}>{t('recorder.spm.title')}</Text>
                <Text style={styles.spmDetail}>{strokeRateDetail()}</Text>
              </View>
              <View style={[styles.spmValueRow, spmDisplay.status === 'stale' && { opacity: 0.5 }]}>
                <Text style={[styles.spmValue, spmDisplay.status === 'stale' && { color: '#64748B' }]}>
                  {spmDisplay.value !== null ? spmDisplay.value.toFixed(1) : '—'}
                </Text>
                <Text style={styles.spmUnit}>SPM</Text>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              {renderMetricTile('Pace (500m)', pace > 0 ? formatDuration(Math.floor(pace)) : '—', 'min:sec')}
              {renderMetricTile('Distância Total', metrics.distanceMeters?.toFixed(0) ?? '—', 'm')}
            </View>

            {/* Sprints Block */}
            <View style={styles.sprintControls}>
              <Text style={styles.cardTitle}>Tiros (Sprints)</Text>
              
              {activeSprint ? (
                <View style={styles.activeSprintBox}>
                  <Text style={styles.sprintTitle}>Tiro de {activeSprint.target}m em andamento</Text>
                  <Text style={styles.sprintDistanceText}>
                    {((metrics.distanceMeters || 0) - activeSprint.startDistance).toFixed(0)}m percorridos
                  </Text>
                  <TouchableOpacity style={styles.cancelSprintBtn} onPress={cancelSprint}>
                    <Text style={styles.cancelSprintText}>Cancelar Tiro</Text>
                  </TouchableOpacity>
                </View>
              ) : sprintPending ? (
                <View style={styles.pendingSprintBox}>
                  {sprintCountdown !== null ? (
                    <Text style={styles.countdownBig}>{sprintCountdown}</Text>
                  ) : !isGpsReady ? (
                    <Text style={styles.warningText}>Aguardando GPS...</Text>
                  ) : !isBoatStopped ? (
                    <Text style={styles.warningText}>Aguarde o barco parar...</Text>
                  ) : (
                    <Text style={styles.readyText}>Pronto...</Text>
                  )}
                  <TouchableOpacity style={styles.cancelSprintBtn} onPress={cancelSprint}>
                    <Text style={styles.cancelSprintText}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.sprintButtonsRow}>
                  <TouchableOpacity style={styles.sprintBtn} onPress={() => setSprintPending(250)}><Text style={styles.sprintBtnText}>250m</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.sprintBtn} onPress={() => setSprintPending(500)}><Text style={styles.sprintBtnText}>500m</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.sprintBtn} onPress={() => setSprintPending(1000)}><Text style={styles.sprintBtnText}>1000m</Text></TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        ) : activeTab === 'sprints' ? (
          <View style={styles.sprintsList}>
            {completedSprints.length === 0 ? (
              <Text style={styles.emptyText}>Nenhum tiro registrado neste treino.</Text>
            ) : (
              completedSprints.map((s, i) => (
                <View key={i} style={styles.sprintItem}>
                  <Text style={styles.sprintItemTitle}>Tiro {s.targetDistance}m</Text>
                  <Text style={styles.sprintItemTime}>{formatDuration(Math.floor(s.durationSeconds))}</Text>
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={styles.metricsGrid}>
            {renderMetricTile('Speed', metrics.groundSpeedMetersPerSecond === null ? '—' : (metrics.groundSpeedMetersPerSecond * 3.6).toFixed(1), 'km/h', originBadge(metrics.speedOrigin))}
            {renderMetricTile('Course', metrics.courseDegrees === null ? '—' : `${metrics.courseDegrees.toFixed(0)}°`, 'movement', originBadge(metrics.courseOrigin))}
            {renderMetricTile('Heading', metrics.headingDegrees === null ? '—' : `${metrics.headingDegrees.toFixed(0)}°`, 'phone')}
            {renderMetricTile('Acceleration', metrics.accelerationG?.toFixed(3) ?? '—', 'g')}
            {renderMetricTile('Rotation (X/Y/Z)', rotationValue(), 'rad/s')}
            {renderMetricTile('GPS accuracy', metrics.horizontalAccuracyMeters !== null ? metrics.horizontalAccuracyMeters.toFixed(0) : '—', 'm')}
            {renderMetricTile('GPS rate', metrics.samplingRateHertz?.toFixed(2) ?? '—', 'Hz')}
            {renderMetricTile('IMU samples', metrics.imuSamples?.toString() ?? '—', '100 Hz')}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  globalHeader: {
    padding: 16,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center'
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#38BDF8'
  },
  tabText: {
    color: '#64748B',
    fontWeight: '600'
  },
  tabTextActive: {
    color: '#38BDF8'
  },
  treinoTab: {
    gap: 16
  },
  emptyState: {
    padding: 32,
    alignItems: 'center'
  },
  emptyText: {
    color: '#64748B',
    fontSize: 16
  },
  sprintControls: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 16,
    marginTop: 8
  },
  sprintButtonsRow: {
    flexDirection: 'row',
    gap: 8
  },
  sprintBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center'
  },
  sprintBtnText: {
    color: '#F8FAFC',
    fontWeight: '600'
  },
  pendingSprintBox: {
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0F172A',
    borderRadius: 8
  },
  countdownBig: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#38BDF8'
  },
  activeSprintBox: {
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0284C7',
    borderRadius: 8
  },
  sprintTitle: {
    color: '#BAE6FD',
    fontSize: 14,
    fontWeight: '600'
  },
  sprintDistanceText: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: 'bold',
    marginVertical: 8
  },
  cancelSprintBtn: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 6
  },
  cancelSprintText: {
    color: '#F8FAFC',
    fontSize: 12
  },
  sprintsList: {
    gap: 8
  },
  sprintItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 8
  },
  sprintItemTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600'
  },
  sprintItemTime: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: 'bold'
  },
});
