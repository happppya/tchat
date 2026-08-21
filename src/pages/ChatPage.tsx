import { useState, useCallback } from "react";
import { useMessages } from "../hooks/useMessages";
import { useWebSocket } from "../hooks/useWebSocket";
import { getDisplayName } from "../services/storage";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import type { WSMessage } from "../types";

export default function ChatPage() {
  const [activeGCId, setActiveGCId] = useState<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const { messages, gcName, error, handleWSMessage } = useMessages(activeGCId);

  // Wire WebSocket
  const handleWSIncoming = useCallback(
    (msg: WSMessage) => {
      if (msg.type === "error") {
        console.error("Server error:", msg.messageText);
        return;
      }
      handleWSMessage(msg);
    },
    [handleWSMessage]
  );

  const { send } = useWebSocket(handleWSIncoming);

  const handleSendMessage = useCallback(
    (text: string, gifUrl: string | null) => {
      if (!activeGCId) return;
      const displayName = getDisplayName();

      send(
        JSON.stringify({
          type: "message",
          groupChatId: activeGCId,
          messageText: text,
          displayNameText: displayName,
          gifUrl,
        })
      );
    },
    [activeGCId, send]
  );

  const handleSelectGC = useCallback((id: number) => {
    setActiveGCId(id);
    // On mobile, auto-close sidebar
    if (window.innerWidth < 768) {
      setSidebarVisible(false);
    }
  }, []);

  if (!activeGCId) {
    return (
      <div className="flex h-full">
        <Sidebar
          activeGCId={null}
          onSelectGC={handleSelectGC}
          className={sidebarVisible ? "w-[250px]" : "hidden"}
        />
        <button
          onClick={() => setSidebarVisible((v) => !v)}
          className="h-[50px] w-[50px] text-3xl text-[var(--text-secondary)] border-none bg-transparent cursor-pointer m-1 flex-shrink-0"
        >
          ☰
        </button>
        <div className="flex-1 flex items-center justify-center flex-col text-[var(--text-muted)] opacity-40 text-sm">
          <h1 className="text-lg font-normal">
            Select a Group Chat to start messaging...
          </h1>
          <h2 className="text-sm mt-1">(main gc: 1234)</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar
        activeGCId={activeGCId}
        onSelectGC={handleSelectGC}
        className={sidebarVisible ? "w-[250px]" : "hidden"}
      />
      <button
        onClick={() => setSidebarVisible((v) => !v)}
        className="h-[50px] w-[50px] text-3xl text-[var(--text-secondary)] border-none bg-transparent cursor-pointer m-1 flex-shrink-0"
      >
        ☰
      </button>
      <ChatWindow
        messages={messages}
        gcName={gcName}
        gcInfo={null}
        error={error}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
}