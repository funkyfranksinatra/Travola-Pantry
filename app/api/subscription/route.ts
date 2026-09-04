// app/api/subscription/route.ts — the weekly report subscription.
//
// One row per restaurant: who gets the Monday digest, and whether it is
// on. The "test" action sends the CURRENT window's digest immediately —
// the only sane way to know the provider key and the address both work
// before trusting a Monday-morning cron with them.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { varianceReport } from "@/lib/variance-engine";
import { renderDigest } from "@/lib/digest";
import { emailConfigured, sendEmail, EMAIL_SETUP_HINT } from "@/lib/mailer";
import { appUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

// Deliberately loose: enough to catch a typo'd space, not an RFC
// parser. The provider validates for real; a strict regex here only
// rejects valid odd addresses.
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const subscription = await prisma.reportSubscription.findUnique({ where: { restaurantId } });
    return Response.json({
      subscription: subscription
        ? { email: subscription.email, enabled: subscription.enabled, lastSentAt: subscription.lastSentAt }
        : null,
      providerConfigured: emailConfigured(),
      setupHint: emailConfigured() ? undefined : EMAIL_SETUP_HINT,
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "set") {
    const email = String(body.email ?? "").trim();
    if (!looksLikeEmail(email)) return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
    const enabled = body.enabled !== false;
    await prisma.reportSubscription.upsert({
      where: { restaurantId },
      create: { restaurantId, email, enabled },
      update: { email, enabled },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    await prisma.reportSubscription.deleteMany({ where: { restaurantId } });
    return NextResponse.json({ ok: true });
  }

  if (action === "test") {
    const subscription = await prisma.reportSubscription.findUnique({ where: { restaurantId } });
    if (!subscription) return NextResponse.json({ error: "Save an address first." }, { status: 400 });
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } });
    const report = await varianceReport(restaurantId);
    if ("error" in report) return NextResponse.json({ error: report.error }, { status: report.status });
    const digest = renderDigest({ restaurantName: restaurant?.name ?? "Your restaurant", appUrl: appUrl(), report });
    if (!digest) {
      return NextResponse.json({ error: "There is no countable window yet — approve two counts and the digest has something to say." }, { status: 409 });
    }
    const sent = await sendEmail({ to: subscription.email, subject: `[Test] ${digest.subject}`, html: digest.html });
    if (!sent.ok) return NextResponse.json({ error: sent.reason }, { status: 502 });
    return NextResponse.json({ ok: true, sentTo: subscription.email });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
