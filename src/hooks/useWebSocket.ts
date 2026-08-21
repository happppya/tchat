import { useEffect, useRef, useCallback } from "react";
import type { WSMessage } from "../types";

type MessageHandler = (msg: WSMessage) => void;

const PING_INTERVAL = 30_000;

/**
 * Manages a WebSocket connection to the server.
 * Automatically reconnects, sends pings, and dispatches parsed messages.
 */
export function useWebSocket(onMessage: MessageHandler) {
  const socketRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const send = useCallback((data: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(data);
    }
  }, []);

  useEffect(() => {
    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        console.log("WebSocket connected");

        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL);
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          onMessageRef.current(msg);
        } catch {
          console.error("Failed to parse WebSocket message:", event.data);
        }
      });

      ws.addEventListener("close", () => {
        console.log("WebSocket disconnected, reconnecting in 3s…");
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        setTimeout(connect, 3000);
      });
    }

    connect();

    return () => {
      socketRef.current?.close();
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
      }
    };
  }, []);

  return { send };
}