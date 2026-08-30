/** Authenticated user returned by /api/signup, /api/login, /api/me */
export interface AuthUser {
  id: number;
  username: string;
  isAdmin?: boolean;
  bio?: string | null;
  picture_url?: string | null;
}

/** Public profile returned by /api/profile/:username */
export interface UserProfile {
  username: string;
  bio: string | null;
  picture_url: string | null;
  isAdmin?: boolean;
  isRoomOwner?: boolean;
}
