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
import { telemetryBridge } from '../services/telemetryBridge';

const sessionManager = new SessionManager(telemetryBridge);
const exportManager = new ExportManager(telemetryBridge);

export const SessionsScreen: React.FC = () => {
  const [sessions, setSessions] = useState<RecordingSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const list = await sessionManager.list();
      setSessions(list);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message);
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
    } catch (err: any) {
      if (err.message && !err.message.includes('dismissed')) {
        Alert.alert(t('common.error'), err.message);
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
            await sessionManager.delete(sessionId);
            loadSessions();
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('sessions.title')}</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={loadSessions}>
          <Text style={styles.refreshButtonText}>↻ Atualizar</Text>
        </TouchableOpacity>
      </View>

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

              <Text style={styles.statsText}>
                {t('recording.sampleCount', { count: item.sampleCount })} • {Math.round(item.durationSeconds)}s
              </Text>

              {item.hasWatchRecording && (
                <Text style={styles.watchBadge}>⌚ Apple Watch Attached</Text>
              )}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.exportButton}
                  onPress={() => handleExport(item.id)}
                >
                  <Text style={styles.exportButtonText}>{t('sessions.exportZip')}</Text>
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
    fontSize: 13,
    fontWeight: '600'
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
  }
});
