interface Props {
  onClose: () => void;
}

export default function ChangelogPage({ onClose }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="term-panel border border-[var(--border-primary)] max-w-2xl w-full p-6 text-sm overflow-y-auto max-h-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--accent)] text-lg font-semibold tracking-wide glow">changelog — tchat 1.1</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 bg-transparent cursor-pointer hover:text-[var(--text-primary)] transition-colors"
          >
            close
          </button>
        </div>

        <div className="space-y-3 text-xs text-[var(--text-secondary)]">
          <div>
            <h3 className="text-[var(--accent)] font-semibold text-sm mb-1">new features</h3>
            <ul className="space-y-1 text-[var(--text-muted)]">
              <li>• Unread message tracking — a divider shows new messages when re-entering a room; persists across page reloads and dismisses once scrolled to the bottom.</li>
              <li>• General and important notifications — toast popups and per-room sidebar badges for all messages vs. @pings.</li>
              <li>• @mention autocomplete — type @ to see visible usernames; @everyone pings the entire room.</li>
              <li>• Reply pings — replying to someone automatically @mentions them.</li>
              <li>• Highlighted @pings — messages mentioning you get an accent border.</li>
              <li>• Day dividers — a subtle horizontal rule between messages sent on different days.</li>
              <li>• Desktop notifications — opt-in via settings for both general and important messages; clicking a notification jumps to the right room.</li>
              <li>• Notification settings — toggle general/important toasts, sidebar badges, and desktop notifications independently.</li>
              <li>• Mute rooms — right-click any room to suppress all notifications for it.</li>
              <li>• Password-protected room prompt — entering a hidden room shows an inline password form instead of a generic error.</li>
              <li>• Drag-and-drop room reordering (my rooms tab for all users, board tab for admins).</li>
              <li>• Drag room to top/bottom drop zones to move to the start or end of the list.</li>
              <li>• "Scroll to bottom" floating button when scrolled far up in chat.</li>
              <li>• Command palette — press backtick (`) for quick access to toggle sidebar, theme picker, notification settings, edit profile, and logout.</li>
              <li>• Theme picker overlay — preview themes live against the chat background.</li>
              <li>• Five reworked + two new themes (Forest, Ocean) with less saturated palettes.</li>
              <li>• Tutorial page (this!) and changelog page accessible from the sidebar.</li>
              <li>• Error dismiss buttons — X button on every persistent error banner.</li>
              <li>• Profile picture moved to sidebar footer next to username.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-[var(--accent)] font-semibold text-sm mb-1">improvements</h3>
            <ul className="space-y-1 text-[var(--text-muted)]">
              <li>• HTTPS/TLS support: set SSL_KEY_PATH and SSL_CERT_PATH for direct encrypted connections.</li>
              <li>• Slash commands now execute on Enter (were broken for /join, /leave, mod commands).</li>
              <li>• Moderation commands hidden from non-staff users in autocomplete.</li>
              <li>• @everyone double-@ bug fixed; @everyone ping detection fixed for messages starting with it.</li>
              <li>• Mute room context menu fix — clicks on "Mute room" now actually fire.</li>
              <li>• Board drag-and-drop reorder bug fixed (group ID comparison now correctly parses strings).</li>
              <li>• Password prompt disappears when clicking another room instead of persisting.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-[var(--accent)] font-semibold text-sm mb-1">code organization</h3>
            <ul className="space-y-1 text-[var(--text-muted)]">
              <li>• ChatPage split: extracted useNotifications, PasswordPrompt.</li>
              <li>• Sidebar split: extracted RoomButton, GroupHeader components.</li>
              <li>• Command permission filtering in MessageComposer.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}