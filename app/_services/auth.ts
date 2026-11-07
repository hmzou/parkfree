/**
 * Accounts. Everyone starts as an anonymous Firebase user so the map works
 * without signing up; creating an account *links* that anonymous user, so the
 * parking history and records made before signing up are kept.
 *
 * Providers:
 *  - Email + password: everywhere.
 *  - Google: web popup; native via @react-native-google-signin (needs the web
 *    OAuth client id in GOOGLE_WEB_CLIENT_ID and the app's SHA-1 in Firebase).
 *  - Microsoft: web popup; native via expo-auth-session (needs an Azure app
 *    registration id in MICROSOFT_CLIENT_ID).
 *  - Apple: iOS native sheet; web popup when APPLE_SIGN_IN=1.
 * A provider only shows up once its settings exist, so a half-configured
 * provider never shows a button that fails.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  AuthCredential,
  AuthError,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  User,
  createUserWithEmailAndPassword,
  deleteUser,
  linkWithCredential,
  linkWithPopup,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type AuthProvider,
} from 'firebase/auth';
import { collection, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getLocale } from '../_i18n';

export type ProviderId = 'google' | 'microsoft' | 'apple';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const GOOGLE_WEB_CLIENT_ID = (extra.googleWebClientId as string | undefined) || '';
const GOOGLE_IOS_CLIENT_ID = (extra.googleIosClientId as string | undefined) || '';
const MICROSOFT_CLIENT_ID = (extra.microsoftClientId as string | undefined) || '';
const APPLE_SIGN_IN = extra.appleSignIn === true || extra.appleSignIn === '1';

/** Sign-in buttons to show on this platform, in display order. */
export function availableProviders(platform: string = Platform.OS): ProviderId[] {
  const list: ProviderId[] = [];
  // Each provider needs its own setup in Firebase (and Azure / Apple), so its
  // button only appears once its settings are in the build
  if (GOOGLE_WEB_CLIENT_ID) list.push('google');
  if (MICROSOFT_CLIENT_ID) list.push('microsoft');
  if (APPLE_SIGN_IN && (platform === 'ios' || platform === 'web')) list.push('apple');
  return list;
}

const FIREBASE_PROVIDER_IDS: Record<ProviderId, string> = {
  google: 'google.com',
  microsoft: 'microsoft.com',
  apple: 'apple.com',
};

export interface AccountInfo {
  uid: string;
  isAnonymous: boolean;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** 'password', 'google', 'microsoft', 'apple' */
  providers: string[];
  createdAt: Date | null;
}

export function accountInfo(user: User): AccountInfo {
  const providers = user.providerData.map(p => {
    const match = (Object.keys(FIREBASE_PROVIDER_IDS) as ProviderId[])
      .find(k => FIREBASE_PROVIDER_IDS[k] === p.providerId);
    return match ?? p.providerId;
  });
  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    providers,
    createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime) : null,
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export const MIN_PASSWORD_LENGTH = 8;

