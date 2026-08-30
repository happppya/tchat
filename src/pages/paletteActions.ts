import type { CommandAction } from "../components/ui/CommandPalette";

interface PaletteActionDeps {
  onToggleSidebar: () => void;
  onEditProfile: () => void;
  onOpenSettings: () => void;
  onOpenThemePicker: () => void;
  onLogout: () => void;
}

/** App-level command-palette actions (extracted from ChatPage for readability). */
export function buildPaletteActions({
  onToggleSidebar,
  onEditProfile,
  onOpenSettings,
  onOpenThemePicker,
  onLogout,
}: PaletteActionDeps): CommandAction[] {
  return [
    {
      id: "toggle-sidebar",
      section: "View",
      label: "Toggle sidebar",
      run: onToggleSidebar,
    },
    {
      id: "edit-profile",
      section: "Account",
      label: "Edit profile",
      keywords: "bio picture avatar",
      run: onEditProfile,
    },
    {
      id: "notif-settings",
      section: "Settings",
      label: "Notification settings",
      keywords: "notifications badges pings toasts",
      run: onOpenSettings,
    },
    {
      id: "choose-theme",
      section: "Settings",
      label: "Choose theme",
      keywords: "theme color appearance",
      run: onOpenThemePicker,
    },
    {
      id: "logout",
      section: "Account",
      label: "Log out",
      keywords: "signout exit quit",
      run: onLogout,
    },
  ];
}
