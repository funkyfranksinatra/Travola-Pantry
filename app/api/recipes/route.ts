// app/api/recipes/route.ts — recipe mapping and live plate costing.
//
// A recipe is what turns a sale into theoretical usage and an invoice
// into a new plate cost. Costs are computed at READ time from each
// ingredient's lastCostCents — never stored — which is the entire
// mechanism of cost rippling.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { plateCostCents, plateMarginPct } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const [menuItems, recipes] = await Promise.all([
      prisma.menuItem.findMany({
        where: { restaurantId, active: true },
        select: { id: true, name: true, priceCents: true, category: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.recipe.findMany({
        where: { restaurantId },
        include: { lines: { include: { item: { select: { id: true, name: true, usageUnit: true, countPerPurchase: true, usagePerCount: true, lastCostCents: true } } } } },
      }),
    ]);
    const byMenuItem = new Map(recipes.map((recipe) => [recipe.menuItemId, recipe]));

    return Response.json({
      dishes: menuItems.map((menuItem) => {
        const recipe = byMenuItem.get(menuItem.id);
        const lines = (recipe?.lines ?? []).map((line) => ({
          itemId: line.item.id,
          itemName: line.item.name,
          quantity: Number(line.quantity),
          usageUnit: line.item.usageUnit,
          spec: {
            countPerPurchase: Number(line.item.countPerPurchase),
            usagePerCount: Number(line.item.usagePerCount),
            lastCostCents: line.item.lastCostCents,
          },
        }));
        const cost = lines.length ? plateCostCents(lines.map((l) => ({ quantity: l.quantity, spec: l.spec }))) : null;
        return {
          menuItemId: menuItem.id,
          name: menuItem.name,
          category: menuItem.category?.name ?? "",
          priceCents: menuItem.priceCents,
          recipeId: recipe?.id ?? null,
          lines: lines.map(({ spec, ...rest }) => rest),
          plateCostCents: cost,
          marginPct: cost != null ? plateMarginPct(menuItem.priceCents, cost) : null,
          costPct: cost != null && menuItem.priceCents > 0 ? (cost / menuItem.priceCents) * 100 : null,
        };
      }),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "save") {
    const menuItemId = String(body.menuItemId ?? "");
    const menuItem = await prisma.menuItem.findFirst({ where: { id: menuItemId, restaurantId } });
    if (!menuItem) return NextResponse.json({ error: "That dish is not on the menu." }, { status: 400 });

    const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    const lines: Array<{ itemId: string; quantity: number }> = [];
    for (const raw of rawLines) {
      const quantity = Number(raw.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const item = await prisma.inventoryItem.findFirst({ where: { id: String(raw.itemId), restaurantId, active: true }, select: { id: true } });
      if (item) lines.push({ itemId: item.id, quantity });
    }
    if (!lines.length) {
      // Saving an empty recipe deletes it — an empty recipe would price
      // the plate at zero cost, which reads as 100% margin and lies.
      await prisma.recipe.deleteMany({ where: { restaurantId, menuItemId } });
      return NextResponse.json({ ok: true, removed: true });
    }

    const recipe = await prisma.recipe.upsert({
      where: { menuItemId },
      create: { restaurantId, menuItemId },
      update: {},
    });
    await prisma.recipeLine.deleteMany({ where: { recipeId: recipe.id } });
    for (const line of lines) {
      await prisma.recipeLine.create({ data: { recipeId: recipe.id, itemId: line.itemId, quantity: line.quantity } });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
