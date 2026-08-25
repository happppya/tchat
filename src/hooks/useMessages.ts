import { useState, useCallback, useEffect, useRef } from "react";
import type { Message, WSMessage, GroupChat } from "../types";
import {
  fetchMessages,
  fetchGCInfo,
  editMessage as editMessageRequest,
  deleteMessage as deleteMessageRequest,
  reactToMessage as reactToMessageRequest,
  pinMessage as pinMessageRequest,
  unpinMessage as unpinMessageRequest,
} from "../services/api";
import type { Reaction } from "../types";
import { saveGC, getSavedGCs, getLastReadId, setLastReadId as persistLastReadId } from "../services/storage";
import { MESSAGES_PAGE_SIZE } from "../constants";

/**
 * Manages message loading and real-time updates for the current group chat.
 */
export function useMessages(groupChatId: number | null, forumPostId: number | null = null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [gcName, setGcName] = useState<string>("Group Chat");
  const [gcInfo, setGcInfo] = useState<GroupChat | null>(null);
  const [error, setError] = useState<string>("");
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** ID of the last message the user has "seen" — everything above is read. */
  const [lastReadId, setLastReadId] = useState(0);
  // Monotonic counter for room loads: only the most recently requested room's
  // response may be applied, so a slow fetch for room A can never render its
  // history under room B after the user switches rooms.
  const loadGenerationRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const loadMessages = useCallback(async (gcId: number) => {
    const generation = ++loadGenerationRef.current;
    setError("");

    try {
      const [msgs, info] = await Promise.all([
        fetchMessages(gcId, MESSAGES_PAGE_SIZE, null, forumPostId),
        fetchGCInfo(gcId),
      ]);
      if (generation !== loadGenerationRef.current) return; // stale load

      if ((info as { error?: string }).error) {
        setGcInfo(null);
        setError("Invalid Room!");
        return;
      }

      const pageCount = msgs.length;
      setMessages(msgs.reverse());
      setHasMore(pageCount >= MESSAGES_PAGE_SIZE);
      setGcInfo(info);
      setGcName(info.name || "Group Chat");

      // Auto-save to localStorage
      const saved = getSavedGCs();
      if (!saved.some((gc) => gc.id === gcId)) {
        saveGC(gcId, info.name || "Chat");
      }
    } catch {
      // A failed load must not clobber the room that is currently shown.
      if (generation !== loadGenerationRef.current) return;
      setGcInfo(null);
      setError("Failed to load messages");
    }
  }, []);

  /** Mark every loaded message as read — updates in-memory state only. */
  const markAllRead = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.id > 0) {
        setLastReadId(last.id);
      }
      return prev; // no mutation
    });
  }, []);

  // Reload when groupChatId changes. Persist read-position on leave.
  useEffect(() => {
    if (groupChatId !== null) {
      // Restore the persisted last-read position for this room, so the
      // unread bar survives page reloads.
      setLastReadId(getLastReadId(groupChatId));
      loadMessages(groupChatId);
    } else {
      setMessages([]);
      setGcName("Group Chat");
      setGcInfo(null);
      setHasMore(true);
      setError("");
      setLastReadId(0);
    }

    // When leaving a room, persist how far the user read so the unread
    // bar picks up from the right spot next time they open the room.
    return () => {
      const last = messagesRef.current[messagesRef.current.length - 1];
      if (last && last.id > 0 && groupChatId !== null) {
        persistLastReadId(groupChatId, last.id);
      }
    };
  }, [groupChatId, forumPostId, loadMessages]);

  /**
   * Fetch the page strictly older than the oldest loaded message and prepend
   * it, so the chat can page backward through history.
   */
  const loadOlder = useCallback(async () => {
    if (groupChatId === null || loadingOlderRef.current) return;
    const oldest = messages[0];
    if (!oldest) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await fetchMessages(groupChatId, MESSAGES_PAGE_SIZE, {
        sentAt: oldest.sent_at,
        id: oldest.id,
      }, forumPostId);
      if (older.length === 0) {
        setHasMore(false);
      } else {
        setMessages((prev) => [...[...older].reverse(), ...prev]);
        setHasMore(older.length >= MESSAGES_PAGE_SIZE);
      }
    } catch {
      // Keep what we have; the user can try scrolling up again.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [groupChatId, forumPostId, messages]);

  const tempIdRef = useRef(0);

  /**
   * Update the body + edited marker of a message (called after an HTTP edit
   * succeeds, and also echoed for other clients via the WebSocket).
   */
  const applyEdit = useCallback((messageId: number, text: string, editedAt: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, message_text: text, edited_at: editedAt }
          : m
      )
    );
  }, []);

  /** Remove a deleted message from the live list. */
  const applyDelete = useCallback((messageId: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  /** Replace a message's reaction aggregate (live or after a toggle). */
  const applyReactions = useCallback((messageId: number, reactions: Reaction[]) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
    );
  }, []);

  /** Handle an incoming WebSocket message — append/update/remove for this GC */
  const handleWSMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.groupChatId !== groupChatId) return;
      // Filter by forumPostId: only accept messages scoped to the same thread.
      if ((msg.forumPostId ?? null) !== (forumPostId ?? null)) return;

      if (msg.type === "editMessage" && msg.messageId !== undefined) {
        applyEdit(msg.messageId, msg.messageText ?? "", msg.editedAt ?? "");
        return;
      }
      if (msg.type === "deleteMessage" && msg.messageId !== undefined) {
        applyDelete(msg.messageId);
        return;
      }
      if (msg.type === "messageReactions" && msg.messageId !== undefined) {
        applyReactions(msg.messageId, msg.reactions ?? []);
        return;
      }
      if (msg.type === "renameRoom" && msg.groupChatId === groupChatId) {
        if (msg.name) setGcName(msg.name);
        return;
      }
      if (msg.type === "pinMessage" && msg.messageId !== undefined) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.messageId ? { ...m, pinned: 1 } : m))
        );
        return;
      }
      if (msg.type === "unpinMessage" && msg.messageId !== undefined) {
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.messageId ? { ...m, pinned: 0 } : m))
        );
        return;
      }
      if (msg.type !== "message") return;

      const newMsg: Message = {
        // The server echoes the real DB id; fall back to a negative placeholder
        // only if an id is missing (never for normal sends).
        id: msg.id ?? tempIdRef.current--,
        group_chat_id: msg.groupChatId,
        display_name: msg.displayNameText ?? null,
        speaker: msg.speaker ?? null,
        username: msg.username ?? null,
        message_text: msg.messageText ?? null,
        gif_url: msg.gifUrl ?? null,
        avatar_url: msg.avatarUrl ?? null,
        file_url: msg.fileUrl ?? null,
        file_name: msg.fileName ?? null,
        file_type: msg.fileType ?? null,
        user_id: msg.userId ?? null,
        reply_to_id: msg.replyToId ?? null,
        reply_quote: msg.replyQuote ?? null,
        reply_author: msg.replyAuthor ?? null,
        reactions: [],
        pinned: null,
        forum_post_id: msg.forumPostId ?? null,
        sent_at: msg.timestamp ?? new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);
      setError("");
    },
    [groupChatId, forumPostId, applyEdit, applyDelete, applyReactions]
  );

  /** Edit one of your own messages, then reflect the change locally. */
  const editMessage = useCallback(async (messageId: number, text: string) => {
    const updated = await editMessageRequest(messageId, text);
    applyEdit(messageId, updated.message_text ?? "", updated.edited_at ?? "");
  }, [applyEdit]);

  /** Delete one of your own messages, then remove it locally. */
  const deleteMessage = useCallback(async (messageId: number) => {
    await deleteMessageRequest(messageId);
    applyDelete(messageId);
  }, [applyDelete]);

  /** Toggle a reaction, then reflect the updated aggregate locally. */
  const toggleReaction = useCallback(async (messageId: number, emoji: string) => {
    const reactions = await reactToMessageRequest(messageId, emoji);
    applyReactions(messageId, reactions);
  }, [applyReactions]);

  /** Pin a message (staff only), reflect locally. */
  const pinMessage = useCallback(async (messageId: number) => {
    await pinMessageRequest(messageId);
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, pinned: 1 } : m))
    );
  }, []);

  /** Unpin a message (staff only), reflect locally. */
  const unpinMessage = useCallback(async (messageId: number) => {
    await unpinMessageRequest(messageId);
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, pinned: 0 } : m))
    );
  }, []);

  return {
    messages,
    gcName,
    gcInfo,
    error,
    hasMore,
    loadingOlder,
    loadOlder,
    setGcName,
    loadMessages,
    handleWSMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    pinMessage,
    unpinMessage,
    lastReadId,
    markAllRead,
  };
}