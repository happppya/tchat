import { useState, useCallback, useRef } from "react";
import {
  incrementRoomNotif,
  resetRoomNotif,
  getAllNotifCounts,
  getNotifSettings,
  saveNotifSettings,
  getMutedRooms,
  toggleMuteRoom,
} from "../services/storage";
import type { RoomNotifMap, NotifSettings } from "../services/storage";
import type { Notification } from "../components/NotificationToast";
import type { WSMessage } from "../types";

/**
 * Manages desktop notifications, toast notifications, per-room unread
 * notification counts, mute state, and notification settings.
 */
export function useNotifications(
  activeGCId: number | null,
  userId: number | null
) {
  // Notification toasts.
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifIdRef = useRef(0);

  // Track "my display name" per room from echoed messages, for ping detection.
  const myDisplayNames = useRef<Map<number, string>>(new Map());

  // Notification settings (persisted toggles).
  const [notifSettings, setNotifSettings] = useState<NotifSettings>(getNotifSettings);

  // Per-room unread notification counts (for sidebar badges).
  const [roomNotifs, setRoomNotifs] = useState<RoomNotifMap>(getAllNotifCounts);
  // Keep a ref so the WS handler can read + increment without stale closures.
  const roomNotifsRef = useRef(roomNotifs);
  roomNotifsRef.current = roomNotifs;

  // Muted rooms — suppress all notifications for these rooms.
  const [mutedRooms, setMutedRooms] = useState<Set<number>>(getMutedRooms);
  const mutedRoomsRef = useRef(mutedRooms);
  mutedRoomsRef.current = mutedRooms;

  const notifSettingsRef = useRef(notifSettings);
  notifSettingsRef.current = notifSettings;

  // Ref for switching rooms from a desktop notification onclick handler.
  const selectGcRef = useRef<(id: number) => void>(() => {});

  const handleToggleMute = useCallback((gcId: number) => {
    setMutedRooms(toggleMuteRoom(gcId));
  }, []);

  const saveSettings = useCallback((s: NotifSettings) => {
    saveNotifSettings(s);
    setNotifSettings(s);
  }, []);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback(
    (
      roomId: number,
      roomName: string,
      author: string,
      body: string,
      important: boolean
    ) => {
      const id = ++notifIdRef.current;
      setNotifications((prev) => [
        ...prev,
        { id, roomName, roomId, author, body, important },
      ]);
    },
    []
  );

  /** Reset notification counters for a room when the user opens it. */
  const clearRoomNotifs = useCallback((gcId: number) => {
    resetRoomNotif(gcId);
    setRoomNotifs((prev) => {
      const next = { ...prev };
      delete next[gcId];
      return next;
    });
  }, []);

  /**
   * Process a WS message for notification purposes: updates display-name
   * tracking, increments per-room notif counters, fires toast/desktop
   * notifications for background-room messages. Returns the ping status.
   */
  type NotifResult = { isPing: boolean };

  const handleWSNotifications = useCallback(
    (
      msg: WSMessage,
      isPingForMe: (gcId: number, text: string | null | undefined) => boolean
    ): NotifResult | null => {
      // Track "my display name" from echoed messages (same userId).
      if (
        msg.type === "message" &&
        msg.userId != null &&
        userId != null &&
        msg.userId === userId &&
        msg.displayNameText
      ) {
        myDisplayNames.current.set(msg.groupChatId, msg.displayNameText);
      }

      // Notifications for messages in background rooms.
      if (
        msg.type !== "message" ||
        msg.groupChatId === activeGCId ||
        !msg.displayNameText ||
        mutedRoomsRef.current.has(msg.groupChatId)
      ) {
        return null;
      }

      const body = msg.messageText
        ? msg.messageText
        : msg.gifUrl
          ? "[GIF]"
          : msg.fileName
            ? `[${msg.fileName}]`
            : "";

      const ping = isPingForMe(msg.groupChatId, msg.messageText);

      // Increment persistent per-room counter for sidebar badges.
      const counts = incrementRoomNotif(msg.groupChatId, ping);
      setRoomNotifs((prev) => ({ ...prev, [msg.groupChatId]: counts }));

      // Gate toast display on settings.
      const settings = notifSettingsRef.current;
      const toastAllowed = ping ? settings.importantToasts : settings.generalToasts;
      if (toastAllowed) {
        const roomName = `#${msg.groupChatId}`;
        addNotification(
          msg.groupChatId,
          roomName,
          msg.displayNameText,
          body.slice(0, 80),
          ping
        );
      }

      // Desktop notifications (off by default).
      const desktopAllowed = ping
        ? settings.desktopImportant
        : settings.desktopGeneral;
      if (
        desktopAllowed &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const notif = new Notification(
          `${msg.displayNameText} — #${msg.groupChatId}`,
          {
            body: body.slice(0, 120),
            icon: msg.avatarUrl ?? undefined,
            tag: `gc-${msg.groupChatId}`,
          }
        );
        notif.onclick = () => {
          window.focus();
          selectGcRef.current(msg.groupChatId);
          notif.close();
        };
      }

      return { isPing: ping };
    },
    [activeGCId, userId, addNotification]
  );

  return {
    notifications,
    notifSettings,
    roomNotifs,
    mutedRooms,
    myDisplayNames,
    selectGcRef,
    dismissNotification,
    addNotification,
    clearRoomNotifs,
    saveSettings,
    handleToggleMute,
    handleWSNotifications,
  };
}