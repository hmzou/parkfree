import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '../_contexts/LocaleContext';

/**
 * First-launch language choice. Written in both languages on purpose: the user
 * hasn't told us which one they read yet.
 */
export const LanguagePicker: React.FC = () => {
  const { ready, hasChosen, setLocale } = useLocale();
  if (!ready || hasChosen) return null;

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Ionicons name="language-outline" size={36} color="#00E676" />
        <Text style={styles.title}>Choose your language</Text>
        <Text style={styles.title}>Choisissez votre langue</Text>
        <TouchableOpacity style={styles.button} onPress={() => setLocale('fr')} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Français</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => setLocale('en')} activeOpacity={0.85}>
          <Text style={styles.buttonText}>English</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          You can change it later in Profile · Modifiable plus tard dans Profil
        </Text>
      </View>
    </View>
  );
};

/** Compact FR/EN switch for the map's top bar. */
export const LanguageToggle: React.FC = () => {
  const { locale, setLocale } = useLocale();
  const other = locale === 'fr' ? 'en' : 'fr';
  return (
    <TouchableOpacity
      style={styles.toggle}
      onPress={() => setLocale(other)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={other === 'fr' ? 'Passer en français' : 'Switch to English'}
      hitSlop={8}
    >
      <Text style={styles.toggleText}>{other.toUpperCase()}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 1000,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    backgroundColor: '#00E676',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '700',
  },
  hint: {
    color: '#999',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  toggle: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(26,26,26,0.92)',
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  toggleText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
