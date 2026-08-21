import { useRef, useEffect } from "react";
import type { Message, GroupChat } from "../types";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";

interface Props {
  messages: Message[];
  gcInfo: GroupChat | null;
  gcName: string;
  error: string;
  onSendMessage: (text: string, gifUrl: string | null) => void;
}

export default function ChatWindow({
  messages,
  gcName,
  error,
  onSendMessage,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col flex-1 m-2 ml-0 min-h-0">
      {/* Header */}
      <div className="flex items-center mb-2">
        <h1 className="flex-1 text-[22px] font-semibold text-[var(--text-primary)] px-2.5">
          {gcName}
        </h1>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm mb-2">
          {error}
        </div>
      )}

      {/* Messages — oldest at top, newest at bottom */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto flex flex-col gap-2 py-2"
        data-testid="message-list"
      >
        {messages.length === 0 && !error && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] opacity-40 text-sm">
            No messages yet. Say something!
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <MessageComposer onSend={onSendMessage} />
    </div>
  );
}