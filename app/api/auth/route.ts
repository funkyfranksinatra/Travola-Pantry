// app/api/auth/route.ts — sign in and sign out.
//
// The same restaurant name + passcode that opens the floor manager and
// Travola Home.
// One credential across three products is the whole point: a restaurant
// sets a code once and it works everywhere.
import { NextResponse } from "next/server";
import { allowAttempt, restaurantByCredentials } from "@/lib/restaurant-auth";
import { clearSession, createSessionToken, setSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { configMessage, isConfigurationFailure, operationalError } from "@/lib/env";

export async function POST(request: Request) {
  if (!allowAttempt(request, "pantry-login")) {
    return NextResponse.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 });
  }

  // Check configuration before touching the database, so a missing env
  // var is reported as a missing env var rather than as a timeout.
  const misconfigured = configMessage();
  if (misconfigured) {
    return NextResponse.json({ error: misconfigured, configuration: true }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => null);
    const name = body?.name;
    const passcode = String(body?.passcode ?? "");
    const restaurant = await restaurantByCredentials(name, passcode);
    if (!restaurant) {
      // Deliberately one message for both "no such restaurant" and "wrong
      // code": naming which half was wrong hands an attacker a directory of
      // every restaurant on the platform.
      return NextResponse.json({ error: "That restaurant name and code do not match." }, { status: 401 });
    }
    await audit({ restaurantId: restaurant.id, action: "auth.sign_in", summary: "Signed in to Travola Pantry", req: request });
    // The native counting app asks for the session as a TOKEN, because
    // mobile webviews drop cross-origin cookies unpredictably. Same
    // signed value the cookie would carry; the client stores it and
    // sends it back as Authorization: Bearer.
    const wantsToken = body?.client === "mobile";
    return setSession(
      NextResponse.json({
        ok: true,
        restaurant: { id: restaurant.id, name: restaurant.name },
        ...(wantsToken ? { token: createSessionToken(restaurant.id) } : {}),
      }),
      restaurant.id,
    );
  } catch (error) {
    console.error("[auth] sign-in failed:", error);
    const configuration = isConfigurationFailure(error);
    return NextResponse.json(
      { error: operationalError(error), ...(configuration ? { configuration } : {}) },
      { status: configuration ? 503 : 500 },
    );
  }
}

export async function DELETE() {
  return clearSession(NextResponse.json({ ok: true }));
}

export { corsOptions as OPTIONS } from "@/lib/cors";