/** i18n key of the first problem with a sign-up form, or null when it's fine. */
export function validateSignUp(input: {
  name: string;
  email: string;
  password: string;
  confirm: string;
}): string | null {
  if (input.name.trim().length < 2) return 'account.errors.nameShort';
  if (!isEmail(input.email)) return 'account.errors.emailInvalid';
  if (input.password.length < MIN_PASSWORD_LENGTH) return 'account.errors.passwordShort';
  if (!/[A-Za-z]/.test(input.password) || !/[0-9]/.test(input.password)) {
    return 'account.errors.passwordWeak';
  }
  if (input.password !== input.confirm) return 'account.errors.passwordMismatch';
  return null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Firebase error code → i18n key the account screen can show. */
export function authErrorKey(err: unknown): string {
  const code = (err as AuthError | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-email': return 'account.errors.emailInvalid';
    case 'auth/email-already-in-use': return 'account.errors.emailInUse';
    case 'auth/weak-password': return 'account.errors.passwordShort';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found': return 'account.errors.wrongCredentials';
    case 'auth/too-many-requests': return 'account.errors.tooMany';
    case 'auth/network-request-failed': return 'account.errors.network';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
    case 'cancelled': return 'account.errors.cancelled';
    case 'auth/popup-blocked': return 'account.errors.popupBlocked';
    case 'auth/operation-not-allowed': return 'account.errors.providerOff';
    case 'auth/account-exists-with-different-credential': return 'account.errors.otherProvider';
    case 'auth/requires-recent-login': return 'account.errors.recentLogin';
    case 'not-configured': return 'account.errors.providerOff';
    default: return 'account.errors.generic';
  }
}

// ─── Email + password ─────────────────────────────────────────────────────────

export async function signUpWithEmail(name: string, email: string, password: string): Promise<User> {
  const cleanEmail = email.trim();
  const current = auth.currentUser;
  let user: User;
  if (current?.isAnonymous) {
    // Keep the parking history made before signing up
    const cred = EmailAuthProvider.credential(cleanEmail, password);
    user = (await linkWithCredential(current, cred)).user;
  } else {
    user = (await createUserWithEmailAndPassword(auth, cleanEmail, password)).user;
  }
  await updateProfile(user, { displayName: name.trim() });
  auth.languageCode = getLocale();
  await sendEmailVerification(user).catch(() => null);
  return user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function resetPassword(email: string): Promise<void> {
  auth.languageCode = getLocale();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerification(): Promise<void> {
  if (!auth.currentUser) return;
  auth.languageCode = getLocale();
  await sendEmailVerification(auth.currentUser);
}

export async function updateDisplayName(name: string): Promise<void> {
  if (!auth.currentUser) return;
  await updateProfile(auth.currentUser, { displayName: name.trim() });
}

// ─── Google / Microsoft / Apple ───────────────────────────────────────────────

function webProvider(id: ProviderId): AuthProvider {
  if (id === 'google') {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    return p;
  }
  const p = new OAuthProvider(FIREBASE_PROVIDER_IDS[id]);
  if (id === 'microsoft') {
    p.setCustomParameters({ prompt: 'select_account' });
    p.addScope('email');
  } else {
    p.addScope('email');
    p.addScope('name');
  }
  return p;
}

function randomNonce(length = 32): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

class AuthCancelled extends Error {
  code = 'cancelled';
}

class NotConfigured extends Error {
  code = 'not-configured';
}

interface NativeCredential {
  credential: AuthCredential;
  /** Apple only sends the name the first time */
  displayName?: string | null;
}

/* eslint-disable @typescript-eslint/no-require-imports */
async function nativeGoogle(): Promise<NativeCredential> {
  if (!GOOGLE_WEB_CLIENT_ID) throw new NotConfigured();
  const { GoogleSignin, isSuccessResponse } = require('@react-native-google-signin/google-signin');
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
  });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res) || !res.data?.idToken) throw new AuthCancelled();
  return { credential: GoogleAuthProvider.credential(res.data.idToken) };
}

async function nativeApple(): Promise<NativeCredential> {
  const AppleAuthentication = require('expo-apple-authentication');
  const Crypto = require('expo-crypto');
  if (!(await AppleAuthentication.isAvailableAsync())) throw new NotConfigured();
  const rawNonce = randomNonce();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const res = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
    if (!res.identityToken) throw new AuthCancelled();
    const name = [res.fullName?.givenName, res.fullName?.familyName].filter(Boolean).join(' ');
    return {
      credential: new OAuthProvider('apple.com').credential({ idToken: res.identityToken, rawNonce }),
      displayName: name || null,
    };
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthCancelled();
    throw err;
  }
}

