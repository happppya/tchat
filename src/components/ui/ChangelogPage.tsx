/** Static changelog content rendered in the chat content area. */
interface Props {
  onClose: () => void;
}

export default function ChangelogPage({ onClose }: Props) {
  return (
    <div className="flex-1 min-w-0 flex items-center justify-center p-4">
      <div className="term-panel border border-[var(--border-primary)] max-w-2xl w-full p-6 text-sm overflow-y-auto max-h-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--accent)] text-lg font-semibold tracking-wide glow">changelog</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 bg-transparent cursor-pointer hover:text-[var(--text-primary)] transition-colors"
          >
            close
          </button>
        </div>

        <div className="space-y-6 text-xs text-[var(--text-secondary)]">
          {/* ── tchat 1.2 ──────────────────────────────────────────────── */}
          <div>
            <h3 className="text-[var(--accent)] font-semibold text-sm mb-1 border-b border-[var(--border-primary)] pb-1">tchat 1.2</h3>
            <div className="space-y-3 mt-2">
              <div>
                <h4 className="text-[var(--accent-light)] font-semibold mb-1">new features</h4>
                <ul className="space-y-1 text-[var(--text-muted)]">
                  <li>• Forum rooms — a new room type for threaded discussion. The forum page shows a search bar with fuzzy filtering, sort controls (recently active / date posted / alphabetical), and a scrollable post list. Click any post to open its thread with a full embedded chat underneath.</li>
                  <li>• Forum post creation — type a title in the search bar and click "new post" to enter compose mode with a content textarea. Posts support the full markdown renderer.</li>
                  <li>• Forum post edit and delete — the post author, room owner, mods, and admins can edit titles and content inline or delete a post along with all its replies. 512-post cap per forum room.</li>
                  <li>• Forum post count — the forum header shows the current post count alongside the room name so you can gauge activity at a glance.</li>
                  <li>• Pinned messages — room owners, mods, and admins can pin any message via a 📌 button in the hover actions. Pinned messages get a subtle accent background and border. A pin icon in the room header opens a popover listing every pinned message; click one to jump directly to it.</li>
                  <li>• Custom formatting tags — embed HTML-like tags in messages for rich formatting: <code>&lt;big&gt;</code>, <code>&lt;small&gt;</code>, <code>&lt;subtitle&gt;</code>, <code>&lt;header&gt;</code>, <code>&lt;h1&gt;</code>–<code>&lt;h3&gt;</code>, <code>&lt;warn&gt;</code>, <code>&lt;error&gt;</code>, <code>&lt;success&gt;</code>, <code>&lt;info&gt;</code>, <code>&lt;quote&gt;</code>, <code>&lt;center&gt;</code>, <code>&lt;rainbow&gt;</code> (animated gradient), <code>&lt;spoiler&gt;</code> (click to reveal), <code>&lt;mono&gt;</code>, <code>&lt;highlight&gt;</code>, and <code>&lt;strike&gt;</code>.</li>
                  <li>• Horizontal rules — type <code>---</code> on its own line or <code>&lt;hr/&gt;</code> to insert a clean divider between message sections.</li>
                  <li>• Tags support nested markdown — you can use <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, and links inside any custom tag.</li>
                </ul>
              </div>

              <div>
                <h4 className="text-[var(--accent-light)] font-semibold mb-1">improvements</h4>
                <ul className="space-y-1 text-[var(--text-muted)]">
                  <li>• Day dividers fixed — groups now correctly split at midnight even when messages from the same author are within the merge window. Fragment keys prevent dividers from drifting after prepending older messages.</li>
                  <li>• 23 new unit tests covering every formatting tag, nested markdown, horizontal rules, and XSS safety regressions.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ── tchat 1.1 ──────────────────────────────────────────────── */}
          <div>
            <h3 className="text-[var(--accent)] font-semibold text-sm mb-1 border-b border-[var(--border-primary)] pb-1">tchat 1.1</h3>
            <div className="space-y-3 mt-2">
              <div>
                <h4 className="text-[var(--accent-light)] font-semibold mb-1">new features</h4>
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
                <h4 className="text-[var(--accent-light)] font-semibold mb-1">improvements</h4>
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
                <h4 className="text-[var(--accent-light)] font-semibold mb-1">code organization</h4>
                <ul className="space-y-1 text-[var(--text-muted)]">
                  <li>• ChatPage split: extracted useNotifications, PasswordPrompt.</li>
                  <li>• Sidebar split: extracted RoomButton, GroupHeader components.</li>
                  <li>• Command permission filtering in MessageComposer.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}