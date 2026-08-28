// app/(pantry)/layout.tsx — the signed-in frame.
//
// Server component: it resolves the tenant once, on the server, so the
// nav renders with the restaurant's name in the first paint rather than
// flashing a placeholder and correcting itself.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { configProblems } from "@/lib/env";
import { PANTRY_SESSION_COOKIE, restaurantIdFromCookieValue } from "@/lib/session";

export default async function PantryLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();

  // This layout is the real gate for a page request — the proxy only
  // checks that a cookie exists. Anything that fails here is a bounce to
  // /login, never a 500: a broken cookie should not look like a broken
  // product.
  let restaurantId: string | null = null;
  try {
    restaurantId = restaurantIdFromCookieValue(jar.get(PANTRY_SESSION_COOKIE)?.value);
  } catch (error) {
    console.error("[layout] session could not be read:", error);
    redirect("/login");
  }
  if (!restaurantId) redirect("/login");
  if (configProblems().length) redirect("/login");

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });
  if (!restaurant) redirect("/login");

  return <Shell restaurantName={restaurant.name}>{children}</Shell>;
}