async function nativeMicrosoft(): Promise<NativeCredential> {
  if (!MICROSOFT_CLIENT_ID) throw new NotConfigured();
  const AuthSession = require('expo-auth-session');
  const WebBrowser = require('expo-web-browser');
  WebBrowser.maybeCompleteAuthSession();
  const discovery = await AuthSession.fetchDiscoveryAsync('https://login.microsoftonline.com/common/v2.0');
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'parkfree', path: 'auth' });
  const nonce = randomNonce();
  const request = new AuthSession.AuthRequest({
    clientId: MICROSOFT_CLIENT_ID,
    redirectUri,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
    extraParams: { nonce, prompt: 'select_account' },
  });
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) throw new AuthCancelled();
  const tokens = await AuthSession.exchangeCodeAsync({
    clientId: MICROSOFT_CLIENT_ID,
    code: result.params.code,
    redirectUri,
    extraParams: { code_verifier: request.codeVerifier ?? '' },
  }, discovery);
  if (!tokens.idToken) throw new AuthCancelled();
  return {
    credential: new OAuthProvider('microsoft.com').credential({ idToken: tokens.idToken, rawNonce: nonce }),
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

function isCredentialTaken(err: unknown): boolean {
  const code = (err as AuthError | null)?.code;
  return code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use';
}

/**
 * Sign in with Google, Microsoft or Apple. An anonymous user is linked so their
 * history is kept; if that provider account already belongs to a ParkFree
 * account, we sign into that account instead.
 */
export async function signInWithProvider(id: ProviderId): Promise<User> {
  const current = auth.currentUser;

  if (Platform.OS === 'web') {
    const provider = webProvider(id);
    if (current?.isAnonymous) {
      try {
        return (await linkWithPopup(current, provider)).user;
      } catch (err) {
        if (!isCredentialTaken(err)) throw err;
        const cred = OAuthProvider.credentialFromError(err as AuthError)
          ?? GoogleAuthProvider.credentialFromError(err as AuthError);
        if (cred) return (await signInWithCredential(auth, cred)).user;
        return (await signInWithPopup(auth, provider)).user;
      }
    }
    return (await signInWithPopup(auth, provider)).user;
  }

  const native = id === 'google' ? await nativeGoogle()
    : id === 'apple' ? await nativeApple()
    : await nativeMicrosoft();

  let user: User;
  if (current?.isAnonymous) {
    try {
      user = (await linkWithCredential(current, native.credential)).user;
    } catch (err) {
      if (!isCredentialTaken(err)) throw err;
      user = (await signInWithCredential(auth, native.credential)).user;
    }
  } else {
    user = (await signInWithCredential(auth, native.credential)).user;
  }
  if (native.displayName && !user.displayName) {
    await updateProfile(user, { displayName: native.displayName }).catch(() => null);
  }
  return user;
}

// ─── Sign out / delete ────────────────────────────────────────────────────────

/** The session hook signs back in anonymously, so the map keeps working. */
export async function signOut(): Promise<void> {
  if (Platform.OS !== 'web' && GOOGLE_WEB_CLIENT_ID) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut();
    } catch {
      // Not signed in with Google on this device
    }
  }
  await firebaseSignOut(auth);
}

/** Re-confirm identity before deleting (Firebase requires a recent sign-in). */
export async function reauthenticate(password?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const info = accountInfo(user);
  if (info.providers.includes('password')) {
    if (!password || !user.email) throw Object.assign(new Error('password needed'), { code: 'auth/requires-recent-login' });
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return;
  }
  const id = info.providers.find((p): p is ProviderId => p in FIREBASE_PROVIDER_IDS);
  if (!id) return;
  if (Platform.OS === 'web') {
    await reauthenticateWithPopup(user, webProvider(id));
    return;
  }
  const native = id === 'google' ? await nativeGoogle()
    : id === 'apple' ? await nativeApple()
    : await nativeMicrosoft();
  await reauthenticateWithCredential(user, native.credential);
}

/**
 * Delete the account and everything tied to it: parking sessions and records,
 * sign photos and reports. Store rules require in-app account deletion.
 */
export async function deleteAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const uid = user.uid;
  const owned: Array<[string, string]> = [
    ['sessions', 'userId'],
    ['signReports', 'userId'],
    ['signPhotos', 'userId'],
  ];
  for (const [name, field] of owned) {
    const snap = await getDocs(query(collection(db, name), where(field, '==', uid)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => null)));
  }
  await deleteUser(user);
}
