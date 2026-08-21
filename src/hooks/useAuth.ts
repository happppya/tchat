import { useSyncExternalStore, useCallback } from "react";
import type { AuthUser } from "../types";
import { fetchMe, login as apiLogin, signup as apiSignup, logout as apiLogout } from "../services/api";

/**
 * Global auth state, shared across components via an external store so route
 * guards and the sidebar/palette can all read the current user without prop
 * drilling.
 */
interface AuthState {
  user: AuthUser | null;
  loading: boolean; // true during the initial /api/me check
}

let state: AuthState = { user: null, loading: true };
const listeners = new Set<() => void>();

function set(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function getSnapshot(): AuthState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Kick off the initial session check once on module load so the very first
// render isn't blocked — components read `loading` until it resolves.
let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;
  fetchMe()
    .then((user) => set({ user, loading: false }))
    .catch(() => set({ user: null, loading: false }));
}

export function useAuth() {
  ensureInit();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(async (username: string, password: string) => {
    const user = await apiLogin(username, password);
    set({ user, loading: false });
    return user;
  }, []);

  const signup = useCallback(async (username: string, password: string) => {
    const user = await apiSignup(username, password);
    set({ user, loading: false });
    return user;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    set({ user: null, loading: false });
  }, []);

  return { ...snapshot, login, signup, logout };
}
