/**
 * AuthContext — who is signed in. Anonymous users count as "no account" in the
 * UI; their uid still owns their sessions until they create an account.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../_services/firebase';
import { AccountInfo, accountInfo } from '../_services/auth';

interface AuthContextType {
  /** Null while loading or for a signed-out (anonymous) user */
  account: AccountInfo | null;
  /** Firebase uid, anonymous or not */
  uid: string | null;
  /** Re-read the user after a profile change or email verification */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  account: null,
  uid: null,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);

  useEffect(() => onAuthStateChanged(auth, user => setInfo(user ? accountInfo(user) : null)), []);

  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { setInfo(null); return; }
    await user.reload().catch(() => null);
    setInfo(accountInfo(auth.currentUser ?? user));
  }, []);

  const account = info && !info.isAnonymous ? info : null;
  return (
    <AuthContext.Provider value={{ account, uid: info?.uid ?? null, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}
