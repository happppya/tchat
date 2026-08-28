interface Props {
  onClose: () => void;
}

export default function TutorialPage({ onClose }: Props) {
  return (
    <div className="flex-1 min-w-0 flex items-center justify-center p-4">
      <div className="term-panel border border-[var(--border-primary)] max-w-2xl w-full p-6 text-sm overflow-y-auto max-h-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[var(--accent)] text-lg font-semibold tracking-wide glow">about tchat</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 bg-transparent cursor-pointer hover:text-[var(--text-primary)] transition-colors"
          >
            close
          </button>
        </div>

        <div className="space-y-4 text-[var(--text-secondary)] leading-relaxed">
          <p>
            <span className="text-[var(--accent)] font-semibold">tchat</span> is a terminal-inspired group chat application. The name comes from
            blending <span className="text-[var(--text-primary)]">terminal</span> +{" "}
            <span className="text-[var(--text-primary)]">chat</span>
          </p>

          <div>
            <h3 className="text-[var(--text-primary)] font-semibold mb-1">basic controls</h3>
            <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)] text-xs">
              <li>
                Press <kbd className="border border-[var(--border-primary)] px-1 py-0.5 text-[var(--text-secondary)] text-[10px]">`</kbd>{" "}
                (backtick) to open the <span className="text-[var(--text-primary)]">command palette</span> —
                toggle sidebar, change themes, adjust notification settings, edit your profile, or log out.
              </li>
              <li>
                Use <span className="text-[var(--text-primary)]">/commands</span> in the
                message box: <code className="text-[var(--accent)]">/help</code> for the
                full list, <code className="text-[var(--accent)]">/join #code</code> to
                enter a room, <code className="text-[var(--accent)]">/leave</code> to exit.
                These features are also available through the user interface.
              </li>
              <li>
                <span className="text-[var(--text-primary)]">@mentions</span>: type{" "}
                <code className="text-[var(--accent)]">@username</code> to ping someone
                or <code className="text-[var(--accent)]">@everyone</code> to reach the
                whole room.
              </li>
              <li>
                Drag rooms between groups on the <span className="text-[var(--text-primary)]">my rooms</span>{" "}
                tab to organize them.
              </li>
              <li>
                Right-click a room to <span className="text-[var(--text-primary)]">mute</span>{" "}
                all notifications for it.
              </li>
              <li>
                Click a desktop notification to jump straight to the room that sent it.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-[var(--text-primary)] font-semibold mb-1">navigation</h3>
            <p className="text-xs text-[var(--text-muted)]">
              The sidebar has two tabs: <span className="text-[var(--text-primary)]">my rooms</span>{" "}
              (rooms you've joined) and <span className="text-[var(--text-primary)]">board</span>{" "}
              (public room directory). Admins can create board groups and reorder rooms on
              the board.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}