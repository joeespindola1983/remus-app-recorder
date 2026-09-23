import React, { useState, useEffect, useRef } from 'react';
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
  useWindowDimensions,
  Modal,
  ActivityIndicator,
  LayoutAnimation,
} from 'react-native';
import { t } from '../i18n';
import { SensorPlacement } from '../types/telemetry';
import { SessionManager } from '../services/sessionManager';
import { telemetryBridge } from '../services/telemetryBridge';
import { analyticsService } from '../services/analyticsService';
import { RecordingContextForm } from './RecordingContextForm';
import { normalizeTelemetryEvent, resolveStrokeRateDisplay } from '../contracts/telemetryContract';
import { getRecordingState } from '../contracts/bridgeContract';
import { getGpsSignalLevel, resolveHeartRateDisplay, formatRemusGpsBadge } from '../utils/dashboardIndicators';
import {
  remusDeviceService,
  RemusConnectionState,
} from '../services/remusDeviceService';
import { RemusDeviceTelemetry } from '../contracts/remusDeviceContract';

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

export interface RecorderScreenProps {
  onRecordingChange?: (isRecording: boolean) => void;
}

const GpsSignalIndicator: React.FC<{ accuracyMeters: number | null }> = ({ accuracyMeters }) => {
  const signal = getGpsSignalLevel(accuracyMeters);
  const dimmedColor = '#334155';

  return (
    <View style={styles.gpsIndicatorContainer} accessibilityLabel={`GPS ${accuracyMeters != null ? accuracyMeters.toFixed(1) + 'm' : ''}`}>
      <Text style={styles.gpsText}>GPS</Text>
      <View style={styles.gpsBars}>
        <View
          style={[
            styles.gpsBar,
            styles.gpsBar1,
            { backgroundColor: signal.level >= 1 ? signal.color : dimmedColor },
          ]}
        />
        <View
          style={[
            styles.gpsBar,
            styles.gpsBar2,
            { backgroundColor: signal.level >= 2 ? signal.color : dimmedColor },
          ]}
        />
        <View
          style={[
            styles.gpsBar,
            styles.gpsBar3,
            { backgroundColor: signal.level >= 3 ? signal.color : dimmedColor },
          ]}
        />
      </View>
    </View>
  );
};

