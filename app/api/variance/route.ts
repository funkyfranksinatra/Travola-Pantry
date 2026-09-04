// app/api/variance/route.ts — Actual vs Theoretical, per item.
//
// A thin door: the computation lives in lib/variance-engine.ts, shared
// with the weekly email digest so the screen and the inbox can never
// show two different food costs. See the engine for the arithmetic and
// the honesty rules (approved counts only, null over guessed zero).
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant";
import { varianceReport, varianceDrill } from "@/lib/variance-engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const url = new URL(request.url);
    const openId = url.searchParams.get("open");
    const closeId = url.searchParams.get("close");
    const itemId = url.searchParams.get("item");

    const result = itemId
      ? await varianceDrill(restaurantId, openId, closeId, itemId)
      : await varianceReport(restaurantId, openId, closeId);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  });
}
