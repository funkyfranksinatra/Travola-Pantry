# Travola Pantry

Inventory, and the shift close-out that keeps sales figures flowing into
the rest of Travola.

## Why this exists

Travola has no POS. Without one the platform knows how many people came —
the floor app books them — but not what they spent, which silently kills
average bill, revenue, growth and RevPASH on the analysis tab.

The close-out is a sixty-second form that fixes that, and it is the
foundation the inventory system is built on top of: food cost is COGS
over sales, and sales has to come from somewhere.

## What is here

| Tab | Does |
|---|---|
| **Today** | What needs closing out, and what the close-outs on file add up to |
| **Close-out** | The form |
| **History** | Every close-out, editable |

Items, Count, Order and Reports are **not built**. Today says so plainly
rather than showing empty tabs.

## Rules

- **Never run `prisma migrate` or `prisma db push` from this repo.**
  Travola-OS owns every migration; a `db push` from here would drop the
  floor app's tables. `prisma generate` only.
- `SESSION_SECRET` must be byte-identical across all three apps.
- The session cookie is `travola_pantry_session`, so one device can hold
  a floor, Home and Pantry session at once.

## Setup

```
npm install
cp .env.example .env    # fill in
npm run dev
```

## Design notes

`docs/CLOSE-OUT.md` covers why the form is the length it is, why the
service date defaults to the night before, and what the close-out can and
cannot tell the analysis tab.
