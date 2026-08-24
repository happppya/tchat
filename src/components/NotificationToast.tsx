import { useEffect, useState } from "react";

export interface Notification {
  id: number;
  /** Room name where the message was sent. */
  roomName: string;
  /** Room id for navigation. */
  roomId: number;
  /** The display name of the sender. */
  author: string;
  /** Snippet of the message body. */
  body: string;
  /** True for @ping notifications; false for general background-message alerts. */
  important: boolean;
}

interface Props {
  notification: Notification;
  /** Clicking the toast navigates to the room. */
  onNavigate: (roomId: number) => void;
  /** Remove this toast after it expires. */
  onDismiss: (id: number) => void;
}

const GENERAL_DURATION = 4_000;
const IMPORTANT_DURATION = 8_000;

export default function NotificationToast({
  notification,
  onNavigate,
  onDismiss,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame.
    const raf = requestAnimationFrame(() => setVisible(true));

    const duration = notification.important
      ? IMPORTANT_DURATION
      : GENERAL_DURATION;
    const timer = setTimeout(() => {
      setVisible(false);
      // Let the exit animation play before removing.
      setTimeout(() => onDismiss(notification.id), 300);
    }, duration);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [notification.id, notification.important, onDismiss]);

  const handleClick = () => {
    onNavigate(notification.roomId);
    onDismiss(notification.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
      data-testid={
        notification.important ? "important-notification" : "general-notification"
      }
      className={`cursor-pointer max-w-[320px] border px-3 py-2 text-xs transition-all duration-300 ${
        visible
          ? "opacity-100 translate-x-0"
          : "opacity-0 translate-x-4"
      } ${
        notification.important
          ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-[var(--accent-light)]"
          : "border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[120px]">
          {notification.roomName}
        </span>
        {notification.important && (
          <span className="text-[10px] border border-[var(--accent)]/60 px-1 py-0 text-[var(--accent)] uppercase">
            ping
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[var(--accent)] glow font-semibold shrink-0">
          {notification.author}:
        </span>
        <span className="truncate opacity-80">{notification.body}</span>
      </div>
    </div>
  );
}