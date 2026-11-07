import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from './_i18n';
import { useLocale } from './_contexts/LocaleContext';
import { useAuth } from './_contexts/AuthContext';
import {
  ProviderId,
  authErrorKey,
  availableProviders,
  deleteAccount,
  isEmail,
  reauthenticate,
  resendVerification,
  resetPassword,
  signInWithEmail,
  signInWithProvider,
  signOut,
  signUpWithEmail,
  updateDisplayName,
  validateSignUp,
} from './_services/auth';

type Mode = 'start' | 'signIn' | 'signUp' | 'reset';

const PROVIDER_STYLE: Record<ProviderId, { icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string }> = {
  google: { icon: 'logo-google', bg: '#fff', fg: '#111' },
  microsoft: { icon: 'logo-microsoft', bg: '#2F2F2F', fg: '#fff' },
  apple: { icon: 'logo-apple', bg: '#000', fg: '#fff' },
};

function confirmAsync(title: string, message: string, ok: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export default function AccountScreen() {
  useLocale();
  const insets = useSafeAreaInsets();
  const { account, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>('start');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await job();
    } catch (err) {
      console.warn('Account action failed:', err);
      const msg = authErrorKey(err);
      if (msg !== 'account.errors.cancelled') setError(t(msg));
    } finally {
      setBusy(null);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const onProvider = (id: ProviderId) => run(id, async () => {
    await signInWithProvider(id);
    await refresh();
    close();
  });

  const onSignUp = () => {
    const problem = validateSignUp({ name, email, password, confirm });
    if (problem) { setError(t(problem)); return; }
    void run('signUp', async () => {
      await signUpWithEmail(name, email, password);
      await refresh();
      setPassword('');
      setConfirm('');
      notify(t('account.welcome', { name: name.trim() }), t('account.verifySent', { email: email.trim() }));
    });
  };

  const onSignIn = () => {
    if (!isEmail(email)) { setError(t('account.errors.emailInvalid')); return; }
    if (!password) { setError(t('account.errors.passwordMissing')); return; }
    void run('signIn', async () => {
      await signInWithEmail(email, password);
      await refresh();
      setPassword('');
      close();
    });
  };

  const onReset = () => {
    if (!isEmail(email)) { setError(t('account.errors.emailInvalid')); return; }
    void run('reset', async () => {
      await resetPassword(email).catch(err => {
        // Don't reveal whether an address has an account
        if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
      });
      setInfo(t('account.resetSent', { email: email.trim() }));
    });
  };

  const onDelete = async () => {
    const ok = await confirmAsync(t('account.deleteTitle'), t('account.deleteBody'), t('account.deleteConfirm'));
    if (!ok) return;
    void run('delete', async () => {
      try {
        await deleteAccount();
      } catch (err) {
        if ((err as { code?: string }).code !== 'auth/requires-recent-login') throw err;
        await reauthenticate(deletePassword || undefined);
        await deleteAccount();
      }
      setDeletePassword('');
      notify(t('account.deleted'));
      close();
    });
  };

  const providers = availableProviders();
  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={close} hitSlop={12} accessibilityLabel={t('common.close')}>
        <Ionicons name="close" size={26} color="#fff" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{t('account.title')}</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  const messages = (
    <>
      {error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
      {info && <Text style={styles.info} accessibilityLiveRegion="polite">{info}</Text>}
    </>
  );

  // ── Signed in ──────────────────────────────────────────────────────────────
  if (account) {
    const usesPassword = account.providers.includes('password');
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {header}
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(account.displayName || account.email || '?').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          {editingName ? (
            <View style={styles.inlineRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={name}
                onChangeText={setName}
                placeholder={t('account.name')}
                placeholderTextColor="#666"
                autoFocus
              />
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={() => {
                  if (name.trim().length < 2) { setError(t('account.errors.nameShort')); return; }
                  void run('name', async () => {
                    await updateDisplayName(name);
                    await refresh();
                    setEditingName(false);
                  });
                }}
              >
                <Text style={styles.smallBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.inlineRow}
              onPress={() => { setName(account.displayName ?? ''); setEditingName(true); }}
            >
              <Text style={styles.name}>{account.displayName || t('account.noName')}</Text>
              <Ionicons name="pencil" size={16} color="#888" />
            </TouchableOpacity>
          )}
          <Text style={styles.email}>{account.email ?? '—'}</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('account.signedInWith')}</Text>
            <Text style={styles.detailValue}>
              {account.providers.map(p => t(`account.provider.${p}`, { defaultValue: p })).join(', ')}
            </Text>
          </View>
          {account.email && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('account.emailStatus')}</Text>
              <Text style={[styles.detailValue, { color: account.emailVerified ? '#00E676' : '#FFB300' }]}>
                {account.emailVerified ? t('account.verified') : t('account.notVerified')}
              </Text>
            </View>
          )}
          {account.createdAt && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('account.memberSince')}</Text>
              <Text style={styles.detailValue}>
                {account.createdAt.toLocaleDateString(t('common.dateLocale'), { year: 'numeric', month: 'long', day: 'numeric' })}
              </Text>
            </View>
          )}
          {account.email && !account.emailVerified && (
            <View style={styles.inlineRow}>
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => run('verify', async () => {
                  await resendVerification();
                  setInfo(t('account.verifySent', { email: account.email ?? '' }));
                })}
              >
                <Text style={styles.link}>{t('account.resendVerification')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={() => run('refresh', refresh)}>
                <Text style={styles.link}>{t('account.iVerified')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.note}>{t('account.syncNote')}</Text>
        {messages}

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => run('signOut', async () => { await signOut(); close(); })}
          disabled={busy !== null}
        >
          {busy === 'signOut' ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="log-out-outline" size={18} color="#fff" />
              <Text style={styles.secondaryText}>{t('account.signOut')}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>{t('account.deleteTitle')}</Text>
          <Text style={styles.note}>{t('account.deleteExplain')}</Text>
          {usesPassword && (
            <TextInput
              style={styles.input}
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder={t('account.passwordToDelete')}
              placeholderTextColor="#666"
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          )}
          <TouchableOpacity style={styles.dangerBtn} onPress={onDelete} disabled={busy !== null}>
            {busy === 'delete' ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.dangerBtnText}>{t('account.deleteConfirm')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ── Signed out ─────────────────────────────────────────────────────────────
  const passwordField = (value: string, set: (v: string) => void, placeholder: string, isNew: boolean) => (
    <View style={styles.passwordWrap}>
      <TextInput
        style={[styles.input, { flex: 1, borderWidth: 0 }]}
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor="#666"
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoComplete={isNew ? 'new-password' : 'current-password'}
        textContentType={isNew ? 'newPassword' : 'password'}
      />
      <TouchableOpacity
        onPress={() => setShowPassword(s => !s)}
        hitSlop={10}
        accessibilityLabel={showPassword ? t('account.hidePassword') : t('account.showPassword')}
      >
        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888" />
      </TouchableOpacity>
    </View>
  );

  const emailField = (
    <TextInput
      style={styles.input}
      value={email}
      onChangeText={setEmail}
      placeholder={t('account.email')}
      placeholderTextColor="#666"
      keyboardType="email-address"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      textContentType="emailAddress"
    />
  );

  const primary = (label: string, key: string, onPress: () => void) => (
    <TouchableOpacity style={styles.primaryBtn} onPress={onPress} disabled={busy !== null} activeOpacity={0.85}>
      {busy === key ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );

  const switchMode = (m: Mode) => { setMode(m); setError(null); setInfo(null); };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {header}

        {mode === 'start' && (
          <>
            <Ionicons name="person-circle-outline" size={64} color="#00E676" style={{ alignSelf: 'center' }} />
            <Text style={styles.title}>{t('account.startTitle')}</Text>
            <View style={styles.benefits}>
              {(['benefitSync', 'benefitRecords', 'benefitAmbassador'] as const).map(k => (
                <View key={k} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#00E676" />
                  <Text style={styles.benefitText}>{t(`account.${k}`)}</Text>
                </View>
              ))}
            </View>
            {providers.map(id => (
              <TouchableOpacity
                key={id}
                style={[styles.providerBtn, { backgroundColor: PROVIDER_STYLE[id].bg }]}
                onPress={() => onProvider(id)}
                disabled={busy !== null}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                {busy === id ? <ActivityIndicator color={PROVIDER_STYLE[id].fg} /> : (
                  <>
                    <Ionicons name={PROVIDER_STYLE[id].icon} size={20} color={PROVIDER_STYLE[id].fg} />
                    <Text style={[styles.providerText, { color: PROVIDER_STYLE[id].fg }]}>
                      {t('account.continueWith', { provider: t(`account.provider.${id}`) })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.providerBtn, { backgroundColor: '#1F1F1F', borderWidth: 1, borderColor: '#333' }]}
              onPress={() => switchMode('signUp')}
              activeOpacity={0.85}
            >
              <Ionicons name="mail-outline" size={20} color="#fff" />
              <Text style={[styles.providerText, { color: '#fff' }]}>{t('account.signUpEmail')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('signIn')}>
              <Text style={styles.linkCenter}>{t('account.haveAccount')}</Text>
            </TouchableOpacity>
            {messages}
            <Text style={styles.legal}>{t('account.legal')}</Text>
          </>
        )}

        {mode === 'signUp' && (
          <>
            <Text style={styles.title}>{t('account.createTitle')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('account.name')}
              placeholderTextColor="#666"
              autoComplete="name"
              textContentType="name"
            />
            {emailField}
            {passwordField(password, setPassword, t('account.password'), true)}
            {passwordField(confirm, setConfirm, t('account.confirmPassword'), true)}
            <Text style={styles.hint}>{t('account.passwordRules', { min: 8 })}</Text>
            {messages}
            {primary(t('account.createButton'), 'signUp', onSignUp)}
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('signIn')}>
              <Text style={styles.linkCenter}>{t('account.haveAccount')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('start')}>
              <Text style={styles.linkCenter}>{t('account.otherWays')}</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'signIn' && (
          <>
            <Text style={styles.title}>{t('account.signInTitle')}</Text>
            {emailField}
            {passwordField(password, setPassword, t('account.password'), false)}
            {messages}
            {primary(t('account.signInButton'), 'signIn', onSignIn)}
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('reset')}>
              <Text style={styles.linkCenter}>{t('account.forgot')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('signUp')}>
              <Text style={styles.linkCenter}>{t('account.noAccount')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('start')}>
              <Text style={styles.linkCenter}>{t('account.otherWays')}</Text>
            </TouchableOpacity>
            <Text style={styles.note}>{t('account.signInNote')}</Text>
          </>
        )}

        {mode === 'reset' && (
          <>
            <Text style={styles.title}>{t('account.resetTitle')}</Text>
            <Text style={styles.note}>{t('account.resetExplain')}</Text>
            {emailField}
            {messages}
            {primary(t('account.resetButton'), 'reset', onReset)}
            <TouchableOpacity style={styles.linkBtn} onPress={() => switchMode('signIn')}>
              <Text style={styles.linkCenter}>{t('account.backToSignIn')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { paddingHorizontal: 20, gap: 12, maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  benefits: { gap: 8, marginBottom: 8 },
  benefitRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  benefitText: { color: '#CCC', fontSize: 14, flex: 1 },
  providerBtn: {
    flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 14, minHeight: 50,
  },
  providerText: { fontSize: 16, fontWeight: '700' },
  input: {
    backgroundColor: '#161616', color: '#fff', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 13, fontSize: 16, borderWidth: 1, borderColor: '#2A2A2A',
  },
  passwordWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', paddingRight: 14,
  },
  hint: { color: '#888', fontSize: 12 },
  primaryBtn: {
    backgroundColor: '#00E676', borderRadius: 14, paddingVertical: 15, alignItems: 'center', minHeight: 50,
    justifyContent: 'center', marginTop: 4,
  },
  primaryText: { color: '#111', fontSize: 16, fontWeight: '800' },
  linkBtn: { paddingVertical: 6 },
  link: { color: '#00E676', fontSize: 14, fontWeight: '600' },
  linkCenter: { color: '#00E676', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  error: { color: '#FF5252', fontSize: 14, textAlign: 'center' },
  info: { color: '#00E676', fontSize: 14, textAlign: 'center' },
  note: { color: '#888', fontSize: 13, lineHeight: 18 },
  legal: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 17 },
  card: {
    backgroundColor: '#1A1A1A', borderRadius: 16, padding: 18, gap: 10,
    borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'stretch',
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#00C853', alignItems: 'center',
    justifyContent: 'center', alignSelf: 'center',
  },
  avatarText: { color: '#111', fontSize: 28, fontWeight: '800' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  name: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  email: { color: '#AAA', fontSize: 14, textAlign: 'center' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { color: '#888', fontSize: 14 },
  detailValue: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  smallBtn: { backgroundColor: '#00E676', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  smallBtnText: { color: '#111', fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F1F1F',
    borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#333', minHeight: 50,
  },
  secondaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dangerCard: {
    marginTop: 12, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: '#4A1C1C',
    backgroundColor: '#1A0F0F',
  },
  dangerTitle: { color: '#FF5252', fontSize: 16, fontWeight: '700' },
  dangerBtn: { backgroundColor: '#B71C1C', borderRadius: 12, paddingVertical: 13, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  dangerBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
