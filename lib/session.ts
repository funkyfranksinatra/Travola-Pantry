// lib/session.ts — restaurant session for Travola Pantry.
//
// Deliberately IDENTICAL in scheme to the floor app's and the POS's
// lib/session.ts: an HMAC-signed cookie carrying the restaurant id,
// verified with the shared SESSION_SECRET. One restaurant credential
// (name + 4-digit passcode) signs a manager into all three products.
//
// The cookie NAME differs (travola_pantry_session) so a shared device
// can hold a floor session, a Home session and a Pantry session at once,
// and signing out of one never signs the others out. The signature is
// interchangeable, so putting all three apps on travola.app subdomains
// later and sharing ONE cookie across them is a rename, not a rewrite.
//
// Travola Home and Pantry additionally carry an `adm` claim: the timestamp at
// which the owner last proved the admin passcode. Destructive routes
// require it to be recent (see ADMIN_WINDOW_MS) — a re-auth window, so
// a tablet left unlocked on the pass cannot delete a restaurant.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "travola_pantry_session";
const encoder = new TextEncoder();
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** How long proving the admin passcode keeps destructive routes open. */
export const ADMIN_WINDOW_MS = 10 * 60 * 1000;

type Session = { restaurantId: string; iat: number; adm?: number };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required to use restaurant sessions.");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function encode(session: Session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(value?: string | null): Session | null {
  if (!value) return null;
  const [payload, received] = value.split(".");
  if (!payload || !received) return null;
  const expected = sign(payload);
  const a = encoder.encode(received);
  const b = encoder.encode(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.restaurantId !== "string" || typeof parsed.iat !== "number") return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

function cookieValue(req: Request) {
  const header = req.headers.get("cookie") || "";
  const fromCookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (fromCookie) return fromCookie;
  // The native counting app cannot rely on cross-origin cookies — mobile
  // webviews drop them unpredictably — so it carries the SAME signed
  // value in an Authorization header instead. One token format, two
  // transports: nothing about verification changes, and a bearer token
  // is exactly as forgeable as the cookie was (not at all, without the
  // secret).
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return undefined;
}

/** Read the restaurant id from a Request (API routes, proxy). */
export function getRestaurantId(req: Request) {
  return decode(cookieValue(req))?.restaurantId ?? null;
}

/** Read the restaurant id from a cookie string (server components). */
export function restaurantIdFromCookieValue(value?: string | null) {
  return decode(value)?.restaurantId ?? null;
}

/** Has the owner proved the admin passcode inside the re-auth window? */
export function hasFreshAdmin(req: Request) {
  const session = decode(cookieValue(req));
  if (!session?.adm) return false;
  return Date.now() - session.adm < ADMIN_WINDOW_MS;
}

/** Milliseconds of admin window left, or 0. Drives the UI countdown. */
export function adminWindowRemaining(value?: string | null) {
  const session = decode(value);
  if (!session?.adm) return 0;
  return Math.max(0, ADMIN_WINDOW_MS - (Date.now() - session.adm));
}

/** The signed session value itself, for clients that store it as a
 *  bearer token rather than receiving it as a cookie. */
export function createSessionToken(restaurantId: string) {
  return encode({ restaurantId, iat: Date.now() });
}

export function setSession(response: NextResponse, restaurantId: string, admin = false) {
  const session: Session = { restaurantId, iat: Date.now() };
  if (admin) session.adm = Date.now();
  response.cookies.set(SESSION_COOKIE, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export const PANTRY_SESSION_COOKIE = SESSION_COOKIE;
