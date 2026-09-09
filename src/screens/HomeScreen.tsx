import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, SafeAreaView } from 'react-native';
import { t } from '../i18n';

export type RecordingMode = 'free' | 'sprint_250' | 'sprint_500' | 'sprint_1000';

export interface HomeScreenProps {
  onSelectMode: (mode: RecordingMode, targetDistance: number | null) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectMode }) => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Image 
            source={require('../../icon.png')} 
            style={styles.logo} 
            resizeMode="contain" 
          />
          <Text style={styles.title}>Remus</Text>
        </View>

        <View style={styles.optionsContainer}>
          <TouchableOpacity 
            style={[styles.button, styles.freeButton]}
            onPress={() => onSelectMode('free', null)}
          >
            <Text style={styles.buttonText}>Treino Livre</Text>
          </TouchableOpacity>

          <Text style={styles.sectionHeader}>Tiros / Sprints</Text>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => onSelectMode('sprint_250', 250)}
          >
            <Text style={styles.buttonText}>Tiro de 250m</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => onSelectMode('sprint_500', 500)}
          >
            <Text style={styles.buttonText}>Tiro de 500m</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button}
            onPress={() => onSelectMode('sprint_1000', 1000)}
          >
            <Text style={styles.buttonText}>Tiro de 1000m</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  optionsContainer: {
    gap: 16,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1E293B',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  freeButton: {
    backgroundColor: '#0284C7',
    borderColor: '#0369A1',
  },
  buttonText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '600',
  },
});
