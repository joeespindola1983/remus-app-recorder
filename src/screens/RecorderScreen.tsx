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
  NativeModules
} from 'react-native';
import { t } from '../i18n';
import { SensorPlacement } from '../types/telemetry';
import { SessionManager } from '../services/sessionManager';
import { telemetryBridge } from '../services/telemetryBridge';

const sessionManager = new SessionManager(telemetryBridge);
const { RemusTelemetryModule } = NativeModules;
const telemetryEmitter = RemusTelemetryModule ? new NativeEventEmitter(RemusTelemetryModule) : null;

// Mock metrics state interface
interface MetricsState {
  speedKmh: number;
  distanceMeters: number;
  courseDegrees: number;
  headingDegrees: number;
  accelerationG: number;
  rotationRateRad: number;
  gpsAccuracyMeters: number | null;
  gpsRateHz: number;
  imuSamples: number;
  altitudeMeters: number | null;
  pressureKPa: number | null;
  heartRateBpm: number | null;
}

export const RecorderScreen: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isAcquiringGPS, setIsAcquiringGPS] = useState(false);
  const [duration, setDuration] = useState(0);
  const [placement] = useState<SensorPlacement>('hull');

  // Placeholder for real-time metrics that will come from NativeEventEmitter
  const [metrics, setMetrics] = useState<MetricsState>({
    speedKmh: 0,
    distanceMeters: 0,
    courseDegrees: 0,
    headingDegrees: 0,
    accelerationG: 0,
    rotationRateRad: 0,
    gpsAccuracyMeters: null,
    gpsRateHz: 0,
    imuSamples: 0,
    altitudeMeters: null,
    pressureKPa: null,
    heartRateBpm: null
  });

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
    if (!telemetryEmitter) return;
    const subscription = telemetryEmitter.addListener('onTelemetryUpdate', (data: Partial<MetricsState>) => {
      setMetrics(prev => ({ ...prev, ...data }));
    });
    return () => subscription.remove();
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = async () => {
    try {
      await sessionManager.start({
        deviceModel: Platform.OS === 'ios' ? 'iOS Device' : 'Android Device',
        systemVersion: String(Platform.Version),
        motionFrequencyHertz: 100,
        placement,
        notes: ''
      });
      setIsRecording(true);
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    try {
      await sessionManager.stop();
      setIsRecording(false);
    } catch (err: any) {
      console.error(err);
    }
  };

  const renderMetricTile = (title: string, value: string, unit: string) => (
    <View style={styles.metricTile}>
      <Text style={styles.metricTitle}>{title}</Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        
        {/* Recording Card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: isRecording ? '#EF4444' : '#64748B' }]} />
              <Text style={styles.statusText}>
                {isRecording ? 'Recording' : (isAcquiringGPS ? 'Acquiring GPS' : 'Ready')}
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
          >
            <Text style={styles.mainButtonText}>
              {isRecording ? 'Stop recording' : 'Start recording'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Metrics Grid */}
        <View style={styles.metricsGrid}>
          {renderMetricTile('Speed', metrics.speedKmh.toFixed(1), 'km/h')}
          {renderMetricTile('Distance', metrics.distanceMeters.toFixed(0), 'm')}
          {renderMetricTile('Course', `${metrics.courseDegrees.toFixed(0)}°`, 'movement')}
          {renderMetricTile('Heading', `${metrics.headingDegrees.toFixed(0)}°`, 'phone')}
          {renderMetricTile('Acceleration', metrics.accelerationG.toFixed(3), 'g')}
          {renderMetricTile('Rotation', metrics.rotationRateRad.toFixed(3), 'rad/s')}
          {renderMetricTile('GPS accuracy', metrics.gpsAccuracyMeters ? metrics.gpsAccuracyMeters.toFixed(0) : '—', 'm')}
          {renderMetricTile('GPS rate', metrics.gpsRateHz.toFixed(2), 'Hz delivered')}
          {renderMetricTile('IMU samples', metrics.imuSamples.toString(), '100 Hz target')}
          {renderMetricTile('Rel. altitude', metrics.altitudeMeters ? metrics.altitudeMeters.toFixed(1) : '—', 'm')}
          {renderMetricTile('Pressure', metrics.pressureKPa ? metrics.pressureKPa.toFixed(2) : '—', 'kPa')}
          {renderMetricTile('Heart Rate', metrics.heartRateBpm ? metrics.heartRateBpm.toString() : '—', 'bpm (Watch/BLE)')}
        </View>

        {/* Weather Card Placeholder */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Weather</Text>
          <Text style={styles.secondaryText}>Waiting for location...</Text>
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
  metricTile: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 12,
    minHeight: 110,
    justifyContent: 'space-between'
  },
  metricTitle: {
    color: '#94A3B8',
    fontSize: 12
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
  }
});
