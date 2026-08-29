// lib/cors.ts — preflight for the native counting app.
//
// The app is a bundled webview on its own origin (capacitor://localhost
// on iOS, https://localhost on Android), so every API call is
// cross-origin and POSTs trigger a preflight. The response headers live
// in next.config.ts; this OPTIONS handler is what turns the preflight
// from a 405 into a 204.
//
// Why Access-Control-Allow-Origin: * is safe here: the native client
// authenticates with a BEARER TOKEN, not a cookie. Browsers refuse to
// send ambient credentials under a wildcard origin, so the cookie path
// that signs in the web app cannot be ridden cross-site — a hostile
// page gets anonymous 401s, exactly as if CORS were closed.
export async function corsOptions() {
  return new Response(null, { status: 204 });
}
