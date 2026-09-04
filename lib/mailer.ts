// lib/mailer.ts — one function that sends an email, or says plainly
// why it cannot.
//
// Resend over plain fetch: no SDK dependency for one POST. The key
// lives in RESEND_API_KEY on the deployment; absent, every caller gets
// a reason string it can show the user instead of a silent no-op —
// "the email quietly never sends" is the worst failure mode a
// subscription feature can have.
const RESEND_URL = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export const EMAIL_SETUP_HINT =
  "Set RESEND_API_KEY on the deployment (a free resend.com account works) and, once a sending domain is verified there, REPORT_FROM_EMAIL.";

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: `No email provider is configured. ${EMAIL_SETUP_HINT}` };

  // Resend's own onboarding address works without a verified domain —
  // enough to prove the pipe before DNS is set up.
  const from = process.env.REPORT_FROM_EMAIL || "Travola Pantry <onboarding@resend.dev>";

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return { ok: false, reason: body.message ?? `The email provider answered ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Could not reach the email provider: ${(error as Error).message}` };
  }
}
