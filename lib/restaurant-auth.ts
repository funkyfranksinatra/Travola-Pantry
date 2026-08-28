// lib/restaurant-auth.ts — restaurant credentials for Travola Home.
//
// Byte-for-byte the same scheme the floor app writes at registration
// (`scrypt$<salt>$<derived>`), so a passcode set once in Travola-OS
// signs the restaurant into Travola Home too.
//
// Unlike the POS, Travola Home is a WRITER of credentials: it is where an
// owner rotates the restaurant passcode, sets the separate admin
// passcode, and resets or revokes a staff PIN. Every one of those writes
// goes through here and is audit-logged by the caller.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./prisma";
// Shared verbatim with Travola-OS (lib/name-key.ts) and the POS. The
// three apps MUST agree on this function: it is what makes "Volario's"
// typed on an iPad (curly apostrophe) resolve to the same restaurant the
// manager registered from a desktop.
export { nameKey } from "./name-key";
import { nameKey } from "./name-key";

const scrypt = promisify(scryptCallback);

export async function hashPasscode(passcode: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(passcode, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPasscode(passcode: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const actual = (await scrypt(passcode, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Restaurant matching name + passcode, or null. */
export async function restaurantByCredentials(name: unknown, passcode: string) {
  const key = nameKey(name);
  if (!key || !/^\d{4,8}$/.test(passcode)) return null;
  const restaurant = await prisma.restaurant.findUnique({ where: { nameKey: key } });
  if (!restaurant) return null;
  return (await verifyPasscode(passcode, restaurant.passcodeHash)) ? restaurant : null;
}

/**
 * Verify the credential that gates irreversible acts.
 *
 * When an owner has set a dedicated admin passcode we require THAT and
 * nothing else. When they have not, we fall back to the restaurant
 * passcode so the feature works on day one — and the caller surfaces a
 * prompt to set a real one, because a code the whole floor knows is not
 * an admin credential.
 */
export async function verifyAdminPasscode(restaurantId: string, passcode: string) {
  if (!passcode) return { ok: false as const, usedFallback: false };
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { passcodeHash: true, adminPasscodeHash: true },
  });
  if (!restaurant) return { ok: false as const, usedFallback: false };
  if (restaurant.adminPasscodeHash) {
    return { ok: await verifyPasscode(passcode, restaurant.adminPasscodeHash), usedFallback: false };
  }
  return { ok: await verifyPasscode(passcode, restaurant.passcodeHash), usedFallback: true };
}

/** Has this restaurant set a dedicated admin passcode yet? */
export async function hasAdminPasscode(restaurantId: string) {
  const row = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { adminPasscodeHash: true },
  });
  return Boolean(row?.adminPasscodeHash);
}

// ── Brute-force throttle (mirrors the floor app's login limiter) ──────
// Per-instance and in-memory: enough to blunt guessing at pilot scale.
// Durable rate limiting lands with multi-tenant hardening.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function clientKey(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function allowAttempt(req: Request, bucket: string, limit = 10) {
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || row.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}
