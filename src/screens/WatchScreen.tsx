import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  NativeModules,
  Platform,
  ScrollView
} from 'react-native';
import { t } from '../i18n';

const { RemusTelemetryModule } = NativeModules;

export const WatchScreen: React.FC = () => {
  const [isRecovering, setIsRecovering] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const handleRecover = async () => {
    setIsRecovering(true);
    setStatusMessage('Solicitando dados pendentes do relógio...');
    try {
      if (RemusTelemetryModule && RemusTelemetryModule.requestWatchRecovery) {
        await RemusTelemetryModule.requestWatchRecovery();
        setStatusMessage('Sinal de recuperação enviado ao Apple Watch.');
      } else {
        setStatusMessage('Módulo nativo pronto. Aguardando sincronização automática.');
      }
      Alert.alert(t('common.success'), t('watch.syncTip'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || 'Falha na recuperação');
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('watch.title')}</Text>

      {/* Status Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('watch.status')}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: '#10B981' }]} />
          <Text style={styles.statusText}>{t('watch.paired')}</Text>
        </View>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.statusText}>{t('watch.appInstalled')}</Text>
        </View>
      </View>

      {/* Sync Info Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sincronização em Segundo Plano</Text>
        <Text style={styles.infoText}>{t('watch.syncTip')}</Text>

        <TouchableOpacity
          style={[styles.actionButton, isRecovering && styles.actionButtonDisabled]}
          onPress={handleRecover}
          disabled={isRecovering}
        >
          <Text style={styles.actionButtonText}>
            {isRecovering ? 'Sincronizando...' : t('watch.recover')}
          </Text>
        </TouchableOpacity>

        {statusMessage ? (
          <Text style={styles.feedbackText}>{statusMessage}</Text>
        ) : null}
      </View>

      {/* Guide Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dica de Uso no Apple Watch</Text>
        <Text style={styles.guideText}>
          1. Abra o app <Text style={styles.bold}>Remus Watch</Text> no seu Apple Watch.
        </Text>
        <Text style={styles.guideText}>
          2. Conceda as permissões de Saúde (HealthKit) e Movimento quando solicitado.
        </Text>
        <Text style={styles.guideText}>
          3. Você pode iniciar a gravação diretamente pelo relógio ou pelo celular. Ao parar, os arquivos sqlite de ambos os dispositivos são agrupados na mesma sessão.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  content: {
    padding: 16
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 16
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 12
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10
  },
  statusText: {
    color: '#E2E8F0',
    fontSize: 14
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16
  },
  actionButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center'
  },
  actionButtonDisabled: {
    opacity: 0.6
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14
  },
  feedbackText: {
    color: '#38BDF8',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center'
  },
  guideText: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8
  },
  bold: {
    color: '#F8FAFC',
    fontWeight: 'bold'
  }
});
