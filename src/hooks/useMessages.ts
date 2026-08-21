import { useState, useCallback, useEffect, useRef } from "react";
import type { Message, WSMessage, GroupChat } from "../types";
import { fetchMessages, fetchGCInfo } from "../services/api";
import { saveGC, getSavedGCs } from "../services/storage";

/**
 * Manages message loading and real-time updates for the current group chat.
 */
export function useMessages(groupChatId: number | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [gcName, setGcName] = useState<string>("Group Chat");
  const [gcInfo, setGcInfo] = useState<GroupChat | null>(null);
  const [error, setError] = useState<string>("");
  const loadingRef = useRef(false);

  const loadMessages = useCallback(async (gcId: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");

    try {
      const [msgs, info] = await Promise.all([
        fetchMessages(gcId),
        fetchGCInfo(gcId),
      ]);

      if ((info as { error?: string }).error) {
        setGcInfo(null);
        setError("Invalid Room!");
        return;
      }

      setMessages(msgs.reverse());
      setGcInfo(info);
      setGcName(info.name || "Group Chat");

      // Auto-save to localStorage
      const saved = getSavedGCs();
      if (!saved.some((gc) => gc.id === gcId)) {
        saveGC(gcId, info.name || "Chat");
      }
    } catch {
      setGcInfo(null);
      setError("Failed to load messages");
    } finally {
      loadingRef.current = false;
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
      setError("");
    }
  }, [groupChatId, loadMessages]);

  const tempIdRef = useRef(0);

  /** Handle an incoming WebSocket message — append if it's for this GC */
  const handleWSMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type !== "message") return;
      if (msg.groupChatId !== groupChatId) return;

      const newMsg: Message = {
        id: tempIdRef.current--, // stable unique negative ids; DB ids are positive
        group_chat_id: msg.groupChatId,
        display_name: msg.displayNameText ?? null,
        message_text: msg.messageText ?? null,
        gif_url: msg.gifUrl ?? null,
        sent_at: msg.timestamp ?? new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);
      setError("");
    },
    [groupChatId]
  );

  return { messages, gcName, gcInfo, error, setGcName, loadMessages, handleWSMessage };
}