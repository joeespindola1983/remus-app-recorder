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
        <Text style={styles.cardTitle}>{t('watch.syncTitle')}</Text>
        <Text style={styles.infoText}>{t('watch.syncTip')}</Text>
      </View>

      {/* Guide Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('watch.guideTitle')}</Text>
        <Text style={styles.guideText}>{t('watch.guideStep1')}</Text>
        <Text style={styles.guideText}>{t('watch.guideStep2')}</Text>
        <Text style={styles.guideText}>{t('watch.guideStep3')}</Text>
        <Text style={[styles.guideText, styles.guideTip]}>{t('watch.guidePermissionsTip')}</Text>
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
  guideTip: {
    color: '#38BDF8',
    fontSize: 12,
    marginTop: 6
  },
  bold: {
    color: '#F8FAFC',
    fontWeight: 'bold'
  }
});
