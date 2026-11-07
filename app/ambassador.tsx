import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { t } from './_i18n';
import { useLocale } from './_contexts/LocaleContext';
import { useAuth } from './_contexts/AuthContext';
import { getBundledDataset } from './_services/dataset';
import { detectCity } from './_services/overpass';
import {
  CurbSide,
  RULES_WITH_HOURS,
  SIGN_RULES,
  SignRule,
  SnappedStreet,
  guessSignSide,
  ruleToKind,
  signStretch,
  snapToStreet,
  streetBearing,
  submitSignReport,
} from './_services/ambassador';
import { MAP_COLORS } from './_components/mapStyle';

const PHOTO_WIDTH = 960;

interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  source: 'gps' | 'tap';
}

const RULE_ICON: Record<SignRule, keyof typeof Ionicons.glyphMap> = {
  free: 'checkmark-circle',
  timeLimit: 'time',
  paid: 'card',
  permit: 'id-card',
  noParking: 'remove-circle',
  noStopping: 'close-circle',
};

const KIND_COLOR: Record<string, string> = {
  street: MAP_COLORS.streetFree,
  permit: MAP_COLORS.streetFree,
  paid: MAP_COLORS.streetPaid,
  noParking: MAP_COLORS.streetNo,
};

/** "north", "east"… for the side of the street the sign is on */
function cardinal(bearing: number): string {
  const names = ['north', 'east', 'south', 'west'];
  return names[Math.round((((bearing % 360) + 360) % 360) / 90) % 4];
}

async function readFix(tap: { lat: number; lng: number } | null): Promise<Fix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === 'granted') {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      let heading: number | null = null;
      if (Platform.OS !== 'web') {
        const h = await Location.getHeadingAsync().catch(() => null);
        // trueHeading is -1 when the OS can't correct for declination yet
        heading = h ? (h.trueHeading >= 0 ? h.trueHeading : h.magHeading) : null;
      }
      const fix: Fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        heading,
        source: 'gps',
      };
      // The photo is of a sign where the phone is, even if a different street was tapped
      return fix;
    }
  } catch (err) {
    console.warn('Ambassador location failed:', err);
  }
  return tap ? { ...tap, accuracy: null, heading: null, source: 'tap' } : null;
}

