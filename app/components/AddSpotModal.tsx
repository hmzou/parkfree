import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SpotType, Coordinate } from '../types';
import { t } from '../i18n';
import { submitUserSpot } from '../services/firebase';
import { ensureAnonymousAuth } from '../services/firebase';

interface Props {
  visible: boolean;
  coordinate: Coordinate | null;
  onClose: () => void;
  onSubmitted: () => void;
}

const SPOT_TYPES: { value: SpotType; labelKey: string }[] = [
  { value: 'street', labelKey: 'addSpot.street' },
  { value: 'lot', labelKey: 'addSpot.lot' },
  { value: 'garage', labelKey: 'addSpot.garage' },
];

export const AddSpotModal: React.FC<Props> = ({
  visible,
  coordinate,
  onClose,
  onSubmitted,
}) => {
  const [selectedType, setSelectedType] = useState<SpotType>('street');
  const [restrictions, setRestrictions] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!coordinate) return;
    setSubmitting(true);
    try {
      const user = await ensureAnonymousAuth();
      await submitUserSpot({
        submittedBy: user.uid,
        lat: coordinate.latitude,
        lng: coordinate.longitude,
        type: selectedType,
        notes,
        timeRestrictions: restrictions || null,
      });

      Alert.alert(t('addSpot.submitted'), t('addSpot.submittedMessage'));
      setRestrictions('');
      setNotes('');
      setSelectedType('street');
      onSubmitted();
      onClose();
    } catch {
      Alert.alert(t('errors.submitFailed'), t('errors.retry'));
    } finally {
      setSubmitting(false);
    }
  }, [coordinate, selectedType, notes, restrictions, onClose, onSubmitted]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>{t('addSpot.title')}</Text>
                <Text style={styles.subtitle}>{t('addSpot.subtitle')}</Text>
              </View>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={24} color="#AAA" />
              </TouchableOpacity>
            </View>

            {coordinate && (
              <View style={styles.coordRow}>
                <Ionicons name="location-outline" size={14} color="#AAA" />
                <Text style={styles.coordText}>
                  {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}
                </Text>
              </View>
            )}

            {/* Type selector */}
            <Text style={styles.fieldLabel}>{t('addSpot.type')}</Text>
            <View style={styles.typeRow}>
              {SPOT_TYPES.map(st => (
                <TouchableOpacity
                  key={st.value}
                  style={[
                    styles.typeChip,
                    selectedType === st.value && styles.typeChipSelected,
                  ]}
                  onPress={() => setSelectedType(st.value)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      selectedType === st.value && styles.typeChipTextSelected,
                    ]}
                  >
                    {t(st.labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Restrictions */}
            <Text style={styles.fieldLabel}>{t('addSpot.restrictions')}</Text>
            <TextInput
              style={styles.textInput}
              placeholder={t('addSpot.restrictionsPlaceholder')}
              placeholderTextColor="#555"
              value={restrictions}
              onChangeText={setRestrictions}
              returnKeyType="next"
            />

            {/* Notes */}
            <Text style={styles.fieldLabel}>{t('addSpot.notes')}</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder={t('addSpot.notesPlaceholder')}
              placeholderTextColor="#555"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting || !coordinate}
              activeOpacity={0.8}
            >
              {submitting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="add-circle-outline" size={20} color="#fff" />
              }
              <Text style={styles.submitBtnText}>
                {submitting ? t('addSpot.submitting') : t('actions.submit')}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    alignSelf: 'center',
    marginVertical: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: '#AAA',
    marginTop: 2,
  },
  coordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  coordText: {
    color: '#555',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fieldLabel: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 4,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#222',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  typeChipSelected: {
    backgroundColor: 'rgba(0,200,83,0.15)',
    borderColor: '#00C853',
  },
  typeChipText: {
    color: '#AAA',
    fontWeight: '600',
    fontSize: 13,
  },
  typeChipTextSelected: {
    color: '#00C853',
  },
  textInput: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16,
  },
  textArea: {
    height: 80,
    paddingTop: 12,
  },
  submitBtn: {
    backgroundColor: '#00C853',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
