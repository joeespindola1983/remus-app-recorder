import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { t } from '../i18n';
import {
  remusDeviceService,
  RemusConnectionState,
} from '../services/remusDeviceService';
import { RemusDeviceTelemetry } from '../contracts/remusDeviceContract';
import { resolveRemusAntennaStatus } from '../utils/dashboardIndicators';

export const DeviceScreen: React.FC = () => {
  const [connectionState, setConnectionState] = useState<RemusConnectionState>(
    remusDeviceService.getConnectionState()
  );
  const [telemetry, setTelemetry] = useState<RemusDeviceTelemetry | null>(
    remusDeviceService.getLatestTelemetry()
  );
  const [deviceName, setDeviceName] = useState<string | null>(
    remusDeviceService.getConnectedDeviceName()
  );
  const [diag, setDiag] = useState(remusDeviceService.getNativeDiagnostics());
  const antennaStatus = resolveRemusAntennaStatus(telemetry?.gps);

  useEffect(() => {
    const unsubConn = remusDeviceService.subscribeConnection((state) => {
      setConnectionState(state);
      setDeviceName(remusDeviceService.getConnectedDeviceName());
      setDiag(remusDeviceService.getNativeDiagnostics());
    });

    const unsubTelem = remusDeviceService.subscribe((data) => {
      setTelemetry(data);
      setDiag(remusDeviceService.getNativeDiagnostics());
    });

    return () => {
      unsubConn();
      unsubTelem();
    };
  }, []);

  const handleToggleConnection = async () => {
    if (connectionState === 'connected') {
      remusDeviceService.disconnect();
    } else {
      await remusDeviceService.connect('REMUS-ESP32');
    }
  };

  const getStatusBadge = () => {
    switch (connectionState) {
      case 'connected':
        return {
          text: t('device.status.connected'),
          color: '#22C55E',
          bg: '#14532D',
        };
      case 'scanning':
        return {
          text: t('device.status.scanning'),
          color: '#F59E0B',
          bg: '#78350F',
        };
      default:
        return {
          text: t('device.status.disconnected'),
          color: '#94A3B8',
          bg: '#334155',
        };
    }
  };

  const badge = getStatusBadge();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('device.title')}</Text>
        <Text style={styles.subtitle}>{t('device.subtitle')}</Text>
      </View>

      {/* CONNECTION CARD */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.deviceName}>
              {deviceName || 'REMUS Hardware'}
            </Text>
            <View
              style={[styles.statusBadge, { backgroundColor: badge.bg }]}
            >
              <Text style={[styles.statusBadgeText, { color: badge.color }]}>
                ● {badge.text}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.button,
              connectionState === 'connected'
                ? styles.buttonDisconnect
                : styles.buttonConnect,
            ]}
            onPress={handleToggleConnection}
            disabled={connectionState === 'scanning'}
          >
            {connectionState === 'scanning' ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.buttonText}>
                {connectionState === 'connected'
                  ? t('device.button.disconnect')
                  : t('device.button.connect')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {connectionState === 'connected' && (
          <View style={styles.livePacketRow}>
            <Text style={styles.livePacketText}>
              {telemetry
                ? `⚡ Telemetria Ativa | Microsegundos: ${telemetry.timestampUs}`
                : '⏳ Aguardando primeiro pacote BLE...'}
            </Text>
          </View>
        )}
      </View>

      {/* DASHBOARD TELEMETRIA */}
      {connectionState === 'connected' && (
        <>
          {/* IMU CARD */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('device.imu.title')}</Text>
            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>AX</Text>
                <Text style={styles.metricValue}>
                  {telemetry?.acceleration.x.toFixed(2) ?? '0.00'} G
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>AY</Text>
                <Text style={styles.metricValue}>
                  {telemetry?.acceleration.y.toFixed(2) ?? '0.00'} G
                </Text>
              </View>
              <View style={[styles.metricItem, styles.metricHighlight]}>
                <Text style={styles.metricLabel}>
                  {t('device.imu.gravity')} (AZ)
                </Text>
                <Text style={[styles.metricValue, styles.highlightValue]}>
                  {telemetry?.acceleration.z.toFixed(2) ?? '1.00'} G
                </Text>
              </View>
            </View>

            <View style={styles.subMetricsRow}>
              <Text style={styles.subMetricText}>
                Giroscópio: GX:{telemetry?.gyroscope.x.toFixed(1) ?? '0.0'}°/s |
                GY:{telemetry?.gyroscope.y.toFixed(1) ?? '0.0'}°/s | GZ:
                {telemetry?.gyroscope.z.toFixed(1) ?? '0.0'}°/s
              </Text>
            </View>
          </View>

          {/* ANTENA GPS & QUALIDADE DE SINAL RF */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.sectionTitle}>
                📡 {t('device.gps.antennaTitle')}
              </Text>
              <View
                style={[
                  styles.pillBadge,
                  { backgroundColor: antennaStatus.badgeBg },
                ]}
              >
                <Text
                  style={[
                    styles.pillBadgeText,
                    { color: antennaStatus.color },
                  ]}
                >
                  ● {t(antennaStatus.titleKey)}
                </Text>
              </View>
            </View>

            {/* PAINEL VISUAL DE FORÇA DO SINAL DA ANTENA */}
            <View style={styles.antennaSignalPanel}>
              <View style={styles.antennaBarsContainer}>
                {[1, 2, 3, 4].map((barIndex) => (
                  <View
                    key={barIndex}
                    style={[
                      styles.signalBar,
                      { height: barIndex * 6 + 4 },
                      barIndex <= antennaStatus.bars
                        ? { backgroundColor: antennaStatus.color }
                        : styles.signalBarInactive,
                    ]}
                  />
                ))}
              </View>

              <View style={styles.antennaSnrContainer}>
                <Text style={styles.antennaSnrLabel}>
                  {t('device.gps.snrLabel')}
                </Text>
                <Text
                  style={[
                    styles.antennaSnrValue,
                    { color: antennaStatus.color },
                  ]}
                >
                  {antennaStatus.snrFormatted}
                </Text>
              </View>
            </View>

            {/* DESCRIÇÃO DE DIAGNÓSTICO DO SINAL */}
            <View
              style={[
                styles.antennaDescBox,
                { borderLeftColor: antennaStatus.color },
              ]}
            >
              <Text style={styles.antennaDescText}>
                {t(antennaStatus.descriptionKey)}
              </Text>
            </View>

            {/* GRADE DE MÉTRICAS DA ANTENA */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>
                  {t('device.gps.satellites')}
                </Text>
                <Text style={styles.metricValue}>
                  {antennaStatus.satellitesFormatted}
                </Text>
                <Text style={styles.metricSubLabel}>
                  {telemetry?.gps.satellitesInUse ?? 0} {t('device.gps.satsInUse')} / {telemetry?.gps.satellitesInView ?? 0} {t('device.gps.satsInView')}
                </Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>
                  {t('device.gps.accuracy')}
                </Text>
                <Text style={styles.metricValue}>
                  {antennaStatus.accuracyFormatted}
                </Text>
                <Text style={styles.metricSubLabel}>
                  {telemetry?.gps.fix
                    ? `● ${t('device.gps.fixLocked')}`
                    : `⏳ ${t('device.gps.fixSearching')}`}
                </Text>
              </View>
            </View>

            <View style={[styles.metricsGrid, { marginTop: 10 }]}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>
                  {t('device.gps.nmeaChars')}
                </Text>
                <Text style={styles.metricValue}>
                  {telemetry?.gps.charsProcessed ?? 0}
                </Text>
                <Text style={styles.metricSubLabel}>
                  {(telemetry?.gps.charsProcessed ?? 0) > 0 ? '⚡ Fluxo UART Ativo' : '❌ Sem recepção'}
                </Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>{t('device.gps.speed')}</Text>
                <Text style={styles.metricValue}>
                  {telemetry?.gps.speedKmph != null
                    ? `${telemetry.gps.speedKmph.toFixed(1)} km/h`
                    : '-- km/h'}
                </Text>
                <Text style={styles.metricSubLabel}>
                  {telemetry?.gps.fix ? 'GPS Doppler' : '--'}
                </Text>
              </View>
            </View>

            <View style={styles.coordsContainer}>
              <Text style={styles.coordsText}>
                LAT:{' '}
                {telemetry?.gps.latitude != null
                  ? telemetry.gps.latitude.toFixed(6)
                  : '--.------'}{' '}
                | LON:{' '}
                {telemetry?.gps.longitude != null
                  ? telemetry.gps.longitude.toFixed(6)
                  : '--.------'}
              </Text>
            </View>

            {/* DICA DE MONTAGEM DA ANTENA */}
            <View style={styles.antennaTipBox}>
              <Text style={styles.antennaTipText}>
                💡 {t('device.gps.antennaTip')}
              </Text>
            </View>
          </View>

          {/* MICROSD CARD */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.sectionTitle}>{t('device.sd.title')}</Text>
              <View
                style={[
                  styles.pillBadge,
                  telemetry?.sdCard.logging
                    ? styles.pillBadgeSuccess
                    : styles.pillBadgeWarning,
                ]}
              >
                <Text
                  style={[
                    styles.pillBadgeText,
                    telemetry?.sdCard.logging
                      ? styles.pillBadgeTextSuccess
                      : styles.pillBadgeTextWarning,
                  ]}
                >
                  {telemetry?.sdCard.logging
                    ? `● ${t('device.sd.logging')}`
                    : t('device.sd.off')}
                </Text>
              </View>
            </View>

            <View style={styles.metricItemSingle}>
              <Text style={styles.metricLabel}>{t('device.sd.lines')}</Text>
              <Text style={styles.metricValueLarge}>
                {telemetry?.sdCard.linesWritten ?? 0}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* DIAGNÓSTICO DO BLUETOOTH */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>🔍 Diagnóstico do Bluetooth</Text>
        <Text style={styles.diagText}>
          • Módulo Swift: {diag.moduleExists ? '✅ Carregado' : '❌ Não encontrado'}
        </Text>
        <Text style={styles.diagText}>
          • BLE Nativo (connectRemusBle):{' '}
          {diag.hasConnectBle
            ? '✅ Ativo no binário'
            : '⚠️ Ausente (O app precisa de npm run ios)'}
        </Text>
        <Text style={styles.diagText}>
          • Sinal NMEA na Antena (Chars RX): {telemetry?.gps.charsProcessed ?? 0}
        </Text>
        <Text style={styles.diagText}>
          • Pacotes recebidos pelo rádio: {diag.rawPacketsReceived}
        </Text>
        <Text style={styles.diagText}>
          • Último dado bruto:{' '}
          <Text style={styles.diagCode}>{diag.lastRawData || '(Aguardando dados)'}</Text>
        </Text>
      </View>

      {/* INFO FOOTER */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>💡 {t('device.info.box')}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  buttonConnect: {
    backgroundColor: '#38BDF8',
  },
  buttonDisconnect: {
    backgroundColor: '#EF4444',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  metricItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricItemSingle: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricHighlight: {
    borderColor: '#38BDF8',
  },
  metricLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 4,
    textAlign: 'center',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  metricValueLarge: {
    fontSize: 22,
    fontWeight: '700',
    color: '#38BDF8',
  },
  highlightValue: {
    color: '#38BDF8',
  },
  subMetricsRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  subMetricText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  pillBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  pillBadgeSuccess: {
    backgroundColor: '#14532D',
  },
  pillBadgeWarning: {
    backgroundColor: '#78350F',
  },
  pillBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pillBadgeTextSuccess: {
    color: '#22C55E',
  },
  pillBadgeTextWarning: {
    color: '#F59E0B',
  },
  coordsContainer: {
    marginTop: 10,
    backgroundColor: '#0F172A',
    padding: 8,
    borderRadius: 6,
  },
  coordsText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    fontFamily: 'Courier',
  },
  infoBox: {
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8',
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  livePacketRow: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  livePacketText: {
    fontSize: 12,
    color: '#38BDF8',
    fontFamily: 'Courier',
    textAlign: 'center',
  },
  diagText: {
    fontSize: 13,
    color: '#CBD5E1',
    marginBottom: 6,
  },
  diagCode: {
    color: '#38BDF8',
    fontFamily: 'Courier',
  },
  antennaSignalPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  antennaBarsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 28,
  },
  signalBar: {
    width: 8,
    borderRadius: 2,
  },
  signalBarInactive: {
    backgroundColor: '#334155',
  },
  antennaSnrContainer: {
    alignItems: 'flex-end',
  },
  antennaSnrLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 2,
  },
  antennaSnrValue: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  antennaDescBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 3,
  },
  antennaDescText: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  metricSubLabel: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
  antennaTipBox: {
    marginTop: 12,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  antennaTipText: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },
});
