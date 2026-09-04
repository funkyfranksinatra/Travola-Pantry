// lib/app-url.ts — where "open the full report" links point.
//
// Vercel provides VERCEL_PROJECT_PRODUCTION_URL without a scheme;
// APP_URL overrides it for custom domains; the production domain is
// the honest fallback because that is where the product lives.
export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://pantry.travola.app";
}
