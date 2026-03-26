/**
 * SessionContext — single shared session state across all tabs.
 *
 * Without this, each screen calling useSession() creates its own
 * Firebase subscription + local state, meaning tab switches cause
 * the session bar to flash away and re-appear.
 */
import React, { createContext, useContext } from 'react';
import { useSession } from '../_hooks/useSession';

type SessionContextType = ReturnType<typeof useSession>;

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}
