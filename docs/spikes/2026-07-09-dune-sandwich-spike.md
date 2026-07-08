# Spike: Dune for the sandwich verdict (Scenario B)

_2026-07-09 — is Dune a clean supplier for "you got sandwiched −$X"?_

## Question
ZeroMEV is dead. Can Dune supply, per victim tx hash: (a) were you sandwiched? and
(b) how much was extracted — cleanly enough to drop onto the live page?

## What Dune has
Two maintained spellbook tables (contributor: hildobby, Dune's own team):

- **`dex.sandwiched`** — the **victim** trades. One row per sandwiched trade.
- **`dex.sandwiches`** — the attacker's front-run + back-run legs.

Both cover **ethereum + ~12 other EVM chains**. Columns on `dex.sandwiched` include
`tx_hash` (the victim tx), `block_time`, `project_contract_address` (pool),
`token_sold/bought_*`, and **`amount_usd`** (victim trade size). Detection logic
(`dex_sandwiched.sql` macro): a trade is a victim iff it sits between a front-run and a
back-run by the **same `tx_from`**, on the **same pool**, with **mirrored token direction**,
`front.evt_index + 1 < victim.evt_index < back.evt_index`. Solid, standard definition.

## Verdict on "cleanliness"

| Need | Clean? | How |
|---|---|---|
| **Were you sandwiched? (yes/no)** | ✅ **Clean** | One lookup: `SELECT 1 FROM dex.sandwiched WHERE tx_hash = ?` |
| **Victim trade size ($)** | ✅ Clean | `amount_usd` on the same row |
| **$ extracted / lost** | ⚠️ **Derived, not a column** | Join to `dex.sandwiches` legs, `back.amount_usd − front.amount_usd` for the bracket. Approximate; can be null; a bracket may hold multiple victims so per-victim split isn't exact. |

Same gap the plan predicted (and that ZeroMEV hid): **no `user_loss_usd` column anywhere.**
The shareable number is reconstructable but must be **labelled an estimate** — consistent with
our existing honesty rule (gas exact, everything else estimate).

## The real blocker isn't the data — it's the API shape

Dune is a **batch analytics API**, not a low-latency per-tx lookup:
- **Free tier: 2,500 credits/month**, API included. Each query *execution* burns credits
  proportional to data scanned — and `dex.sandwiched` is a large table.
- Flow per lookup = `execute query` → **poll** for completion → `get results`. Latency is
  **seconds, sometimes longer** — not "paste and see it instantly."
- So **one paste = one execution = credits + a spinner.** 2,500 credits/mo doesn't survive
  any real traffic, and interactive latency is poor.

## Recommendation

**Don't call Dune live per paste.** Two lazy options that fit the hard rule:

1. **Cache-on-lookup (recommended):** call Dune once per unseen tx hash, store the
   `{sandwiched, extracted_usd}` result in a tiny KV (Vercel KV free tier / a JSON blob).
   Repeat pastes = free + instant. Credits only burn on first-seen hashes. Ship the binary
   verdict + estimated loss; label the loss an estimate.
2. **Batch backfill:** nightly cron pulls the last 24h of `dex.sandwiched` hashes into KV;
   page reads KV only, never hits Dune at request time. Zero request-latency, bounded credits.
   Slightly more moving parts (a cron) — do it only if #1's per-paste latency annoys.

Either keeps the page's request path key-free and fast; Dune sits behind a cache.

**Go / No-go:** **Go**, with the cache. The data is real and the binary "sandwiched?" is
clean. The only compromise is the loss $ being a labelled estimate — which our tool already
does for slippage, so it's on-brand, not a new sin.

## Next step to de-risk fully
Needs a **`DUNE_API_KEY`** (free signup) to run `query.sql` against a known sandwiched tx and
confirm the loss-derivation join returns sane numbers. Query is written and ready in
`docs/spikes/query.sql`. Provide a key and I'll validate live.
