// app/api/reports/weekly/route.ts — the Monday-morning digest run.
//
// Fired by the Vercel cron in vercel.json (Mondays 15:00 UTC — 8/9am
// Mountain, either side of DST), authenticated by CRON_SECRET: Vercel
// sends `Authorization: Bearer <CRON_SECRET>` on cron invocations when
// that env var is set, and nothing else may call this route.
//
// This route deliberately crosses tenants — it walks every enabled
// subscription — which is why it can never share the session-cookie
// door the rest of the API uses. Idempotent by design: lastSentAt
// advances only on a confirmed send, and a retry inside the same six
// days sends nothing, so a double-fired cron cannot double-email.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { varianceReport } from "@/lib/variance-engine";
import { renderDigest } from "@/lib/digest";
import { emailConfigured, sendEmail, EMAIL_SETUP_HINT } from "@/lib/mailer";
import { appUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

const SIX_DAYS_MS = 6 * 86_400_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set on this deployment, so the weekly report run is disabled." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!emailConfigured()) {
    return NextResponse.json({ skipped: "no email provider", hint: EMAIL_SETUP_HINT });
  }

  const subscriptions = await prisma.reportSubscription.findMany({
    where: { enabled: true },
    include: { restaurant: { select: { name: true } } },
  });

  const results: Array<{ restaurant: string; outcome: string }> = [];
  for (const subscription of subscriptions) {
    const label = subscription.restaurant.name;
    if (subscription.lastSentAt && Date.now() - subscription.lastSentAt.getTime() < SIX_DAYS_MS) {
      results.push({ restaurant: label, outcome: "already sent this week" });
      continue;
    }
    const report = await varianceReport(subscription.restaurantId);
    if ("error" in report) { results.push({ restaurant: label, outcome: `error: ${report.error}` }); continue; }
    const digest = renderDigest({ restaurantName: label, appUrl: appUrl(), report });
    if (!digest) { results.push({ restaurant: label, outcome: "no countable window yet" }); continue; }
    const sent = await sendEmail({ to: subscription.email, subject: digest.subject, html: digest.html });
    if (!sent.ok) { results.push({ restaurant: label, outcome: `send failed: ${sent.reason}` }); continue; }
    await prisma.reportSubscription.update({
      where: { id: subscription.id },
      data: { lastSentAt: new Date() },
    });
    results.push({ restaurant: label, outcome: `sent to ${subscription.email}` });
  }

  return NextResponse.json({ ran: subscriptions.length, results });
}
