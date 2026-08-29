// proxy.ts — page-level boundary (Next 16's middleware).
//
// This checks only that a session cookie is PRESENT. It does not verify
// the signature, and that is deliberate on two counts.
//
// SECURITY: this was never the boundary. Every API route resolves the
// tenant from the signed cookie itself (lib/tenant.ts), and the
// signed-in layout re-decodes it and redirects to /login when it does
// not verify. A forged cookie gets past this redirect and then straight
// back out again, having read nothing. What this file is for is sparing
// a cookie-less browser a shell that spins while its calls 401 behind it.
//
// CORRECTNESS: middleware does not run in the same runtime as the route
// handlers, and `process.env` values are baked into its bundle when the
// deployment is BUILT. A SESSION_SECRET added to a project after its
// last build is visible to the API routes — which read the environment
// at request time — and absent here. That asymmetry took down every
// page on a deployment whose sign-in worked perfectly: `/login` and
// `/api/auth` are outside this matcher, so the first request that ever
// reached this file was the redirect to `/` after a successful sign-in,
// and it threw "SESSION_SECRET is required" at the middleware.
//
// Not reading the secret here removes that whole class of failure, and
// rotating the secret no longer needs a rebuild to take effect.
import { NextResponse, type NextRequest } from "next/server";
import { PANTRY_SESSION_COOKIE } from "@/lib/session";

export function proxy(request: NextRequest) {
  try {
    const cookie = request.cookies.get(PANTRY_SESSION_COOKIE)?.value;
    if (cookie) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  } catch (error) {
    // A redirect helper must never be the reason a page 500s. If
    // anything here goes wrong, let the request through — the layout
    // and the API routes still verify properly.
    console.error("[proxy]", error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/", "/inventory", "/count", "/purchases", "/recipes", "/close-out", "/history", "/settings"],
};
