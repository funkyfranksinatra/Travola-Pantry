# The shift close-out

## Why it is this short

Its length is a hard budget, not a target. Every field added is a night
somebody skips it, and a close-out that gets skipped costs more than the
field was ever worth.

One required number — net sales. Three that pay for themselves — the
food/beverage split and covers. Everything else folded behind "More".

It is used at 1am by someone who has been standing for fourteen hours and
is holding a POS printout. That is the design constraint behind every
decision on the page.

## The service date defaults to the night before

A close-out done at 1:30am Saturday belongs to **Friday's** service. The
default is `now − 5 hours`, so an early-morning close-out is filed against
the night that was actually worked. Defaulting to the calendar date would
misfile a shift every single night, and nobody would notice until a
month's day-of-week averages came out wrong.

## Covers are pre-filled, not asked for

The floor app already counted what was on the book. The form shows that
number and lets the manager correct it for walk-ins and no-shows —
confirming a number rather than looking one up.

The query that fetches it compares dates **directly and never applies a
timezone**: the floor app stores local wall-clock time in naive columns.
Converting there was the bug that once filed an entire restaurant's
dinner service as brunch.

## Saving twice corrects; it never duplicates

`@@unique([restaurantId, serviceDate, period])` plus an upsert. A second
close-out for the same service is an edit. The alternative is a duplicate
row that silently doubles a month's revenue and is nearly impossible to
spot afterwards.

## Money parsing

Parse to integer cents at the edge; never carry a float. The parser
accepts what people type off a printout — `$1,240.50`, `1240`, `1,240` —
and **rounds** rather than truncating, because `12.345 × 100` is
`1234.4999…` in binary floating point and truncating loses a cent on a
large fraction of hand-typed entries.

Empty is `null`, junk is `NaN`. The distinction matters: nothing entered
is not the same as zero sales, and zero sales on a Tuesday is a real
answer.

## What the close-out can and cannot tell the analysis tab

Travola Home unions close-outs into its money queries alongside closed
POS checks. A service day with closed checks **excludes** its close-out,
so revenue is never counted twice; checks win because they are the more
granular record.

| Metric | From a close-out alone |
|---|---|
| Revenue, growth MoM/YoY | ✅ |
| Per-person average | ✅ (revenue ÷ covers) |
| Revenue per seat hour | ✅ |
| **Average bill**, median bill, tip rate | ❌ needs a check count |
| Most/least sold, menu engineering | ❌ needs item-level sales |

That distinction is deliberate and is enforced in code by two separate
flags — `hasMoney` and `hasChecks`. Dividing revenue by covers and
calling it "average bill" is the tempting shortcut, and it is wrong: a
table of four is one bill and four covers. Printing one under the other's
label is the kind of quiet lie that makes an owner stop trusting the tab.

The coverage panel therefore shows **two** gaps with two different fixes:
"close out a service" (which the owner can do tonight) and "needs a
connected POS" (which they cannot type their way out of).

## `source` is the whole design

Every row today is `manual`. When the Toast and Square integrations land
they write rows here with `toast` / `square` instead, and nothing
downstream changes — the analysis tab, forecast scoring and food-cost
maths all keep reading this one table. The typing stops; the schema does
not move.
