import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The SameSite/Secure policy is derived from env at module load, so each test
 * re-imports auth.ts after setting the relevant env and resetting the module
 * cache.
 */
async function loadAuth() {
  vi.resetModules();
  return await import("./auth.js");
}

afterEach(() => {
  delete process.env.FRONTEND_ORIGINS;
  delete process.env.FRONTEND_ORIGIN;
  vi.restoreAllMocks();
});

describe("sessionCookie", () => {
  it("uses SameSite=None + Secure over HTTPS when a frontend origin is configured", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { sessionCookie } = await loadAuth();

    const cookie = sessionCookie("token", { secure: true });
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
  });

  it("falls back to SameSite=Lax without Secure over HTTP (localhost dev)", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { sessionCookie } = await loadAuth();

    const cookie = sessionCookie("token", { secure: false });
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("uses SameSite=Lax by default when no origin is configured", async () => {
    const { sessionCookie } = await loadAuth();

    const cookie = sessionCookie("token", { secure: true });
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("partitioned cookies (CHIPS)", () => {
  it("marks cross-site session cookies as Partitioned over HTTPS", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { sessionCookie } = await loadAuth();

    const cookie = sessionCookie("token", { secure: true });
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Partitioned");
  });

  it("never emits Partitioned without Secure (invalid per spec)", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { sessionCookie } = await loadAuth();

    const cookie = sessionCookie("token", { secure: false });
    expect(cookie).toContain("SameSite=Lax"); // downgraded
    expect(cookie).not.toContain("Partitioned");
  });

  it("omits Partitioned for same-origin deploys", async () => {
    const { sessionCookie } = await loadAuth();

    const cookie = sessionCookie("token", { secure: true });
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Partitioned");
  });

  it("clears cross-site cookies with the same Partitioned attribute", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { clearSessionCookie } = await loadAuth();

    expect(clearSessionCookie(true)).toContain("Partitioned");
  });
});

describe("clearSessionCookie", () => {
  it("clears with the same downgraded SameSite over HTTP", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { clearSessionCookie } = await loadAuth();

    const cookie = clearSessionCookie(false);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("Max-Age=0");
  });

  it("keeps Secure over HTTPS", async () => {
    process.env.FRONTEND_ORIGINS = "https://app.example.com";
    const { clearSessionCookie } = await loadAuth();

    const cookie = clearSessionCookie(true);
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
  });
});
