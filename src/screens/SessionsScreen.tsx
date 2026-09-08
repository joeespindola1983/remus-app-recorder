import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Share,
  Platform,
  RefreshControl,
  NativeModules
} from 'react-native';
import { t } from '../i18n';
import { RecordingSessionSummary } from '../types/telemetry';
import { SessionManager } from '../services/sessionManager';
import { ExportManager } from '../services/exportManager';
import { bridgeContract } from '../contracts/bridgeContract';
import { analyticsService } from '../services/analyticsService';
import { syncService } from '../services/syncService';
import { RecordingContextForm } from './RecordingContextForm';
import { APP_DISPLAY_VERSION } from '../version';

const sessionManager = new SessionManager(bridgeContract);
const exportManager = new ExportManager(bridgeContract);

export const SessionsScreen: React.FC = () => {
  const [sessions, setSessions] = useState<RecordingSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [pendingRecordingId, setPendingRecordingId] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const list = await sessionManager.list();
      const sorted = [...list].sort((a, b) => {
        const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return timeB - timeA;
      });
      setSessions(sorted);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
      analyticsService.recordError(err, 'SessionsScreen:loadSessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleExport = async (sessionId: string) => {
    try {
      if (Platform.OS === 'android' && NativeModules.RemusTelemetryModule?.shareSession) {
        await NativeModules.RemusTelemetryModule.shareSession(sessionId);
      } else {
        const zipPath = await exportManager.prepareZipForSharing(sessionId);
        const fileUrl = Platform.OS === 'ios' ? (zipPath.startsWith('file://') ? zipPath : `file://${zipPath}`) : zipPath;
        await Share.share({
          title: `remus-session-${sessionId.substring(0, 8)}`,
          url: fileUrl
        });
      }
      await analyticsService.logSessionExported(sessionId);
    } catch (err: any) {
      if (err.message && !err.message.includes('dismissed')) {
        Alert.alert(t('common.error'), err.message);
        analyticsService.recordError(err, 'SessionsScreen:handleExport');
      }
    }
  };

  const handleDelete = async (sessionId: string) => {
    Alert.alert(
      t('sessions.delete'),
      t('sessions.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sessions.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await sessionManager.delete(sessionId);
              loadSessions();
            } catch (err: any) {
              analyticsService.recordError(err, 'SessionsScreen:handleDelete');
            }
          }
        }
      ]
    );
  };

  const handleSync = async () => {
    if (syncing || sessions.length === 0) return;
    setSyncing(true);
    setSyncStatus(t('sessions.syncing'));
    try {
      const report = await syncService.syncSessions(sessions);
      const pending = sessions.filter(s => s.contextCompleteness !== 'complete').length;
      if (report.errors.length > 0) {
        setSyncStatus(t('sessions.syncError', { error: report.errors[0].error }));
      } else if (report.syncedCount > 0) {
        setSyncStatus(t('sessions.syncSuccess', { count: report.syncedCount }));
      } else {
        setSyncStatus(t('sessions.syncUpToDate'));
      }
      if (pending) setSyncStatus(previous => `${previous || ''}\n${t('context.syncPending', {count: pending})}`);
    } catch (err: any) {
      setSyncStatus(t('sessions.syncError', { error: err.message || 'Error' }));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.container}>
      {pendingRecordingId && <RecordingContextForm recordingId={pendingRecordingId} onClose={() => { setPendingRecordingId(null); loadSessions(); }} />}
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('sessions.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.syncButton, syncing && styles.buttonDisabled]}
            onPress={handleSync}
            disabled={syncing}
          >
            <Text style={styles.syncButtonText}>
              {syncing ? '⏳ ' + t('sessions.syncing') : '☁️ ' + t('sessions.sync')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshButton} onPress={loadSessions}>
            <Text style={styles.refreshButtonText}>↻ {t('sessions.refresh')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {syncStatus ? (
        <View style={styles.syncStatusBar}>
          <Text style={styles.syncStatusText}>{syncStatus}</Text>
        </View>
      ) : null}

      {sessions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('sessions.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={loadSessions}
              tintColor="#38BDF8"
            />
          }
          renderItem={({ item }) => (
            <View style={styles.sessionCard}>
              <View style={styles.sessionHeader}>
                <Text style={styles.sessionIdText}>{item.id.substring(0, 8)}</Text>
                <Text style={styles.placementBadge}>{item.placement}</Text>
              </View>

              <Text style={styles.dateText}>
                {new Date(item.startedAt).toLocaleString()}
              </Text>
              <Text style={styles.statsText}>{item.contextCompleteness === 'complete' ? t('context.complete') : t('context.pending')}</Text>

              <Text style={styles.statsText}>
                {t('recording.sampleCount', { count: item.sampleCount })} • {Math.round(item.durationSeconds)}s
              </Text>

              {item.hasWatchRecording && (
                <Text style={styles.watchBadge}>⌚ Apple Watch Attached</Text>
              )}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.exportButton}
                  onPress={() => item.contextCompleteness === 'complete' ? handleExport(item.id) : setPendingRecordingId(item.id)}
                  disabled={item.status === 'recording'}
                >
                  <Text style={styles.exportButtonText}>{item.contextCompleteness === 'complete' ? t('sessions.exportZip') : t('context.pending')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDelete(item.id)}
                >
                  <Text style={styles.deleteButtonText}>{t('sessions.delete')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
      <View style={styles.versionFooter}>
        <Text style={styles.versionFooterText}>{APP_DISPLAY_VERSION}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 16
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  syncButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0284C7',
    borderRadius: 6
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600'
  },
  buttonDisabled: {
    opacity: 0.6
  },
  refreshButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#1E293B',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155'
  },
  refreshButtonText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600'
  },
  syncStatusBar: {
    backgroundColor: '#1E293B',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#38BDF8'
  },
  syncStatusText: {
    color: '#94A3B8',
    fontSize: 12
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  emptyText: {
    color: '#64748B',
    fontSize: 16
  },
  sessionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  sessionIdText: {
    color: '#38BDF8',
    fontWeight: 'bold',
    fontSize: 16
  },
  placementBadge: {
    backgroundColor: '#334155',
    color: '#94A3B8',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden'
  },
  dateText: {
    color: '#E2E8F0',
    fontSize: 14,
    marginBottom: 4
  },
  statsText: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 8
  },
  watchBadge: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8
  },
  exportButton: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600'
  },
  deleteButton: {
    backgroundColor: '#475569',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  deleteButtonText: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '600'
  },
  versionFooter: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionFooterText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  }
});
