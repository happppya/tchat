import { useState, useEffect } from "react";
import type { NotifSettings } from "../services/storage";

interface Props {
  isOpen: boolean;
  settings: NotifSettings;
  onSave: (settings: NotifSettings) => void;
}

export default function SettingsModal({ isOpen, settings, onSave }: Props) {
  const [draft, setDraft] = useState<NotifSettings>(settings);

  useEffect(() => {
    if (isOpen) setDraft(settings);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const toggle = (key: keyof NotifSettings) => {
    // When enabling a desktop toggle, request permission if not yet granted.
    if (
      (key === "desktopGeneral" || key === "desktopImportant") &&
      !draft[key] &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().then(() => {
        setDraft((prev) => ({ ...prev, [key]: true }));
      });
      return;
    }
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const desktopPermission =
    typeof Notification !== "undefined" ? Notification.permission : "denied";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="term-panel w-[360px] max-h-[80vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border-primary)] flex items-center justify-between">
          <span className="text-[var(--accent)] text-sm">
            ~ notification settings
          </span>
          <button
            onClick={() => onSave(draft)}
            className="text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4">
          {/* Sidebar badges */}
          <fieldset className="border border-[var(--border-primary)] p-3">
            <legend className="text-[var(--accent)] glow text-xs px-1">
              sidebar badges
            </legend>
            <div className="flex flex-col gap-2.5">
              <Toggle
                label="General unread"
                description="Show counts of background messages per room"
                enabled={draft.showGeneralBadges}
                onChange={() => toggle("showGeneralBadges")}
              />
              <Toggle
                label="Important unread"
                description="Show counts of pings & @everyone per room"
                enabled={draft.showImportantBadges}
                onChange={() => toggle("showImportantBadges")}
              />
            </div>
          </fieldset>

          {/* Toast notifications */}
          <fieldset className="border border-[var(--border-primary)] p-3">
            <legend className="text-[var(--accent)] glow text-xs px-1">
              toast notifications
            </legend>
            <div className="flex flex-col gap-2.5">
              <Toggle
                label="General toasts"
                description="Pop up for every message in other rooms"
                enabled={draft.generalToasts}
                onChange={() => toggle("generalToasts")}
              />
              <Toggle
                label="Important toasts"
                description="Pop up only for pings & @everyone"
                enabled={draft.importantToasts}
                onChange={() => toggle("importantToasts")}
              />
            </div>
          </fieldset>

          {/* Desktop notifications */}
          <fieldset className="border border-[var(--border-primary)] p-3">
            <legend className="text-[var(--accent)] glow text-xs px-1">
              desktop notifications
            </legend>
            {desktopPermission === "denied" && (
              <div className="text-[10px] text-[var(--text-muted)] mb-2">
                Blocked — allow notifications in your browser settings to enable
                these.
              </div>
            )}
            {desktopPermission === "granted" && (
              <div className="text-[10px] text-[var(--accent-light)] mb-2">
                ✓ permission granted
              </div>
            )}
            {desktopPermission === "default" && (
              <div className="text-[10px] text-[var(--text-muted)] mb-2">
                Toggle a switch to request permission.
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              <Toggle
                label="General messages"
                description="OS notification for every message in other rooms"
                enabled={draft.desktopGeneral}
                onChange={() => toggle("desktopGeneral")}
              />
              <Toggle
                label="Important (pings)"
                description="OS notification for pings & @everyone"
                enabled={draft.desktopImportant}
                onChange={() => toggle("desktopImportant")}
              />
            </div>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-primary)] px-4 py-2 flex items-center gap-2">
          <button
            onClick={() => onSave(draft)}
            className="text-[var(--accent)] text-xs border border-[var(--accent)] px-3 py-1 hover:bg-[var(--accent)]/10 cursor-pointer ml-auto"
          >
            [ save ]
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  enabled,
  onChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <span
        role="switch"
        aria-checked={enabled}
        tabIndex={0}
        onClick={onChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange();
          }
        }}
        className={`relative inline-flex items-center h-5 w-9 shrink-0 rounded-full transition-colors border cursor-pointer ${
          enabled
            ? "bg-[var(--accent)]/30 border-[var(--accent)]"
            : "bg-[var(--bg-secondary)] border-[var(--border-primary)]"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
            enabled
              ? "translate-x-[18px] bg-[var(--accent)]"
              : "translate-x-[2px] bg-[var(--text-muted)]"
          }`}
        />
      </span>
      <div className="flex flex-col">
        <span className="text-xs text-[var(--text-primary)]">{label}</span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {description}
        </span>
      </div>
    </label>
  );
}