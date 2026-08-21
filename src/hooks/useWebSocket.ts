import { useEffect, useRef, useCallback } from "react";
import type { WSMessage } from "../types";

type MessageHandler = (msg: WSMessage) => void;

const PING_INTERVAL = 30_000;
const RECONNECT_DELAY = 3_000;

/**
 * Manages a single, stable WebSocket connection to the server.
 *
 * Guarantees that at most one socket is ever alive, even across React
 * StrictMode double-mounts or rapid re-renders. A reconnecting socket that is
 * closed before it finishes opening (the StrictMode mount/unmount/remount
 * dance, or a transient network blip) is cleaned up without emitting spurious
 * errors or duplicate connections. Incoming broadcasts are therefore delivered
 * exactly once.
 */
export function useWebSocket(onMessage: MessageHandler) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const socketRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((data: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(data);
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    function clearTimers() {
      if (pingTimerRef.current !== null) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    // Close the tracked socket (if any) and forget it. We deliberately swallow
    // the error/close events that closing a still-CONNECTING socket produces:
    // those are not real connection failures, just teardown noise.
    function closeActiveSocket() {
      clearTimers();
      const ws = socketRef.current;
      if (ws === null) return;
      socketRef.current = null;
      // Remove our listeners so closing a CONNECTING socket doesn't log a
      // "closed before the connection is established" warning or trigger a
      // reconnect. The close handler is what schedules reconnects.
      try {
        ws.close();
      } catch {
        // close() can throw if the socket is in an unexpected state; ignore.
      }
    }

    function connect() {
      if (disposed) return;

      // Never open a second socket while one is already alive or connecting.
      if (
        socketRef.current !== null &&
        socketRef.current.readyState !== WebSocket.CLOSED
      ) {
        return;
      }

      closeActiveSocket();

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (disposed || socketRef.current !== ws) {
          // Stale socket (replaced/unmounted during handshake): drop it.
          ws.close();
          return;
        }

        clearTimers();
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL);
      });

      ws.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== ws) return;
        try {
          const msg: WSMessage = JSON.parse(event.data);
          onMessageRef.current(msg);
        } catch {
          console.error("Failed to parse WebSocket message:", event.data);
        }
      });

      ws.addEventListener("close", () => {
        if (socketRef.current !== ws) {
          // This close is from a stale/abandoned socket — don't touch shared
          // state and don't schedule a reconnect.
          return;
        }
        clearTimers();
        socketRef.current = null;

        if (!disposed) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      });

      ws.addEventListener("error", () => {
        // Errors precede a close event; the close handler does all cleanup.
      });
    }

    connect();

    return () => {
      disposed = true;
      closeActiveSocket();
    };
  }, []);

  return { send };
}
