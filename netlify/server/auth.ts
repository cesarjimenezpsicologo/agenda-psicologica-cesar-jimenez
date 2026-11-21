import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { db } from "../../db/index.ts";
import { adminCredentials, adminSessions } from "../../db/schema.ts";
import { INITIAL_ADMIN_PASSWORD } from "./defaults.ts";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const ADMIN_ID = "admin";
export const SESSION_COOKIE = "cj_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 6;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function getCredentials() {
  const [existing] = await db.select().from(adminCredentials).where(eq(adminCredentials.id, ADMIN_ID));
  if (existing) return existing;
  // First run: seed the initial password so the administrator can log in and change it.
  await db
    .insert(adminCredentials)
    .values({ id: ADMIN_ID, passwordHash: await hashPassword(INITIAL_ADMIN_PASSWORD) })
    .onConflictDoNothing();
  const [created] = await db.select().from(adminCredentials).where(eq(adminCredentials.id, ADMIN_ID));
  return created;
}

export type LoginResult = { ok: true } | { ok: false; locked: boolean; retryAfterSeconds?: number };

export async function checkPassword(password: string): Promise<LoginResult> {
  const creds = await getCredentials();
  const now = Date.now();
  if (creds.lockedUntil && creds.lockedUntil.getTime() > now) {
    return { ok: false, locked: true, retryAfterSeconds: Math.ceil((creds.lockedUntil.getTime() - now) / 1000) };
  }

  if (await verifyPassword(password, creds.passwordHash)) {
    if (creds.failedAttempts > 0 || creds.lockedUntil) {
      await db
        .update(adminCredentials)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(adminCredentials.id, ADMIN_ID));
    }
    return { ok: true };
  }

  const attempts = creds.failedAttempts + 1;
  const lock = attempts >= MAX_FAILED_ATTEMPTS;
  await db
    .update(adminCredentials)
    .set({
      failedAttempts: lock ? 0 : attempts,
      lockedUntil: lock ? new Date(now + LOCKOUT_MS) : null,
    })
    .where(eq(adminCredentials.id, ADMIN_ID));
  return lock ? { ok: false, locked: true, retryAfterSeconds: LOCKOUT_MS / 1000 } : { ok: false, locked: false };
}

export async function changePassword(newPassword: string, keepSessionHash: string | null): Promise<void> {
  await getCredentials();
  await db
    .update(adminCredentials)
    .set({ passwordHash: await hashPassword(newPassword), failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(adminCredentials.id, ADMIN_ID));
  // Sign out every other device that was logged in with the old password.
  if (keepSessionHash) {
    await db.delete(adminSessions).where(ne(adminSessions.tokenHash, keepSessionHash));
  } else {
    await db.delete(adminSessions);
  }
}

function isSecureRequest(c: Context): boolean {
  const url = new URL(c.req.url);
  return url.protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
}

export async function createSession(c: Context): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
  await db.insert(adminSessions).values({ tokenHash: sha256(token), expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Strict",
    path: "/api",
    expires: expiresAt,
  });
}

/** Returns the hash of the current valid admin session token, or null when not logged in. */
export async function currentSessionHash(c: Context): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const [session] = await db
    .select()
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, tokenHash), gt(adminSessions.expiresAt, new Date())));
  return session ? tokenHash : null;
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(adminSessions).where(eq(adminSessions.tokenHash, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/api" });
}