export const RecorderScreen: React.FC<RecorderScreenProps> = ({ onRecordingChange }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [activeTab, setActiveTab] = useState<'treino' | 'sprints' | 'sensores'>('treino');
  const [completedSprints, setCompletedSprints] = useState<{ targetDistance: number; durationSeconds: number; startedAt: string; }[]>([]);
  const [activeSprint, setActiveSprint] = useState<{ target: number; startDistance: number; startTime: number } | null>(null);
  const [sprintCountdown, setSprintCountdown] = useState<number | null>(null);
  const [sprintTarget, setSprintTarget] = useState<number | null>(null);

  useEffect(() => {
    onRecordingChange?.(isRecording);
    if (isRecording) {
      setActiveTab('treino');
    }
  }, [isRecording, onRecordingChange]);

  const [sprintMenuOpen, setSprintMenuOpen] = useState(false);

  const [duration, setDuration] = useState(0);
  const [placement] = useState<SensorPlacement>('unknown');
  const [pendingRecordingId, setPendingRecordingId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // Telemetry metrics & sensor observers
  const [metrics, setMetrics] = useState<MetricsState>(INITIAL_METRICS);
  const [lastHeartRate, setLastHeartRate] = useState<{value: number, timestamp: number} | null>(null);
  const [lastAvailableSpm, setLastAvailableSpm] = useState<{value: number, timestamp: number} | null>(null);
  const [isWatchActive, setIsWatchActive] = useState(false);
  const [remusConnectionState, setRemusConnectionState] = useState<RemusConnectionState>(
    remusDeviceService.getConnectionState()
  );
  const [remusTelemetry, setRemusTelemetry] = useState<RemusDeviceTelemetry | null>(
    remusDeviceService.getLatestTelemetry()
  );

  useEffect(() => {
    remusDeviceService.ensureConnection().catch(() => {});

    const unsubConn = remusDeviceService.subscribeConnection((state) => {
      setRemusConnectionState(state);
    });

    const unsubTelem = remusDeviceService.subscribe((telem) => {
      setRemusTelemetry(telem);
    });

    return () => {
      unsubConn();
      unsubTelem();
    };
  }, []);

  const resetScreenState = () => {
    setDuration(0);
    setMetrics(INITIAL_METRICS);
    setLastHeartRate(null);
    setLastAvailableSpm(null);
    setIsWatchActive(false);
    setSprintMenuOpen(false);
    setSprintCountdown(null);
    setSprintTarget(null);
    setActiveSprint(null);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else if (!isRecording) {
      setDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused]);

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
    const subscription = telemetryEmitter.addListener('onTelemetryUpdate', (data: Partial<MetricsState> & { watchActive?: boolean }) => {
      setMetrics(prev => {
        const normalized = normalizeTelemetryEvent(data, prev);
        if (normalized.strokeRateStatus === 'available' && normalized.strokeRateSpm != null) {
          setLastAvailableSpm({ value: normalized.strokeRateSpm, timestamp: Date.now() });
        }
        if (data.watchActive !== undefined) {
          setIsWatchActive(Boolean(data.watchActive));
        }
        const rawHr = data.heartRateBpm ?? (data as any).heartRate ?? normalized.heartRateBeatsPerMinute;
        if (rawHr !== undefined && rawHr !== null && Number(rawHr) > 0) {
          setLastHeartRate({ value: Number(rawHr), timestamp: Date.now() });
          setIsWatchActive(true);
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

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Sprint completion watcher
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

  const initiateSprint = (targetMeters: number) => {
    setSprintMenuOpen(false);
    setSprintTarget(targetMeters);
    setSprintCountdown(10);
  };

  const cancelSprint = () => {
    setSprintCountdown(null);
    setSprintTarget(null);
    setActiveSprint(null);
  };

  const finishSprint = () => {
    if (!activeSprint) return;
    telemetryBridge.playBeep(true).catch(console.warn);
    const durationSeconds = (Date.now() - activeSprint.startTime) / 1000;
    const distanceTraveled = metrics.distanceMeters != null 
      ? Math.max(0, metrics.distanceMeters - activeSprint.startDistance)
      : activeSprint.target;
    setCompletedSprints(prev => [...prev, {
      targetDistance: Math.round(distanceTraveled),
      durationSeconds,
      startedAt: new Date(activeSprint.startTime).toISOString()
    }]);
    setActiveSprint(null);
  };

  useEffect(() => {
    if (sprintCountdown === null) return;

    if (sprintCountdown === 0) {
      telemetryBridge.playBeep(true).catch(console.warn);
      setActiveSprint({
        target: sprintTarget || 250,
        startDistance: metrics.distanceMeters || 0,
        startTime: Date.now()
      });
      setSprintCountdown(null);
      return;
    }

    if (sprintCountdown <= 3) {
      telemetryBridge.playBeep(false).catch(console.warn);
    }

    const timer = setTimeout(() => {
      setSprintCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [sprintCountdown, sprintTarget]);

  const handleStart = async () => {
    if (transitioning) return;
    setTransitioning(true);
    try {
      remusDeviceService.ensureConnection().catch(() => {});
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
      setIsPaused(false);
      setSprintMenuOpen(false);
      setDuration(0);
      setMetrics(prev => ({...prev, strokeRateSpm: null, strokeRateStatus: 'collecting', strokeRateProgress: 0}));

      // Inicia a gravação a 200 Hz no MicroSD do sensor Remus
      remusDeviceService.startWorkout().catch(() => {});

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

    setIsRecording(false);
    setIsPaused(false);
    setSprintMenuOpen(false);

    // Finaliza e fecha o arquivo no MicroSD do sensor Remus
    remusDeviceService.stopWorkout().catch(() => {});

    try {
      // Finaliza a sessão do celular instantaneamente
      const manifest = await sessionManager.stop();
      setPendingRecordingId(manifest.id);
      analyticsService.logRecordingStopped({
        sessionId: manifest.id,
        durationSeconds: duration,
        motionSampleCount: manifest.motionSampleCount,
        locationSampleCount: manifest.locationSampleCount,
      }).catch(() => {});

      resetScreenState();
    } catch (err: any) {
      console.error(err);
      analyticsService.recordError(err, 'RecorderScreen:handleStop');
      resetScreenState();
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

  const hrDisplay = resolveHeartRateDisplay({
    isWatchActive,
    lastHeartRate: lastHeartRate ?? (metrics.heartRateBeatsPerMinute != null ? { value: metrics.heartRateBeatsPerMinute, timestamp: Date.now() } : null),
    now: Date.now(),
  });

  const spmDisplay = resolveStrokeRateDisplay(metrics, lastAvailableSpm, Date.now());
  const isCollectingSpm = spmDisplay.status === 'collecting';

  const pace = metrics.groundSpeedMetersPerSecond && metrics.groundSpeedMetersPerSecond > 0 
    ? 500 / metrics.groundSpeedMetersPerSecond 
    : 0;

  // Sprint metrics: time and distance reducing to 0m
  const sprintElapsed = activeSprint 
    ? Math.max(0, Math.floor((Date.now() - activeSprint.startTime) / 1000))
    : 0;
  const sprintTraveled = activeSprint
    ? Math.max(0, (metrics.distanceMeters || 0) - activeSprint.startDistance)
    : 0;
  const sprintRemaining = activeSprint
    ? Math.max(0, activeSprint.target - sprintTraveled)
    : 0;

  return (
    <SafeAreaView style={[styles.safeArea, isRecording && styles.safeAreaRecording]}>


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

      {/* Sprint Speed Dial Fullscreen Backdrop */}
      {sprintMenuOpen && (
        <TouchableOpacity 
          style={styles.backdrop} 
          activeOpacity={1} 
          onPress={() => setSprintMenuOpen(false)} 
        />
      )}

      <View style={[styles.screenWrapper, isLandscape && styles.screenWrapperLandscape]}>
        {/* Main View Area */}
        <View style={[
          styles.contentArea, 
          isRecording && styles.contentAreaRecording,
          isLandscape && styles.contentAreaLandscape
        ]}>
          {!isRecording ? (
            /* IDLE SCREEN: Big Start Button centered without static data view */
            <View style={styles.idleStartContainer}>
              <View style={styles.idleContent}>
                <View style={styles.idleIconBadge}>
                  <Text style={styles.idleRowingIcon}>🚣</Text>
                </View>
                <Text style={styles.idleTitle}>{t('app.title')}</Text>
                <Text style={styles.idleSubtitle}>{t('recording.status.idle')}</Text>

                <TouchableOpacity
                  style={styles.bigStartButton}
                  onPress={handleStart}
                  disabled={transitioning}
                  activeOpacity={0.8}
                >
                  <Text style={styles.bigStartIcon}>▶</Text>
                  <Text style={styles.bigStartText}>{t('recording.start')}</Text>
                </TouchableOpacity>

                {/* REMUS Hardware Auto-Detect Status in Idle */}
                <View style={styles.remusIdleContainer}>
                  <View
                    style={[
                      styles.remusDot,
                      remusConnectionState === 'connected'
                        ? (remusTelemetry?.gps.fix ? styles.remusDotConnected : styles.remusDotWarning)
                        : remusConnectionState === 'scanning' || remusConnectionState === 'connecting'
                        ? styles.remusDotScanning
                        : styles.remusDotIdle,
                    ]}
                  />
                  <Text style={styles.remusIdleText}>
                    {remusConnectionState === 'connected'
                      ? (remusTelemetry?.gps.fix
                          ? t('recorder.remus.connectedLockedDetail', {
                              count: remusTelemetry.gps.satellitesInUse || remusTelemetry.gps.satellitesInView,
                              accuracy: remusTelemetry.gps.accuracyMeters != null && remusTelemetry.gps.accuracyMeters > 0
                                ? `${Math.round(remusTelemetry.gps.accuracyMeters)}m`
                                : '3D',
                            })
                          : t('recorder.remus.connectedSearchingDetail', {
                              count: remusTelemetry?.gps.satellitesInUse || remusTelemetry?.gps.satellitesInView || 0,
                            }))
                      : remusConnectionState === 'scanning' || remusConnectionState === 'connecting'
                      ? t('recorder.remus.searching')
                      : t('recorder.remus.disconnected')}
                  </Text>
                </View>

                <Text style={styles.idleTip}>{t('recording.screenOffTip')}</Text>
              </View>
            </View>
          ) : (
            /* SPEEDCOACH UNIFIED SINGLE-SCREEN (Only shown when recording) */
            <View style={[styles.speedCoachContainer, styles.speedCoachContainerRecording]}>
              {/* SpeedCoach Top Bezel Bar */}
              <View style={styles.scHeader}>
                <Text style={styles.scTime}>
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={[
                  styles.scStatusText, 
                  activeSprint ? styles.scStatusSprint : (sprintCountdown !== null ? styles.scStatusCountdown : (isPaused ? styles.scStatusPaused : styles.scStatusRecording))
                ]}>
                  {activeSprint 
                    ? `⚡ TIRO ${activeSprint.target}M` 
                    : sprintCountdown !== null 
                      ? `⚡ PREPARAR ${sprintTarget}M` 
                      : (isPaused ? 'PAUSADO' : '● GRAVANDO')}
                </Text>
                <View style={styles.scIndicatorsRow}>
                  {/* REMUS Hardware Indicator: GREEN only when 3D fix locked, AMBER when searching */}
                  <View
                    style={[
                      styles.remusIndicatorBadge,
                      remusConnectionState === 'connected'
                        ? (remusTelemetry?.gps.fix
                            ? styles.remusIndicatorBadgeConnected
                            : styles.remusIndicatorBadgeWarning)
                        : styles.remusIndicatorBadgeIdle,
                    ]}
                  >
                    <Text
                      style={[
                        styles.remusIndicatorText,
                        remusConnectionState === 'connected'
                          ? (remusTelemetry?.gps.fix
                              ? styles.remusIndicatorTextConnected
                              : styles.remusIndicatorTextWarning)
                          : styles.remusIndicatorTextIdle,
                      ]}
                    >
                      {remusConnectionState === 'connected'
                        ? formatRemusGpsBadge({
                            satellites: remusTelemetry?.gps.satellitesInUse || remusTelemetry?.gps.satellitesInView || 0,
                            accuracyMeters: remusTelemetry?.gps.accuracyMeters,
                            fix: remusTelemetry?.gps.fix,
                            searchingLabel: t('recorder.remus.searchingGps'),
                          })
                        : remusConnectionState === 'scanning' || remusConnectionState === 'connecting'
                        ? '📡 …'
                        : '📡 Off'}
                    </Text>
                  </View>

                  <Text style={[styles.hrText, { color: hrDisplay.color }]}>
                    {hrDisplay.icon} {hrDisplay.value}
                  </Text>
                  <GpsSignalIndicator
                    accuracyMeters={
                      remusConnectionState === 'connected' && remusTelemetry?.gps.accuracyMeters != null
                        ? remusTelemetry.gps.accuracyMeters
                        : metrics.horizontalAccuracyMeters
                    }
                  />
                  <Text style={styles.batteryText}>🔋</Text>
                </View>
              </View>

              {/* Countdown Overlay when preparing sprint */}
              {sprintCountdown !== null && (
                <View style={styles.countdownOverlay}>
                  <Text style={styles.countdownPrompt}>LARGADA EM</Text>
                  <Text style={[
                    styles.countdownNumber,
                    sprintCountdown <= 3 && styles.countdownNumberUrgent
                  ]}>
                    {sprintCountdown}
                  </Text>
                  <Text style={styles.countdownTarget}>Tiro de {sprintTarget}m</Text>
                </View>
              )}

              {/* SpeedCoach 4 Quadrants (Background changes during sprint or pause) */}
              <View style={styles.scRow}>
                {/* Top Left: Stroke Rate (SPM) */}
                <View style={[
                  styles.scQuadrant, 
                  styles.scBorderRight, 
                  styles.scBorderBottom,
                  activeSprint && styles.scQuadrantSprint,
                  activeSprint && styles.scBorderRightSprint,
                  activeSprint && styles.scBorderBottomSprint,
                  isPaused && styles.scQuadrantPaused,
                  isPaused && styles.scBorderRightPaused,
                  isPaused && styles.scBorderBottomPaused,
                ]}>
                  <Text style={[
                    styles.scValueBig,
                    activeSprint && styles.scValueBigSprint,
                    isPaused && styles.scValueBigPaused,
                    (isCollectingSpm && !remusTelemetry?.strokeRateSpm) && styles.scValueCollecting,
                  ]} adjustsFontSizeToFit numberOfLines={1}>
                    {remusTelemetry?.strokeRateSpm != null
                      ? remusTelemetry.strokeRateSpm.toFixed(0)
                      : (spmDisplay.value !== null ? spmDisplay.value.toFixed(0) : (isCollectingSpm ? '—' : '0'))}
                  </Text>
                  {remusTelemetry?.strokeRateSpm != null ? (
                    <Text style={[styles.scSubStatus, { color: '#4ADE80' }]}>
                      REMUS
                    </Text>
                  ) : isCollectingSpm ? (
                    <Text style={[styles.scSubStatus, activeSprint && styles.scLabelSprint, isPaused && styles.scLabelPaused]}>
                      {t('recorder.spm.collectingStatus')}
                    </Text>
                  ) : null}
                  <Text style={[
                    styles.scLabel, 
                    activeSprint && styles.scLabelSprint,
                    isPaused && styles.scLabelPaused,
                  ]}>SPM</Text>
                </View>

                {/* Top Right: 500m Split */}
                <View style={[
                  styles.scQuadrant, 
                  styles.scBorderBottom,
                  activeSprint && styles.scQuadrantSprint,
                  activeSprint && styles.scBorderBottomSprint,
                  isPaused && styles.scQuadrantPaused,
                  isPaused && styles.scBorderBottomPaused,
                ]}>
                  <Text style={[
                    styles.scValueBig,
                    activeSprint && styles.scValueBigSprint,
                    isPaused && styles.scValueBigPaused,
                  ]} adjustsFontSizeToFit numberOfLines={1}>
                    {pace > 0 ? formatDuration(Math.floor(pace)) : '0:00'}
                  </Text>
                  <Text style={[
                    styles.scLabel, 
                    activeSprint && styles.scLabelSprint,
                    isPaused && styles.scLabelPaused,
                  ]}>/500M</Text>
                </View>
              </View>

              <View style={styles.scRow}>
                {/* Bottom Left: TIME (Workout Duration or Sprint Duration) */}
                <View style={[
                  styles.scQuadrant, 
                  styles.scBorderRight,
                  activeSprint && styles.scQuadrantSprint,
                  activeSprint && styles.scBorderRightSprint,
                  isPaused && styles.scQuadrantPaused,
                  isPaused && styles.scBorderRightPaused,
                ]}>
                  <Text style={[
                    styles.scValueBig,
                    activeSprint && styles.scValueBigSprint,
                    isPaused && styles.scValueBigPaused,
                  ]} adjustsFontSizeToFit numberOfLines={1}>
                    {activeSprint 
                      ? formatDuration(sprintElapsed) 
                      : (sprintCountdown !== null ? '00:00' : formatDuration(duration))}
                  </Text>
                  <Text style={[
                    styles.scLabel, 
                    activeSprint && styles.scLabelSprint,
                    isPaused && styles.scLabelPaused,
                  ]}>
                    {activeSprint ? 'TEMPO TIRO' : (sprintCountdown !== null ? 'PREPARAR' : 'TIME')}
                  </Text>
                </View>

                {/* Bottom Right: DISTANCE (Reducing toward 0m on sprint) */}
                <View style={[
                  styles.scQuadrant,
                  activeSprint && styles.scQuadrantSprint,
                  isPaused && styles.scQuadrantPaused,
                ]}>
                  <Text style={[
                    styles.scValueBig,
                    activeSprint && styles.scValueBigSprint,
                    isPaused && styles.scValueBigPaused,
                  ]} adjustsFontSizeToFit numberOfLines={1}>
                    {activeSprint 
                      ? sprintRemaining.toFixed(0) 
                      : (sprintCountdown !== null ? String(sprintTarget ?? 0) : (metrics.distanceMeters?.toFixed(0) ?? '0'))}
                  </Text>
                  <Text style={[
                    styles.scLabel, 
                    activeSprint && styles.scLabelSprint,
                    isPaused && styles.scLabelPaused,
                  ]}>
                    {activeSprint ? 'METROS REST.' : (sprintCountdown !== null ? 'ALVO (M)' : 'METERS')}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Controls Container with FABs (only when recording) */}
        {isRecording && (
          <View 
            style={[
              styles.bottomControlsContainer,
              isLandscape && styles.sideControlsContainerLandscape
            ]}
          >
            <View style={[
              styles.fabsRowRight,
              isLandscape && styles.fabsColumnLandscape
            ]}>
              {activeSprint ? (
                /* IN SPRINT: Show Finish & Cancel; HIDE Stop button */
                <>
                  {/* Finalizar Sprint FAB (Verde) */}
                  <View style={styles.fabItem}>
                    <TouchableOpacity
                      style={[styles.fabCircle, styles.sprintFabGreen, transitioning && styles.fabDisabled]}
                      onPress={finishSprint}
                      disabled={transitioning}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.fabIcon}>✓</Text>
                    </TouchableOpacity>
                    <Text style={styles.fabText}>{t('sprint.finish')}</Text>
                  </View>

                  {/* Cancelar Sprint FAB (Vermelho) */}
                  <View style={styles.fabItem}>
                    <TouchableOpacity
                      style={[styles.fabCircle, styles.cancelSprintFab, transitioning && styles.fabDisabled]}
                      onPress={cancelSprint}
                      disabled={transitioning}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.fabIcon}>✕</Text>
                    </TouchableOpacity>
                    <Text style={styles.fabText}>{t('sprint.cancel')}</Text>
                  </View>
                </>
              ) : sprintCountdown !== null ? (
                /* IN COUNTDOWN: Show Cancel; HIDE Stop button */
                <View style={styles.fabItem}>
                  <TouchableOpacity
                    style={[styles.fabCircle, styles.cancelSprintFab, transitioning && styles.fabDisabled]}
                    onPress={cancelSprint}
                    disabled={transitioning}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.fabIcon}>✕</Text>
                  </TouchableOpacity>
                  <Text style={styles.fabText}>{t('sprint.cancel')}</Text>
                </View>
              ) : (
                /* NORMAL RECORDING: Show Sprint FAB with Speed Dial */
                <View style={styles.fabItem}>
                  {/* Sprint Speed Dial Options: 500m, 250m, 100m */}
                  {sprintMenuOpen && (
                    <View style={[
                      styles.sprintSpeedDial,
                      isLandscape && styles.sprintSpeedDialLandscape
                    ]}>
                      <TouchableOpacity
                        style={styles.sprintOptionFab}
                        onPress={() => initiateSprint(500)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.sprintOptionDistance}>500m</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sprintOptionFab}
                        onPress={() => initiateSprint(250)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.sprintOptionDistance}>250m</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sprintOptionFab}
                        onPress={() => initiateSprint(100)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.sprintOptionDistance}>100m</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.fabCircle, 
                      styles.sprintFabGreen, 
                      sprintMenuOpen && styles.sprintFabActive,
                      transitioning && styles.fabDisabled
                    ]}
                    onPress={() => setSprintMenuOpen(prev => !prev)}
                    disabled={transitioning}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.fabIcon}>{sprintMenuOpen ? '✕' : '⚡'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.fabText}>{t('recording.sprint')}</Text>
                </View>
              )}

              {/* Pause / Resume FAB (Azul Claro) */}
              <View style={styles.fabItem}>
                <TouchableOpacity
                  style={[
                    styles.fabCircle, 
                    styles.pauseFabLightBlue,
                    transitioning && styles.fabDisabled
                  ]}
                  onPress={() => {
                    setSprintMenuOpen(false);
                    setIsPaused(prev => !prev);
                  }}
                  disabled={transitioning}
                  activeOpacity={0.8}
                >
                  <Text style={styles.fabIconPause}>{isPaused ? '▶' : '⏸'}</Text>
                </TouchableOpacity>
                <Text style={styles.fabText}>{isPaused ? t('recording.resume') : t('recording.pause')}</Text>
              </View>

              {/* Stop FAB (Vermelho) - ONLY shown when NOT in sprint or countdown */}
              {!activeSprint && sprintCountdown === null && (
                <View style={styles.fabItem}>
                  <TouchableOpacity
                    style={[
                      styles.fabCircle, 
                      styles.stopFabRed,
                      transitioning && styles.fabDisabled
                    ]}
                    onPress={() => {
                      setSprintMenuOpen(false);
                      handleStop();
                    }}
                    disabled={transitioning}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.fabIconStop}>⏹</Text>
                  </TouchableOpacity>
                  <Text style={styles.fabText}>{t('recording.stop')}</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  safeAreaRecording: {
    backgroundColor: '#000000',
  },
  screenWrapper: {
    flex: 1,
  },
  screenWrapperLandscape: {
    flexDirection: 'row',
  },
  contentArea: {
    flex: 1,
    padding: 12,
  },
  contentAreaRecording: {
    padding: 0,
  },
  contentAreaLandscape: {
    flex: 1,
  },
  scrollContainer: {
    paddingBottom: 24,
  },

  /* SPEEDCOACH UNIFIED CONTAINER */
  speedCoachContainer: {
    flex: 1,
    backgroundColor: '#000000',
    borderRadius: 20,
    borderWidth: 12,
    borderColor: '#84CC16',
    overflow: 'hidden',
  },
  speedCoachContainerRecording: {
    borderRadius: 0,
    borderWidth: 0,
  },
  scHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#000000',
  },
  scTime: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  scStatusText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  scStatusRecording: {
    color: '#38BDF8',
  },
  scStatusPaused: {
    color: '#F59E0B',
  },
  scStatusSprint: {
    color: '#4ADE80',
  },
  scStatusCountdown: {
    color: '#F59E0B',
  },
  /* Sprint vibrant green theme for quadrants */
  scQuadrantSprint: {
    backgroundColor: '#16A34A',
  },
  scBorderRightSprint: {
    borderRightColor: '#14532D',
  },
  scBorderBottomSprint: {
    borderBottomColor: '#14532D',
  },
  scValueBigSprint: {
    color: '#FFFFFF',
  },
  scLabelSprint: {
    color: '#DCFCE7',
  },
  /* Countdown Overlay */
  countdownOverlay: {
    position: 'absolute',
    top: 40,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
  countdownPrompt: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  countdownNumber: {
    fontSize: 96,
    fontWeight: '900',
    color: '#22C55E',
    fontVariant: ['tabular-nums'],
    marginVertical: 4,
  },
  countdownNumberUrgent: {
    color: '#F59E0B',
    transform: [{ scale: 1.15 }],
  },
  countdownTarget: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  scIndicatorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hrText: {
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  gpsIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  gpsText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  gpsBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 12,
    gap: 2,
    paddingBottom: 1,
  },
  gpsBar: {
    width: 3,
    borderRadius: 1,
  },
  gpsBar1: {
    height: 4,
  },
  gpsBar2: {
    height: 7,
  },
  gpsBar3: {
    height: 11,
  },
  batteryText: {
    fontSize: 12,
  },
  remusIndicatorBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remusIndicatorBadgeConnected: {
    backgroundColor: '#14532D',
    borderColor: '#22C55E',
  },
  remusIndicatorBadgeWarning: {
    backgroundColor: '#78350F',
    borderColor: '#F59E0B',
  },
  remusIndicatorBadgeIdle: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  remusIndicatorText: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  remusIndicatorTextConnected: {
    color: '#4ADE80',
  },
  remusIndicatorTextWarning: {
    color: '#FBBF24',
  },
  remusIndicatorTextIdle: {
    color: '#64748B',
  },
  remusIdleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  remusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  remusDotConnected: {
    backgroundColor: '#22C55E',
  },
  remusDotWarning: {
    backgroundColor: '#F59E0B',
  },
  remusDotScanning: {
    backgroundColor: '#F59E0B',
  },
  remusDotIdle: {
    backgroundColor: '#64748B',
  },
  remusIdleText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  scValueCollecting: {
    color: '#94A3B8',
  },
  scSubStatus: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    position: 'absolute',
    top: 6,
    left: 8,
    letterSpacing: 0.5,
  },
  scRow: {
    flex: 1,
    flexDirection: 'row',
  },
  scQuadrant: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  scBorderRight: {
    borderRightWidth: 2,
    borderRightColor: '#000000',
  },
  scBorderBottom: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
  },
  scValueBig: {
    fontSize: 64, // Increase slightly for landscape but scale down
    fontWeight: '900',
    color: '#000000',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
    textAlign: 'center',
    width: '100%',
    // Removed fixed lineHeight to fix clipping with adjustsFontSizeToFit
  },
  scLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000000',
    position: 'absolute',
    bottom: 6,
    right: 8,
  },
  scQuadrantPaused: {
    backgroundColor: '#94A3B8',
  },
  scBorderRightPaused: {
    borderRightColor: '#64748B',
  },
  scBorderBottomPaused: {
    borderBottomColor: '#64748B',
  },
  scValueBigPaused: {
    color: '#0F172A',
  },
  scLabelPaused: {
    color: '#1E293B',
  },

  /* Idle Start Screen */
  idleStartContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  idleContent: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 360,
  },
  idleIconBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  idleRowingIcon: {
    fontSize: 40,
  },
  idleTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 6,
  },
  idleSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 32,
  },
  bigStartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    borderColor: '#4ADE80',
    borderWidth: 2,
    borderRadius: 36,
    paddingVertical: 18,
    paddingHorizontal: 36,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
    minWidth: 260,
  },
  bigStartIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    marginRight: 12,
  },
  bigStartText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  idleTip: {
    marginTop: 36,
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },

  /* Bottom Controls Container */
  bottomControlsContainer: {
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  bottomControlsRecording: {
    backgroundColor: '#000000',
    borderTopColor: '#1E293B',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  sideControlsContainerLandscape: {
    backgroundColor: '#000000',
    borderLeftWidth: 1,
    borderLeftColor: '#1E293B',
    borderTopWidth: 0,
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  fabsRowRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 14,
  },
  fabsColumnLandscape: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  fabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
    position: 'relative',
  },
  fabCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },

  /* Colors: Sprint (Verde), Stop (Vermelho), Pause (Azul Claro) */
  sprintFabGreen: {
    backgroundColor: '#16A34A',
    borderColor: '#4ADE80',
    borderWidth: 2,
    shadowColor: '#16A34A',
  },
  sprintFabActive: {
    backgroundColor: '#15803D',
    borderColor: '#86EFAC',
    borderWidth: 3,
  },
  cancelSprintFab: {
    backgroundColor: '#EF4444',
    borderColor: '#FCA5A5',
    borderWidth: 2,
    shadowColor: '#EF4444',
  },
  stopFabRed: {
    backgroundColor: '#EF4444',
    borderColor: '#F87171',
    borderWidth: 2,
    shadowColor: '#EF4444',
  },
  pauseFabLightBlue: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
    borderWidth: 2,
    shadowColor: '#0284C7',
  },

  fabDisabled: {
    opacity: 0.4,
  },
  fabIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  fabIconStop: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  fabIconPause: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  fabText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  /* Sprint Speed Dial */
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 40,
  },
  sprintSpeedDial: {
    position: 'absolute',
    bottom: 64,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
    zIndex: 60,
  },
  sprintSpeedDialLandscape: {
    position: 'absolute',
    right: 58,
    top: 2,
    bottom: undefined,
    alignSelf: undefined,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 60,
  },
  sprintOptionFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#4ADE80',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 6,
  },
  sprintOptionDistance: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '800',
  },

  /* Bottom Tab Bar */
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  tabText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 14,
  },
  tabTextActive: {
    color: '#38BDF8',
    fontWeight: '700',
  },

  /* Tabs Content: Sprints History */
  tabSectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  sprintsList: {
    gap: 8,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 16,
  },
  sprintItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 8,
  },
  sprintItemTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
  },
  sprintItemTime: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: 'bold',
  },

  /* Metrics / Sensores Tab */
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  metricTile: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 12,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  metricTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  metricTitle: {
    color: '#94A3B8',
    fontSize: 12,
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
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    color: '#64748B',
    fontSize: 10,
  },

  /* Watch Transfer Compact Card */
  transferModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  transferModalContainer: {
    width: '100%',
    maxWidth: 290,
    backgroundColor: '#1E293B',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  transferIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  transferIconText: {
    fontSize: 22,
    color: '#38BDF8',
  },
  transferModalTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
  },
  transferProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 10,
  },
  transferProgressBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  transferProgressBarFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: 4,
  },
  transferProgressBarFillSuccess: {
    backgroundColor: '#4ADE80',
  },
  transferPercentageText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    width: 40,
    textAlign: 'right',
  },
  transferPercentageSuccess: {
    color: '#4ADE80',
  },
  transferSkipButton: {
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  transferSkipButtonText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
  },
});
