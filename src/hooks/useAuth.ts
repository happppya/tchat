/** Auth state: current user, login/signup/logout, persistence warning, and
 *  room-joining side effects shared across the app. */
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
  /**
   * Non-null when signed in but the session cookie could not be verified
   * (e.g. incognito blocks third-party cookies). The user stays signed in for
   * this page load; they'll be signed out again on reload/navigation.
   */
  persistWarning: string | null;
}

const PERSIST_WARNING =
  "Signed in, but this browser isn't keeping your session (cookies blocked). You may be signed out after a reload.";

let state: AuthState = {
  user: null,
  loading: true,
  persistWarning: null,
};
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

/**
 * Adopt the user returned by signup/login immediately, then check whether the
 * browser actually kept the session cookie. When it didn't (incognito blocks
 * third-party cookies, strict privacy settings), stay signed in for this page
 * load and surface a warning instead of dead-ending — the account/action
 * itself succeeded server-side.
 */
async function establishSession(
  kind: "signup" | "login",
  authenticate: () => Promise<AuthUser>
): Promise<AuthUser> {
  const user = await authenticate();

  let persisted = true;
  try {
    persisted = (await fetchMe()) != null;
  } catch {
    // Can't verify right now (network blip); don't punish a successful auth.
    persisted = true;
  }

  if (persisted) {
    set({ user, loading: false, persistWarning: null });
  } else {
    console.warn(
      `[auth] ${kind} succeeded but the session cookie was not persisted by this browser.`
    );
    set({ user, loading: false, persistWarning: PERSIST_WARNING });
  }
  return user;
}

export function useAuth() {
  ensureInit();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback(async (username: string, password: string) => {
    authVersion++;
    return establishSession("login", () => apiLogin(username, password));
  }, []);

  const signup = useCallback(async (username: string, password: string) => {
    authVersion++;
    return establishSession("signup", () => apiSignup(username, password));
  }, []);

  const logout = useCallback(async () => {
    authVersion++;
    await apiLogout();
    set({ user: null, loading: false, persistWarning: null });
  }, []);

  // Re-read the current user from the server (e.g. after editing a profile).
  const refresh = useCallback(async () => {
    const user = await fetchMe();
    set({ user, loading: false });
    return user;
  }, []);

  return { ...snapshot, login, signup, logout, refresh };
}
