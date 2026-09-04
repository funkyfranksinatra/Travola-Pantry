// lib/digest.ts — the weekly email, rendered.
//
// Pure: report in, subject + HTML out, no I/O — so the render is
// unit-tested without a mailbox. The HTML is 1999-grade on purpose:
// tables and inline styles are the only layout language every email
// client still speaks, and a digest that collapses in Outlook is a
// digest that gets deleted unread.
//
// The numbers come from the SAME variance engine the Recipes tab uses.
// This file only formats; it never computes — two implementations of
// "food cost this window" is how the screen and the inbox start
// arguing.
import type { VarianceReport } from "./variance-engine";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const day = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function renderDigest(input: {
  restaurantName: string;
  appUrl: string;
  report: VarianceReport;
}): { subject: string; html: string } | null {
  const { report } = input;
  // Nothing to say beats saying nothing at length. A restaurant with no
  // countable window this week gets no email, not an empty one.
  if (!report.ready) return null;

  const { totals } = report;
  const name = esc(input.restaurantName);
  const pct = totals.cogsPct != null ? `${totals.cogsPct.toFixed(1)}%` : null;
  const subject = pct
    ? `${input.restaurantName} — food cost ${pct} this window`
    : `${input.restaurantName} — inventory window closed at ${usd(totals.actualUsageValueCents)} used`;

  const top = report.rows
    .filter((row) => row.varianceValueCents != null && row.varianceValueCents !== 0)
    .slice(0, 5);

  const cell = 'style="padding:6px 10px;border-bottom:1px solid #e5e5ea;font-size:13px;color:#1d1d1f"';
  const num = 'style="padding:6px 10px;border-bottom:1px solid #e5e5ea;font-size:13px;color:#1d1d1f;text-align:right;font-variant-numeric:tabular-nums"';

  const rowsHtml = top.length
    ? top.map((row) => `
        <tr>
          <td ${cell}>${esc(row.itemName)}</td>
          <td ${num}>${row.varianceCount != null ? `${row.varianceCount > 0 ? "+" : ""}${row.varianceCount.toFixed(1)} ${esc(row.countUnit)}` : "—"}</td>
          <td ${num}><strong>${usd(row.varianceValueCents ?? 0)}</strong></td>
        </tr>`).join("")
    : `<tr><td colspan="3" ${cell}>No unexplained variances this window — a clean week.</td></tr>`;

  const stat = (label: string, value: string) => `
    <td style="padding:14px 16px;background:#f5f5f7;border-radius:10px;vertical-align:top">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6e6e73">${label}</div>
      <div style="font-size:22px;font-weight:650;color:#1d1d1f;margin-top:4px">${value}</div>
    </td>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
      <tr><td style="padding-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#4f46e5;letter-spacing:0.02em">Travola <span style="font-weight:400;color:#6e6e73;letter-spacing:0.2em;font-size:10px">PANTRY</span></div>
        <div style="font-size:19px;font-weight:650;color:#1d1d1f;margin-top:10px">${name} — inventory week</div>
        <div style="font-size:13px;color:#6e6e73;margin-top:4px">${day(report.window.from)} → ${day(report.window.to)}</div>
      </td></tr>
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${stat("Food cost", usd(totals.actualUsageValueCents))}
          <td style="width:10px"></td>
          ${stat("% of sales", pct ?? "—")}
          <td style="width:10px"></td>
          ${stat("Unexplained (net)", usd(totals.varianceValueCents))}
        </tr></table>
      </td></tr>
      <tr><td style="padding-top:22px">
        <div style="font-size:14px;font-weight:650;color:#1d1d1f;margin-bottom:8px">Worth a look</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6e6e73;border-bottom:1px solid #d2d2d7">Item</td>
            <td style="padding:6px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6e6e73;border-bottom:1px solid #d2d2d7;text-align:right">Variance</td>
            <td style="padding:6px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#6e6e73;border-bottom:1px solid #d2d2d7;text-align:right">$ impact</td>
          </tr>
          ${rowsHtml}
        </table>
        ${totals.wasteValueCents > 0 ? `<div style="font-size:12px;color:#6e6e73;margin-top:10px">${usd(totals.wasteValueCents)} of this week's usage is logged waste — explained, not missing.</div>` : ""}
        ${!report.hasSalesData ? `<div style="font-size:12px;color:#6e6e73;margin-top:10px">No item-level sales reached this window, so theoretical usage is unknown — the variances above are actual-usage signals only.</div>` : ""}
      </td></tr>
      <tr><td style="padding-top:24px">
        <a href="${esc(input.appUrl)}/recipes" style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">Open the full report</a>
      </td></tr>
      <tr><td style="padding-top:26px;font-size:11px;color:#a1a1a6">
        Sent by Travola Pantry because a weekly report is set up under Settings. Same numbers as the Recipes tab — click any row there to drill into its equation.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html };
}
