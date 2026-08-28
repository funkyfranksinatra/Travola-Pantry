// lib/env.ts — fail loudly, and in English, when configuration is missing.
//
// The failure this exists to prevent: with no DATABASE_URL, the Postgres
// driver quietly falls back to 127.0.0.1:5432, Prisma spends its timeout
// dialling a database that was never there, and the user sees a generic
// "that did not work" on the sign-in screen. The cause (an env var that
// was never set on the deployment) is nowhere in that message, so the
// natural conclusion is that the password is wrong.
//
// A configuration mistake should name itself.

export type ConfigProblem = { key: string; detail: string; fix: string };

/** Everything the app needs to serve a request, checked at call time. */
export function configProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    problems.push({
      key: "DATABASE_URL",
      detail: "No database connection string is configured.",
      fix: "Set DATABASE_URL on this deployment to the same Neon connection string the floor manager and Travola Home use.",
    });
  } else if (/\bplaceholder\b/i.test(databaseUrl)) {
    // The build-time placeholder in prisma.config.ts exists so
    // `prisma generate` can run without a database. If it ever reaches
    // the runtime it means the real value is missing.
    //
    // Matched on the word "placeholder" ONLY. An earlier version also
    // rejected any localhost URL, which flagged a perfectly good local
    // development database as misconfigured — the check has to catch the
    // placeholder without calling every developer's laptop broken.
    problems.push({
      key: "DATABASE_URL",
      detail: "The database connection string is still the local build placeholder.",
      fix: "Set DATABASE_URL on this deployment to the same Neon connection string the floor manager and Travola Home use.",
    });
  }

  if (!process.env.SESSION_SECRET) {
    problems.push({
      key: "SESSION_SECRET",
      detail: "No session secret is configured, so nobody can be signed in.",
      fix: "Set SESSION_SECRET to the exact value used by the floor manager and the POS. It must match byte for byte.",
    });
  }

  return problems;
}

/**
 * A single sentence to show a signed-out user, or null when the app is
 * configured. Deliberately says what is wrong and where to fix it: the
 * person hitting this screen is the person who can fix it.
 */
export function configMessage(): string | null {
  const problems = configProblems();
  if (!problems.length) return null;
  const keys = problems.map((p) => p.key).join(" and ");
  return `This deployment is missing ${keys}. ${problems.map((p) => p.fix).join(" ")}`;
}

/**
 * Turn an infrastructure failure into a sentence the reader can act on.
 * A screen that answers "something went wrong" when the real problem is
 * an unset environment variable sends the user off to check a password
 * that was never wrong.
 */
/** Is this failure something the operator can fix by setting a variable? */
export function isConfigurationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/SESSION_SECRET|DATABASE_URL/i.test(message)) return true;
  const code = (error as { code?: string })?.code;
  const unreachable = code === "P1001" || /reach database server|DatabaseNotReachable/i.test(message);
  // An unreachable database with the URL set is an outage, not a setting.
  return unreachable && !process.env.DATABASE_URL;
}

export function operationalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  if (code === "P1001" || /reach database server|DatabaseNotReachable/i.test(message)) {
    // Only blame the environment variable when it is actually absent.
    // Saying "DATABASE_URL is probably not set" to someone who set it
    // twenty minutes ago sends them to check the one thing that is fine,
    // when the real answer is that the database itself is unreachable.
    return process.env.DATABASE_URL
      ? "Travola Home cannot reach the database right now. The connection string is configured, so this is the database being unreachable rather than a missing setting — it usually clears on its own."
      : "Travola Home cannot reach the database because DATABASE_URL is not set on this deployment. It needs the same Neon connection string as the floor manager and the POS.";
  }
  if (/SESSION_SECRET/i.test(message)) {
    return "Travola Home has no SESSION_SECRET configured, so it cannot sign anyone in. Set it to the same value the floor manager and Travola Home use.";
  }
  if (/DATABASE_URL/i.test(message)) return message;
  return "Something went wrong. The deployment logs will have the detail.";
}
