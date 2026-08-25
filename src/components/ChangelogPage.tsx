interface Props {
  onClose: () => void;
}

export default function ChangelogPage({ onClose }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="term-panel border border-[var(--border-primary)] max-w-2xl w-full p-6 text-sm overflow-y-auto max-h-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--accent)] text-lg font-semibold tracking-wide glow">changelog — tchat 1.2</h2>
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
            <h3 className="text-[var(--accent)] font-semibold text-sm mb-1">improvements</h3>
            <ul className="space-y-1 text-[var(--text-muted)]">
              <li>• Day dividers fixed — groups now correctly split at midnight even when messages from the same author are within the merge window. Fragment keys prevent dividers from drifting after prepending older messages.</li>
              <li>• 23 new unit tests covering every formatting tag, nested markdown, horizontal rules, and XSS safety regressions.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-[var(--text-muted)] font-semibold text-sm mb-1">tchat 1.1</h3>
            <ul className="space-y-1 text-[var(--text-muted)] opacity-60">
              <li>• Introduced unread tracking, @mentions, notifications, themes, command palette, drag-and-drop reordering, tutorial page, and much more.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}