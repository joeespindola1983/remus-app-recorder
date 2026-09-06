import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  TouchableOpacity,
  Text
} from 'react-native';
import { RecorderScreen } from './screens/RecorderScreen';
import { SessionsScreen } from './screens/SessionsScreen';

export const App = () => {
  const [currentTab, setCurrentTab] = useState<'record' | 'sessions'>('record');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      <View style={styles.content}>
        {currentTab === 'record' ? <RecorderScreen /> : <SessionsScreen />}
      </View>

      <View style={styles.bottomNav}>
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
