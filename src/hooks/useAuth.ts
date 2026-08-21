import { useSyncExternalStore, useCallback } from "react";
import type { AuthUser } from "../types";
import {
  fetchMe,
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
} from "../services/api";

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

// Monotonic counter that lets us discard a stale initial /api/me result if a
// login/signup/logout finishes before that first check resolves. Without this,
// a slow pre-auth /api/me could return `null` and clobber a user who just
// logged in, silently bouncing them back to the login page.
let authVersion = 0;

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
  const versionAtStart = authVersion;
  fetchMe()
    .then((user) => {
      if (versionAtStart !== authVersion) return;
      set({ user, loading: false });
    })
    .catch(() => {
      if (versionAtStart !== authVersion) return;
      set({ user: null, loading: false });
    });
}

export function useAuth() {
  ensureInit();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(async (username: string, password: string) => {
    authVersion++;
    await apiLogin(username, password);
    // Confirm the session cookie was actually stored before trusting the
    // in-memory state — otherwise the user would be logged out on the next
    // request/reload with no explanation.
    const user = await fetchMe();
    if (!user) {
      set({ user: null, loading: false });
      throw new Error(
        "Logged in, but your session couldn't be saved. Check that cookies are enabled and the site is served over HTTPS."
      );
    }
    set({ user, loading: false });
    return user;
  }, []);

  const signup = useCallback(async (username: string, password: string) => {
    authVersion++;
    await apiSignup(username, password);
    // Verify the session was established; the account exists even if the
    // cookie was rejected, so point the user at login in that case.
    const user = await fetchMe();
    if (!user) {
      set({ user: null, loading: false });
      throw new Error(
        "Account created, but your session couldn't be saved. Try logging in — and check that cookies are enabled and the site is served over HTTPS."
      );
    }
    set({ user, loading: false });
    return user;
  }, []);

  const logout = useCallback(async () => {
    authVersion++;
    await apiLogout();
    set({ user: null, loading: false });
  }, []);

  // Re-read the current user from the server (e.g. after editing a profile).
  const refresh = useCallback(async () => {
    const user = await fetchMe();
    set({ user, loading: false });
    return user;
  }, []);

  return { ...snapshot, login, signup, logout, refresh };
}
