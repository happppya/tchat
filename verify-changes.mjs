/**
 * Integration smoke-test: exercises the new role hierarchy, room types,
 * privacy filtering, and room commands against the compiled server.
 *
 * Run: node --require dotenv/config verify-changes.mjs
 *   or: npx cross-env DATABASE_PATH=:memory: node verify-changes.mjs
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname);

const DB_PATH = path.join(PROJECT_ROOT, "verify-changes-test.db");

let failures = 0;
function pass(label) {
  console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
  console.error(`  ✗ ${label}: ${detail}`);
  failures++;
}

function assert(cond, label, detail) {
  if (cond) pass(label);
  else fail(label, detail || "assertion failed");
}

async function request(base, method, path, body, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = `sid=${cookie}`;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const sidMatch = setCookie.match(/sid=([^;]+)/);
  const sid = sidMatch ? sidMatch[1] : null;
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, sid };
}

async function main() {
  console.log("=== Starting server ===");

  // Clean up any stale db
  try { fs.unlinkSync(DB_PATH); } catch {}
  try { fs.unlinkSync(DB_PATH + "-wal"); } catch {}
  try { fs.unlinkSync(DB_PATH + "-shm"); } catch {}

  // Start the server as a child process
  const PORT = 3456;
  const serverProc = fork(
    path.join(PROJECT_ROOT, "dist-server", "server.js"),
    [],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        DATABASE_PATH: DB_PATH,
        // Disable cleanup interval so empty rooms don't vanish mid-test
        CLEANUP_INTERVAL_MS: "3600000",
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    }
  );

  // Wait for the server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server start timeout")), 10000);
    serverProc.stdout.on("data", (chunk) => {
      const msg = chunk.toString();
      process.stdout.write("[server] " + msg);
      if (msg.includes("Server running on port") || msg.includes("Running on port")) {
        clearTimeout(timeout);
        setTimeout(resolve, 300); // give it a tick
      }
    });
    serverProc.stderr.on("data", (chunk) => {
      process.stderr.write("[server:err] " + chunk.toString());
    });
    serverProc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
  const BASE = `http://127.0.0.1:${PORT}/api`;

  // ── 1. Health check ──────────────────────────────────────────
  console.log("\n── Health ──");
  const health = await fetch(`${BASE}/health`);
  const healthData = await health.json();
  assert(healthData.status === "ok", "health check", JSON.stringify(healthData));

  // ── 2. Signup ────────────────────────────────────────────────
  console.log("\n── Signup ──");
  const { sid: aliceSid, data: aliceData } = await request(
    BASE, "POST", "/signup", { username: "alice_test", password: "password123" }
  );
  assert(aliceSid !== null, "alice gets session cookie");
  assert(aliceData?.user?.username === "alice_test", "alice username correct", JSON.stringify(aliceData));
  assert(aliceData?.user?.isAdmin === false, "alice is not admin by default", `isAdmin=${aliceData?.user?.isAdmin}`);

  const { sid: bobSid, data: bobData } = await request(
    BASE, "POST", "/signup", { username: "bob_test", password: "password123" }
  );
  assert(bobSid !== null, "bob gets session cookie");
  assert(bobData?.user?.isAdmin === false, "bob is not admin");

  const { sid: carolSid } = await request(
    BASE, "POST", "/signup", { username: "carol_test", password: "password123" }
  );
  assert(carolSid !== null, "carol gets session cookie");

  // ── 3. /api/me carries isAdmin ────────────────────────────────
  console.log("\n── /api/me ──");
  const { data: aliceMe } = await request(BASE, "GET", "/me", undefined, aliceSid);
  assert(aliceMe?.user?.isAdmin === false, "alice /api/me shows isAdmin=false");
  assert(aliceMe?.user?.username === "alice_test", "alice /api/me username");

  // ── 4. Login (re-auth test) ──────────────────────────────────
  console.log("\n── Login ──");
  const { sid: aliceSid2, data: aliceLogin } = await request(
    BASE, "POST", "/login", { username: "alice_test", password: "password123" }
  );
  assert(aliceSid2 !== null, "alice can log in");
  assert(aliceLogin?.user?.isAdmin === false, "alice login isAdmin=false");

  // ── 5. Admin promotion ───────────────────────────────────────
  console.log("\n── Admin promotion ──");
  // Simulate admin promotion via direct DB access (same pattern as
  // a real operator: UPDATE users SET is_admin=1 WHERE id=X).
  // We'll use the server's db handle indirectly through a new route
  // doesn't exist, so test by verifying createGC is rejected first.
  const { status: createFailStatus } = await request(
    BASE, "POST", "/createGC",
    { id: 1001, name: "Test Room", isTransparent: true },
    bobSid
  );
  assert(createFailStatus === 403, "non-admin cannot create room", `status=${createFailStatus}`);

  // ── 6. Room 0 check ──────────────────────────────────────────
  console.log("\n── Room 0 ──");
  const { data: room0Info } = await request(
    BASE, "GET", "/getGCInfo?groupChatId=0", undefined, aliceSid
  );
  assert(room0Info?.name === "Lobby", "Room 0 is the Lobby", JSON.stringify(room0Info));
  assert(room0Info?.id === 0, "Room 0 id is 0");
  assert(room0Info?.is_transparent === 1, "Room 0 is transparent");

  // Try to delete Room 0 — must fail.
  const { status: delRoom0Status, data: delRoom0Data } = await request(
    BASE, "DELETE", "/deleteGC",
    { groupChatId: 0 },
    aliceSid
  );
  assert(delRoom0Status === 403, "Room 0 cannot be deleted", `status=${delRoom0Status}, body=${JSON.stringify(delRoom0Data)}`);

  // ── 7. Create room as admin ───────────────────────────────────
  console.log("\n── Admin room creation ──");
  // We need to make alice an admin. Since there's no API to promote,
  // we import the db module directly and update it.
  const dbMod = await import("./dist-server/src/server/db.js");
  const { openDatabase, seedRoomZero } = dbMod;

  const db = await openDatabase(path.join(PROJECT_ROOT, "verify-changes-test.db"));
  await db.run("UPDATE users SET is_admin = 1 WHERE username = 'alice_test'");
  const { is_admin } = (await db.get("SELECT is_admin FROM users WHERE username = 'alice_test'")) || {};
  assert(is_admin === 1, "alice promoted to admin in DB");

  // Re-login to pick up the new isAdmin in the session.
  const { sid: adminAliceSid, data: adminAlice } = await request(
    BASE, "POST", "/login", { username: "alice_test", password: "password123" }
  );
  assert(adminAlice?.user?.isAdmin === true, "alice now shows as admin after re-login");

  // Now create a hidden + anonymous room
  const { status: create1, data: create1Data } = await request(
    BASE, "POST", "/createGC",
    {
      id: 2001,
      name: "Hidden Anon Room",
      isHidden: true,
      password: "supersecret99",
      isAnonymous: true,
    },
    adminAliceSid
  );
  assert(create1 === 201, "admin creates hidden+anonymous room", `status=${create1}, body=${JSON.stringify(create1Data)}`);

  // Create a readonly room
  const { status: create2 } = await request(
    BASE, "POST", "/createGC",
    { id: 2002, name: "Readonly Room", isReadonly: true },
    adminAliceSid
  );
  assert(create2 === 201, "admin creates readonly room");

  // Create a transparent room
  const { status: create3 } = await request(
    BASE, "POST", "/createGC",
    { id: 2003, name: "Transparent Room", isTransparent: true },
    adminAliceSid
  );
  assert(create3 === 201, "admin creates transparent room");

  // ── 8. Join hidden room with password ─────────────────────────
  console.log("\n── Join hidden room ──");

  // Join without password should fail
  const { status: joinNoPass } = await request(
    BASE, "POST", "/joinRoom", { groupChatId: 2001 }, bobSid
  );
  assert(joinNoPass === 403, "hidden room rejects join without password", `status=${joinNoPass}`);

  // Join with wrong password
  const { status: joinWrongPass } = await request(
    BASE, "POST", "/joinRoom", { groupChatId: 2001, password: "wrongpass123" }, bobSid
  );
  assert(joinWrongPass === 403, "hidden room rejects wrong password");

  // Join with correct password
  const { status: joinOk, data: joinData } = await request(
    BASE, "POST", "/joinRoom", { groupChatId: 2001, password: "supersecret99" }, bobSid
  );
  assert(joinOk === 200, "hidden room accepts correct password", `status=${joinOk}, body=${JSON.stringify(joinData)}`);
  assert(joinData?.anonName !== undefined, "join response includes anonName field");

  // Admin bypasses password
  await request(BASE, "POST", "/joinRoom", { groupChatId: 2001 }, adminAliceSid);

  // ── 9. Join readonly room ─────────────────────────────────────
  console.log("\n── Readonly room ──");
  await request(BASE, "POST", "/joinRoom", { groupChatId: 2002 }, bobSid);

  // ── 10. Join transparent room ─────────────────────────────────
  console.log("\n── Transparent room ──");
  await request(BASE, "POST", "/joinRoom", { groupChatId: 2003 }, bobSid);

  // ── 11. getGCInfo privacy filtering ───────────────────────────
  console.log("\n── getGCInfo privacy ──");
  const { data: gcInfoAdmin } = await request(
    BASE, "GET", "/getGCInfo?groupChatId=2001", undefined, adminAliceSid
  );
  assert(gcInfoAdmin?.password_hash !== undefined, "admin sees password_hash");
  assert(gcInfoAdmin?.viewer_is_staff === true, "admin has viewer_is_staff=true", `viewer_is_staff=${gcInfoAdmin?.viewer_is_staff}`);

  const { data: gcInfoBob } = await request(
    BASE, "GET", "/getGCInfo?groupChatId=2001", undefined, bobSid
  );
  assert(gcInfoBob?.password_hash === undefined, "non-admin does NOT see password_hash", `has password_hash: ${gcInfoBob?.password_hash !== undefined}`);
  assert(gcInfoBob?.viewer_is_staff === false, "bob has viewer_is_staff=false", `viewer_is_staff=${gcInfoBob?.viewer_is_staff}`);

  // ── 12. Room command: kick ────────────────────────────────────
  console.log("\n── Room commands ──");

  // Non-staff can't kick
  const { status: kickFail } = await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "kick", targetUsername: "alice_test" },
    bobSid
  );
  assert(kickFail === 403, "non-staff cannot kick", `status=${kickFail}`);

  // Admin (alice) can kick bob from transparent room
  const { status: kickOk } = await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "kick", targetUsername: "bob_test" },
    adminAliceSid
  );
  assert(kickOk === 200, "admin kicks bob from room");

  // Verify bob is no longer a member
  const { status: gcInfoAfterKick } = await request(
    BASE, "GET", "/getGCInfo?groupChatId=2003", undefined, bobSid
  );
  assert(gcInfoAfterKick === 403, "bob cannot access room after being kicked");

  // ── 13. Room command: ban + ban enforcement on join ──────────
  console.log("\n── Ban enforcement ──");

  // Admin bans bob from room 2001
  const { status: banOk } = await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2001, command: "ban", targetUsername: "bob_test" },
    adminAliceSid
  );
  assert(banOk === 200, "admin bans bob");

  // Bob tries to rejoin — should be rejected
  const { status: rejoinBanned } = await request(
    BASE, "POST", "/joinRoom",
    { groupChatId: 2001, password: "supersecret99" },
    bobSid
  );
  assert(rejoinBanned === 403, "banned user cannot rejoin", `status=${rejoinBanned}`);

  // Unban bob
  await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2001, command: "unban", targetUsername: "bob_test" },
    adminAliceSid
  );

  // Bob can now rejoin
  const { status: rejoinAfterUnban } = await request(
    BASE, "POST", "/joinRoom",
    { groupChatId: 2001, password: "supersecret99" },
    bobSid
  );
  assert(rejoinAfterUnban === 200, "unbanned user can rejoin");

  // ── 14. Mod promotion ─────────────────────────────────────────
  console.log("\n── Moderator promotion ──");

  // Admin promotes bob to mod in room 2003
  await request(BASE, "POST", "/joinRoom", { groupChatId: 2003 }, bobSid);

  const { status: modOk } = await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "mod", targetUsername: "bob_test" },
    adminAliceSid
  );
  assert(modOk === 200, "admin promotes bob to moderator");

  // Verify bob is now staff
  const { data: gcInfo2003Bob } = await request(
    BASE, "GET", "/getGCInfo?groupChatId=2003", undefined, bobSid
  );
  assert(gcInfo2003Bob?.viewer_is_staff === true, "bob is now staff after promotion", `viewer_is_staff=${gcInfo2003Bob?.viewer_is_staff}`);

  // ── 15. Cannot act on an admin ────────────────────────────────
  console.log("\n── Admin immunity ──");

  const { status: kickAdmin } = await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "kick", targetUsername: "alice_test" },
    bobSid
  );
  assert(kickAdmin === 403, "mod cannot kick admin", `status=${kickAdmin}`);

  // ── 16. Demod ─────────────────────────────────────────────────
  console.log("\n── Demod ──");

  await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "demod", targetUsername: "bob_test" },
    adminAliceSid
  );

  const { data: gcInfo2003AfterDemod } = await request(
    BASE, "GET", "/getGCInfo?groupChatId=2003", undefined, bobSid
  );
  assert(gcInfo2003AfterDemod?.viewer_is_staff === false, "bob lost staff after demod");

  // ── 17. Mute/unmute ───────────────────────────────────────────
  console.log("\n── Mute ──");

  const { status: muteOk } = await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "mute", targetUsername: "carol_test" },
    adminAliceSid
  );
  assert(muteOk === 200, "admin mutes carol");

  await request(
    BASE, "POST", "/roomCommand",
    { groupChatId: 2003, command: "unmute", targetUsername: "carol_test" },
    adminAliceSid
  );

  // ── 18. Room 0 cannot be deleted even by admin ────────────────
  console.log("\n── Room 0 deletion by admin ──");
  const { status: adminDelRoom0 } = await request(
    BASE, "DELETE", "/deleteGC",
    { groupChatId: 0 },
    adminAliceSid
  );
  assert(adminDelRoom0 === 403, "admin cannot delete Room 0 either");

  // ── 19. Room directory (no hidden rooms) ──────────────────────
  console.log("\n── Room directory ──");
  const { data: publicRooms } = await request(
    BASE, "GET", "/publicRooms", undefined, bobSid
  );
  const roomIds = publicRooms.map((r) => r.id);
  assert(!roomIds.includes(2001), "hidden room not in directory");
  assert(roomIds.includes(2002), "readonly room IS in directory");
  assert(roomIds.includes(2003), "transparent room IS in directory");
  assert(roomIds.includes(0), "Room 0 IS in directory");

  // ── 20. Summary ───────────────────────────────────────────────
  console.log(`\n${"=".repeat(40)}`);
  if (failures === 0) {
    console.log("ALL TESTS PASSED ✓");
  } else {
    console.error(`${failures} TEST(S) FAILED ✗`);
  }
  console.log(`${"=".repeat(40)}`);

  // Cleanup
  await db.close();
  serverProc.kill();
  // Clean up test db files
  try { fs.unlinkSync(DB_PATH); } catch {}
  try { fs.unlinkSync(DB_PATH + "-wal"); } catch {}
  try { fs.unlinkSync(DB_PATH + "-shm"); } catch {}
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});