export default function AmbassadorScreen() {
  useLocale();
  const insets = useSafeAreaInsets();
  const { account, uid } = useAuth();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const tap = params.lat && params.lng && Number.isFinite(Number(params.lat))
    ? { lat: Number(params.lat), lng: Number(params.lng) }
    : null;

  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [side, setSide] = useState<CurbSide | null>(null);
  const [sideMethod, setSideMethod] = useState<'position' | 'heading' | 'manual'>('position');
  const [rule, setRule] = useState<SignRule | null>(null);
  const [hours, setHours] = useState(2);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const overlays = useMemo(() => getBundledDataset().overlays, []);
  const snap: SnappedStreet | null = useMemo(
    () => (fix ? snapToStreet(overlays, { lat: fix.lat, lng: fix.lng }) : null),
    [fix, overlays],
  );

  useEffect(() => {
    if (!snap || !fix) return;
    const guess = guessSignSide(snap, { lat: fix.lat, lng: fix.lng }, fix.heading);
    setSide(guess.side);
    setSideMethod(guess.method);
  }, [snap, fix]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const takePhoto = async () => {
    setError(null);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setError(t('ambassador.cameraDenied')); return; }
      }
      // Start locating while the camera is open: the position is where the photo is taken
      setLocating(true);
      const fixPromise = readFix(tap);
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
      if (result.canceled || !result.assets?.[0]) { setLocating(false); return; }
      const shrunk = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: PHOTO_WIDTH } }],
        { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!shrunk.base64) throw new Error('no image data');
      setPhoto({ uri: shrunk.uri, base64: shrunk.base64 });
      const newFix = await fixPromise;
      setFix(newFix);
      if (!newFix) setError(t('ambassador.noLocation'));
    } catch (err) {
      console.warn('Sign photo failed:', err);
      setError(t('ambassador.photoFailed'));
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!photo || !fix || !snap || !side || !rule || !uid) return;
    setBusy(true);
    setError(null);
    try {
      await submitSignReport({
        userId: uid,
        lat: fix.lat,
        lng: fix.lng,
        accuracyMeters: fix.accuracy,
        headingDeg: fix.heading,
        side,
        sideMethod: fix.source === 'tap' ? 'manual' : sideMethod,
        road: snap.road,
        city: detectCity(fix.lat, fix.lng) === 'Gatineau' ? 'Gatineau' : 'Ottawa',
        rule,
        hours: RULES_WITH_HOURS.includes(rule) ? hours : null,
        note,
        stretch: signStretch(snap),
        photo: photo.base64,
      });
      setDone(true);
    } catch (err) {
      console.warn('Sign report failed:', err);
      setError(t('errors.submitFailed'));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={close} hitSlop={12} accessibilityLabel={t('common.close')}>
        <Ionicons name="close" size={26} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{t('ambassador.title')}</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  const shell = (children: React.ReactNode) => (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {header}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );

  // Ambassadors need an account: their photos are tied to a person who can be asked or thanked
  if (!account) {
    return shell(
      <>
        <Ionicons name="ribbon-outline" size={60} color="#00E676" style={{ alignSelf: 'center' }} />
        <Text style={styles.title}>{t('ambassador.joinTitle')}</Text>
        <Text style={styles.body}>{t('ambassador.joinBody')}</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/account')} activeOpacity={0.85}>
          <Text style={styles.primaryText}>{t('ambassador.joinButton')}</Text>
        </TouchableOpacity>
      </>,
    );
  }

  if (done) {
    return shell(
      <>
        <Ionicons name="checkmark-circle" size={64} color="#00E676" style={{ alignSelf: 'center' }} />
        <Text style={styles.title}>{t('ambassador.thanksTitle')}</Text>
        <Text style={styles.body}>{t('ambassador.thanksBody', { road: snap?.road ?? t('spot.street') })}</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => { setDone(false); setPhoto(null); setFix(null); setRule(null); setNote(''); }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryText}>{t('ambassador.another')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={close}>
          <Text style={styles.secondaryText}>{t('ambassador.backToMap')}</Text>
        </TouchableOpacity>
      </>,
    );
  }

  const bearing = snap ? streetBearing(snap) : 0;
  const sideBearing = side === 'right' ? bearing + 90 : bearing - 90;
  const kindColor = rule ? KIND_COLOR[ruleToKind(rule)] ?? '#fff' : '#555';
  const canSubmit = !!photo && !!fix && !!snap && !!side && !!rule && !busy;

  return shell(
    <>
      {!photo && (
        <>
          <Text style={styles.title}>{t('ambassador.howTitle')}</Text>
          {(['step1', 'step2', 'step3'] as const).map((k, i) => (
            <View key={k} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.body}>{t(`ambassador.${k}`)}</Text>
            </View>
          ))}
        </>
      )}

      {photo && <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />}

      <TouchableOpacity
        style={photo ? styles.secondaryBtn : styles.primaryBtn}
        onPress={takePhoto}
        disabled={locating || busy}
        activeOpacity={0.85}
      >
        {locating ? <ActivityIndicator color={photo ? '#fff' : '#111'} /> : (
          <>
            <Ionicons name="camera" size={20} color={photo ? '#fff' : '#111'} />
            <Text style={photo ? styles.secondaryText : styles.primaryText}>
              {photo ? t('ambassador.retake') : t('ambassador.takePhoto')}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {photo && fix && !snap && <Text style={styles.error}>{t('ambassador.noStreet')}</Text>}

      {photo && snap && side && (
        <View style={styles.card}>
          <Text style={styles.label}>{t('ambassador.street')}</Text>
          <Text style={styles.value}>{snap.road ?? t('spot.street')}</Text>
          <Text style={styles.label}>{t('ambassador.side')}</Text>
          <View style={styles.sideRow}>
            <Text style={[styles.value, { flex: 1 }]}>
              {t('ambassador.sideValue', { dir: t(`ambassador.dir.${cardinal(sideBearing)}`) })}
            </Text>
            <TouchableOpacity
              style={styles.flipBtn}
              onPress={() => { setSide(s => (s === 'left' ? 'right' : 'left')); setSideMethod('manual'); }}
            >
              <Ionicons name="swap-horizontal" size={16} color="#00E676" />
              <Text style={styles.flipText}>{t('ambassador.flip')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            {sideMethod === 'heading' ? t('ambassador.sideByHeading')
              : sideMethod === 'manual' ? t('ambassador.sideManual')
              : t('ambassador.sideByPosition')}
          </Text>
          {fix?.accuracy != null && (
            <Text style={styles.hint}>{t('ambassador.accuracy', { meters: Math.round(fix.accuracy) })}</Text>
          )}
          {fix?.source === 'tap' && <Text style={styles.hint}>{t('ambassador.usedTap')}</Text>}
        </View>
      )}

      {photo && snap && (
        <>
          <Text style={styles.sectionTitle}>{t('ambassador.whatSays')}</Text>
          <View style={styles.rules}>
            {SIGN_RULES.map(r => {
              const color = KIND_COLOR[ruleToKind(r)] ?? '#fff';
              const active = rule === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.ruleChip, { borderColor: active ? color : '#333' }, active && { backgroundColor: `${color}22` }]}
                  onPress={() => setRule(r)}
                  activeOpacity={0.85}
                >
                  <Ionicons name={RULE_ICON[r]} size={18} color={color} />
                  <Text style={styles.ruleText}>{t(`ambassador.rule.${r}`)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {rule && RULES_WITH_HOURS.includes(rule) && (
            <View style={styles.hoursRow}>
              <Text style={styles.body}>{t('ambassador.hours')}</Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setHours(h => Math.max(0.25, h <= 1 ? h - 0.25 : h - 1))}>
                <Ionicons name="remove" size={18} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.hoursValue}>{hours < 1 ? `${Math.round(hours * 60)} min` : `${hours} h`}</Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => setHours(h => Math.min(24, h < 1 ? h + 0.25 : h + 1))}>
                <Ionicons name="add" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder={t('ambassador.notePlaceholder')}
            placeholderTextColor="#666"
            maxLength={120}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: canSubmit ? kindColor : '#333' }]}
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            {busy ? <ActivityIndicator color="#111" /> : (
              <Text style={[styles.primaryText, !canSubmit && { color: '#888' }]}>{t('ambassador.submit')}</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>{t('ambassador.privacy')}</Text>
        </>
      )}

      {!snap && error && <Text style={styles.error}>{error}</Text>}
    </>,
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { paddingHorizontal: 20, gap: 12, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 6 },
  body: { color: '#CCC', fontSize: 15, lineHeight: 21, flexShrink: 1 },
  hint: { color: '#888', fontSize: 12, lineHeight: 17 },
  error: { color: '#FF5252', fontSize: 14, textAlign: 'center' },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#00E676',
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { color: '#111', fontWeight: '800' },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: '#111' },
  primaryBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#00E676', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  primaryText: { color: '#111', fontSize: 16, fontWeight: '800' },
  secondaryBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: '#1F1F1F', borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333', minHeight: 48,
  },
  secondaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#1A1A1A', borderRadius: 14, padding: 14, gap: 4, borderWidth: 1, borderColor: '#2A2A2A' },
  label: { color: '#777', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 4 },
  value: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flipBtn: {
    flexDirection: 'row', gap: 4, alignItems: 'center', borderWidth: 1, borderColor: '#00E676',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  flipText: { color: '#00E676', fontWeight: '700', fontSize: 13 },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ruleChip: {
    flexDirection: 'row', gap: 6, alignItems: 'center', borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, minWidth: '47%', flexGrow: 1,
  },
  ruleText: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  hoursValue: { color: '#fff', fontSize: 18, fontWeight: '800', minWidth: 64, textAlign: 'center' },
  input: {
    backgroundColor: '#161616', color: '#fff', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 13, fontSize: 15, borderWidth: 1, borderColor: '#2A2A2A',
  },
});
