# Anonymous School Chat — Requirements

> Status: **Planning** — no code changes yet.

---

## 1. Identity & Permission Model

### 1.1 Persistent Users
- The existing username/password auth system stays.
- Users have persistent site-wide IDs, but non-admin clients can never see another user's ID or any aggregate counts (e.g. how many people are in a room).

### 1.2 Site Admins
- Certain users are **manually elevated** to site-admin status (e.g. a flag in the `users` table).
- Site admins have **all permissions at all times** across every room.
- Site admins are **immune** to all room-owner and moderator powers (cannot be kicked, banned, muted, etc.).
- Admin clients can see everything: persistent user IDs, room member counts, all metadata.

### 1.3 Room Owners
- The user who creates a room is its owner.
- Room owners can:
  - Temporarily **remove** or **ban** non-admin users from the room.
  - **Elevate** other users to moderator status.
  - **De-elevate** moderators back to regular users.
  - **Mute** and **unmute** users (muted users cannot send messages).
- Room owners cannot affect site admins.

### 1.4 Moderators
- Elevated by the room owner.
- Have the same powers as the room owner **within that room**.
- Moderators **can kick each other** (mutual accountability).
- Moderators cannot affect site admins.

### 1.5 Room Creation
- **Only site admins** can create rooms. Regular users cannot.
- Admin permissions and room-owner permissions are **separate concepts** — an admin who creates a room is also its owner, but the role checks are distinct.

---

## 2. Room Types (non-exclusive)

A room can have any combination of these flags:

| Flag         | Behavior |
|-------------|----------|
| **Hidden**   | Requires a password (>8 characters) to join. The password prompt appears when attempting to join. |
| **Readonly** | All non-admin users are muted by default. Only site admins can speak. |
| **Anonymous** | Everyone (except admins) is assigned a random display name on join. Bios and profile pictures are hidden. Users cannot be identified across rooms. |
| **Transparent** | Everyone keeps their standard username and profile info (the default behavior). |

These types are **not mutually exclusive** — a room could be both Hidden and Anonymous, Readonly and Hidden, etc.

---

## 3. Room 0 — Default Directory

- Every user automatically joins **Room 0** on signup (or first load).
- Room 0 is a **directory/lobby** listing common/public rooms.
- Room 0 cannot be deleted and has special protections.
- It serves as the landing page for new users to discover rooms.

---

## 4. Slash Commands

All owner/mod/admin commands are executed via **slash commands** typed in the chat input.

### 4.1 UX
- Triggered by typing `/` in the message composer.
- **Tab autocomplete** cycles through available commands.
- **Input hints** show below the composer as the user types (e.g. `/kick @username` shows argument hints).
- Invalid commands or insufficient permissions show an inline error.

### 4.2 Planned Commands

| Command | Who Can Use | Description |
|---------|-------------|-------------|
| `/kick @user` | Owner, Mod, Admin | Temporarily remove a user from the room |
| `/ban @user` | Owner, Mod, Admin | Ban a user from the room |
| `/unban @user` | Owner, Mod, Admin | Remove a ban |
| `/mute @user` | Owner, Mod, Admin | Mute a user (cannot send messages) |
| `/unmute @user` | Owner, Mod, Admin | Unmute a user |
| `/mod @user` | Owner, Admin | Elevate a user to moderator |
| `/demod @user` | Owner, Admin | Remove moderator status |
| `/join #12345` | Everyone | Join room 12345 |
| `/leave` | Everyone | Leave the current room |
| `/rooms` | Everyone | List discoverable rooms |
| `/whois @user` | Admin only | Show persistent user info |

---

## 5. Click-to-Interact Menu

- Clicking on a user's display name in the chat opens a **context menu** (dropdown/popover).
- The menu shows available actions based on the viewer's permissions:
  - **Everyone**: View public profile (if Transparent room), send DM placeholder
  - **Owner/Mod/Admin**: Kick, Ban, Mute/Unmute, Promote/Demote
- This is a convenience alternative to typing slash commands.

---

## 6. Text Formatting — Room Links

- The pattern `[#12345]` in any message is automatically rendered as a **clickable link**.
- Clicking it prompts the user: "Join room #12345 — RoomName?" with a confirm button.
- If the room is Hidden, prompt for the password first.
- If the room doesn't exist, show "Room #12345 not found."
- This works alongside the existing Markdown renderer.

---

## 7. Privacy Constraints

### 7.1 Non-Admin Clients Must NOT See:
- Persistent user IDs of other users
- How many people are in a room (member count)
- Which user sent which message in an Anonymous room
- Any aggregate presence data

### 7.2 Admin Clients See:
- Full user IDs on every message
- Room member lists with IDs
- All metadata

### 7.3 Anonymous Rooms Specifically:
- Display names are randomly assigned per-user per-room (e.g. "Guest_A7F3")
- Profile pictures and bios are hidden for all non-admin participants
- The `user_id` column on messages is nulled out (from the client's perspective)
- Admins retain their real names and can see who is who

---

## 8. Technical Constraints

- All permission checks must be server-side — the client only receives the subset of data its role allows.
- Ban/mute state must persist across sessions (stored in the database).
- Slash commands are parsed on the client for instant UX feedback, but enforced server-side.
- Room 0 must be seeded by migrations and never deletable.

---

## 9. Implementation Order (Tentative)

1. **Database migrations** — admin flag, room type columns, bans/mutes tables, Room 0 seed
2. **Permission middleware** — admin detection, room-owner checks, mod checks
3. **Room types** — hidden (password), readonly, anonymous, transparent
4. **Room 0** — default join, directory listing
5. **Slash command system** — parser, autocomplete, hint UI
6. **Click-to-interact menu** — name-click popover with actions
7. **Text formatting** — `[#12345]` clickable room links
8. **Privacy filters** — strip IDs/counts for non-admin clients
9. **Tests** — Playwright + Vitest coverage for permission boundaries