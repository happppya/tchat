/** User profile modal: shows avatar, bio, and admin flags; lets the user edit
 *  their own bio/picture. */
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { getProfile, updateProfile } from "../../services/api";
import type { UserProfile } from "../../types";
import Avatar from "../chat/Avatar";

interface Props {
  /** Username to display. Null hides the modal. */
  username: string | null;
  /** When true and viewing yourself, start in edit mode. */
  initialEditing?: boolean;
  /** Current room id, for displaying owner/admin badges. */
  activeGCId?: number | null;
  onClose: () => void;
}

/**
 * Shows a user's public profile (username, picture, bio). When it's your own
 * profile, you can switch into edit mode to change the bio and picture.
 */
export default function ProfileModal({
  username,
  initialEditing = false,
  activeGCId,
  onClose,
}: Props) {
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSelf = !!user && !!username && user.username === username;

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    setProfile(null);
    setError("");
    getProfile(username, activeGCId)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setBio(p.bio ?? "");
        setPictureUrl(p.picture_url ?? "");
        setEditing(initialEditing && isSelf);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load profile");
      });
    return () => {
      cancelled = true;
    };
  }, [username, activeGCId, initialEditing, isSelf]);

  if (!username) return null;

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      const updated = await updateProfile(bio, pictureUrl);
      await refresh();
      setProfile({
        username: updated.username,
        bio: updated.bio ?? null,
        picture_url: updated.picture_url ?? null,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      data-testid="profile-modal"
    >
      <div
        className="term-panel w-[420px] max-w-[92vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
          <span className="text-[var(--accent)] text-sm">~ profile</span>
          <button
            onClick={onClose}
            data-testid="profile-close-button"
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-0.5 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            [ close ]
          </button>
        </div>

        {error && (
          <div className="px-3 py-1.5 text-[var(--error)] text-xs">err: {error}</div>
        )}

        {!profile && !error && (
          <div className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
            $ loading…
          </div>
        )}

        {/* View mode */}
        {profile && !editing && (
          <div className="px-3 py-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={profile.username} src={profile.picture_url} size={56} />
              <div>
                <div className="flex items-center gap-2">
                  <div
                    data-testid="profile-username"
                    className="text-[var(--text-primary)] text-sm"
                  >
                    {profile.username}
                  </div>
                  {profile.isAdmin && (
                    <span className="text-[10px] border px-1 py-0.5 border-[var(--error)] text-[var(--error)]">
                      ADMIN
                    </span>
                  )}
                  {profile.isRoomOwner && (
                    <span className="text-[10px] border px-1 py-0.5 border-[var(--accent)] text-[var(--accent)]">
                      OWNER
                    </span>
                  )}
                </div>
                <div className="text-[var(--text-muted)] text-[10px] uppercase tracking-widest">
                  bio
                </div>
              </div>
            </div>
            <div
              data-testid="profile-bio"
              className="text-[var(--text-secondary)] text-sm whitespace-pre-wrap wrap-anywhere min-w-0"
            >
              {profile.bio || "no bio yet"}
            </div>
            {isSelf && (
              <button
                onClick={() => setEditing(true)}
                data-testid="profile-edit-button"
                className="self-start text-[var(--accent)] text-xs border border-[var(--accent)] px-2 py-1 hover:bg-[var(--accent)]/10 transition-colors cursor-pointer"
              >
                [ edit ]
              </button>
            )}
          </div>
        )}

        {/* Edit mode */}
        {profile && editing && (
          <div className="px-3 py-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <Avatar name={profile.username} src={pictureUrl || null} size={56} />
              <span
                data-testid="profile-username"
                className="text-[var(--text-primary)] text-sm"
              >
                {profile.username}
              </span>
            </div>
            <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
              picture url
            </label>
            <input
              type="text"
              value={pictureUrl}
              onChange={(e) => setPictureUrl(e.target.value)}
              placeholder="https://… or data:image/… (optional)"
              data-testid="profile-picture-input"
              className="w-full px-2 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
            <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
              bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="tell people about yourself"
              data-testid="profile-bio-input"
              className="w-full px-2 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm leading-snug resize-none outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={busy}
                data-testid="profile-save-button"
                className="text-[var(--accent)] text-xs border border-[var(--accent)] px-2 py-1 hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {busy ? "[ saving… ]" : "[ save ]"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                [ cancel ]
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
