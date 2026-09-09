import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  TouchableOpacity,
  Text
} from 'react-native';
import { HomeScreen, RecordingMode } from './screens/HomeScreen';
import { RecorderScreen } from './screens/RecorderScreen';
import { SessionsScreen } from './screens/SessionsScreen';

export const App = () => {
  const [currentTab, setCurrentTab] = useState<'home' | 'record' | 'sessions'>('home');
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('free');
  const [targetDistance, setTargetDistance] = useState<number | null>(null);

  const handleSelectMode = (mode: RecordingMode, distance: number | null) => {
    setRecordingMode(mode);
    setTargetDistance(distance);
    setCurrentTab('record');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      <View style={styles.content}>
        {currentTab === 'home' && <HomeScreen onSelectMode={handleSelectMode} />}
        {currentTab === 'record' && (
          <RecorderScreen 
            mode={recordingMode} 
            targetDistance={targetDistance} 
            onCancel={() => setCurrentTab('home')} 
          />
        )}
        {currentTab === 'sessions' && <SessionsScreen />}
      </View>

      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navTab, currentTab === 'home' && styles.navTabActive]}
          onPress={() => setCurrentTab('home')}
        >
          <Text style={[styles.navText, currentTab === 'home' && styles.navTextActive]}>
            🏠 Início
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, currentTab === 'record' && styles.navTabActive]}
          onPress={() => setCurrentTab('record')}
        >
          <Text style={[styles.navText, currentTab === 'record' && styles.navTextActive]}>
            ● Gravar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, currentTab === 'sessions' && styles.navTabActive]}
          onPress={() => setCurrentTab('sessions')}
        >
          <Text style={[styles.navText, currentTab === 'sessions' && styles.navTextActive]}>
            ≡ Sessões
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  content: {
    flex: 1
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 10
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8
  },
  navTabActive: {
    borderTopWidth: 2,
    borderTopColor: '#38BDF8',
    marginTop: -2
  },
  navText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600'
  },
  navTextActive: {
    color: '#38BDF8'
  }
});

export default App;
