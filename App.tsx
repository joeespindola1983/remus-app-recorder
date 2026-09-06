import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar } from 'react-native';
import { RecorderScreen } from './src/screens/RecorderScreen';
import { SessionsScreen } from './src/screens/SessionsScreen';
import { WatchScreen } from './src/screens/WatchScreen';
import { t } from './src/i18n';

type Tab = 'record' | 'sessions' | 'watch';

const App = () => {
  const [activeTab, setActiveTab] = useState<Tab>('record');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      <View style={styles.content}>
        {activeTab === 'record' && <RecorderScreen />}
        {activeTab === 'sessions' && <SessionsScreen />}
        {activeTab === 'watch' && <WatchScreen />}
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'record' && styles.tabItemActive]}
          onPress={() => setActiveTab('record')}
        >
          <Text style={styles.tabIcon}>⏺</Text>
          <Text style={[styles.tabLabel, activeTab === 'record' && styles.tabLabelActive]}>
            {t('tabs.record')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'sessions' && styles.tabItemActive]}
          onPress={() => setActiveTab('sessions')}
        >
          <Text style={styles.tabIcon}>📋</Text>
          <Text style={[styles.tabLabel, activeTab === 'sessions' && styles.tabLabelActive]}>
            {t('tabs.sessions')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'watch' && styles.tabItemActive]}
          onPress={() => setActiveTab('watch')}
        >
          <Text style={styles.tabIcon}>⌚</Text>
          <Text style={[styles.tabLabel, activeTab === 'watch' && styles.tabLabelActive]}>
            {t('tabs.watch')}
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 8,
    paddingBottom: 12
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4
  },
  tabItemActive: {
    transform: [{ scale: 1.05 }]
  },
  tabIcon: {
    fontSize: 20,
    marginBottom: 4
  },
  tabLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500'
  },
  tabLabelActive: {
    color: '#38BDF8',
    fontWeight: 'bold'
  }
});

export default App;

