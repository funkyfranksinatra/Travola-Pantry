// app/api/health/route.ts — is this deployment actually wired up?
//
// Exists so "it does not work" can be answered in one request instead of
// by reading serverless logs. It reports whether each required variable
// is present and whether the database answers — and never reveals a
// value, so it is safe to hit from anywhere.
import { configProblems } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const problems = configProblems();

  let database: { ok: boolean; detail: string } = {
    ok: false,
    detail: "Not attempted — configuration is incomplete.",
  };

  if (!problems.some((p) => p.key === "DATABASE_URL")) {
    try {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "Restaurant"`;
      database = { ok: true, detail: `Connected. ${Number(rows[0]?.n ?? 0)} restaurant(s) on record.` };
    } catch (error) {
      database = {
        ok: false,
        detail: error instanceof Error ? error.message.split("\n")[0] : "Query failed.",
      };
    }
  }

  const ok = problems.length === 0 && database.ok;
  return Response.json(
    {
      ok,
      configuration: {
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
        SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
      },
      problems,
      database,
    },
    { status: ok ? 200 : 503 },
  );
}
