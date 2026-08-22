import { useState, useCallback, useEffect, useRef } from "react";
import type { Message, WSMessage, GroupChat } from "../types";
import {
  fetchMessages,
  fetchGCInfo,
  editMessage as editMessageRequest,
  deleteMessage as deleteMessageRequest,
  reactToMessage as reactToMessageRequest,
} from "../services/api";
import type { Reaction } from "../types";
import { saveGC, getSavedGCs } from "../services/storage";
import { MESSAGES_PAGE_SIZE } from "../constants";

/**
 * Manages message loading and real-time updates for the current group chat.
 */
export function useMessages(groupChatId: number | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [gcName, setGcName] = useState<string>("Group Chat");
  const [gcInfo, setGcInfo] = useState<GroupChat | null>(null);
  const [error, setError] = useState<string>("");
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Monotonic counter for room loads: only the most recently requested room's
  // response may be applied, so a slow fetch for room A can never render its
  // history under room B after the user switches rooms.
  const loadGenerationRef = useRef(0);
  const loadingOlderRef = useRef(false);

  const loadMessages = useCallback(async (gcId: number) => {
    const generation = ++loadGenerationRef.current;
    setError("");

    try {
      const [msgs, info] = await Promise.all([
        fetchMessages(gcId),
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

  // Reload when groupChatId changes
  useEffect(() => {
    if (groupChatId) {
      loadMessages(groupChatId);
    } else {
      setMessages([]);
      setGcName("Group Chat");
      setGcInfo(null);
      setHasMore(true);
      setError("");
    }
  }, [groupChatId, loadMessages]);

  /**
   * Fetch the page strictly older than the oldest loaded message and prepend
   * it, so the chat can page backward through history.
   */
  const loadOlder = useCallback(async () => {
    if (!groupChatId || loadingOlderRef.current) return;
    const oldest = messages[0];
    if (!oldest) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await fetchMessages(groupChatId, MESSAGES_PAGE_SIZE, {
        sentAt: oldest.sent_at,
        id: oldest.id,
      });
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
  }, [groupChatId, messages]);

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
      if (msg.type !== "message") return;

      const newMsg: Message = {
        // The server echoes the real DB id; fall back to a negative placeholder
        // only if an id is missing (never for normal sends).
        id: msg.id ?? tempIdRef.current--,
        group_chat_id: msg.groupChatId,
        display_name: msg.displayNameText ?? null,
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
        sent_at: msg.timestamp ?? new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);
      setError("");
    },
    [groupChatId, applyEdit, applyDelete, applyReactions]
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
  };
}