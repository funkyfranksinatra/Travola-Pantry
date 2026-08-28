// lib/tenant.ts — every request resolves its own tenant.
//
// There is no build-time restaurant constant. The tenant comes from the
// signed session cookie on each request, so one deployment serves every
// paying restaurant. HOME_RESTAURANT_ID exists only as a local-sandbox
// convenience and is IGNORED in production, where an env-var tenant would
// be a cross-restaurant data leak waiting to happen.
import { getRestaurantId } from "./session";
import { configMessage, isConfigurationFailure, operationalError } from "./env";

export function currentRestaurantId(req: Request) {
  const fromSession = getRestaurantId(req);
  if (fromSession) return fromSession;
  if (process.env.NODE_ENV !== "production" && process.env.HOME_RESTAURANT_ID) {
    return process.env.HOME_RESTAURANT_ID;
  }
  return null;
}

/** Resolve the tenant or throw a 401 Response the route can return. */
export function requireRestaurant(req: Request) {
  const restaurantId = currentRestaurantId(req);
  if (!restaurantId) {
    throw new Response(JSON.stringify({ error: "Not signed in." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return restaurantId;
}

/** Wrap a route body so a thrown Response is returned rather than a 500. */
export async function withTenant(
  req: Request,
  handler: (restaurantId: string) => Promise<Response>,
) {
  // A deployment missing an env var should say so once, here, rather
  // than surfacing as a different unhelpful error on every screen.
  const misconfigured = configMessage();
  if (misconfigured) {
    return Response.json({ error: misconfigured, configuration: true }, { status: 503 });
  }
  try {
    return await handler(requireRestaurant(req));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[console]", error);
    // `configuration: true` tells the UI "this is a setup problem, do not
    // retype your code". Claiming it for an ordinary bug would send the
    // user off to check settings that are perfectly fine.
    const configuration = isConfigurationFailure(error);
    return Response.json(
      { error: operationalError(error), ...(configuration ? { configuration } : {}) },
      { status: configuration ? 503 : 500 },
    );
  }
}
