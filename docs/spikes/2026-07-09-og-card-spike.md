# Spike: OG share card with the sandwich verdict

_2026-07-09 — can a shared `/tx/...` link unfurl as a card that shows "You got sandwiched"?_

## Result: YES — working end-to-end

- **`api/og.js`** renders a 1200×630 PNG via `@vercel/og` (native Vercel tool; rasterizing
  text isn't a few lines, so it clears the ladder). Reuses `lib.js` for the receipt + verdict.
- **`api/page.js`** serves `/tx/<chain>/<hash>` as the app HTML with per-tx `og:image` meta
  injected — crawlers read it, humans still get the client app (rewrite `/tx/(.*)` → `/api/page`).
- Verified locally with a **real** sandwiched tx: card reads "You got sandwiched · ETH → USDC ·
  Gas $0.27 · est. slippage 1.2%", verdict pulled live from Dune. **Render ~3.4s** incl. verdict.

Skipped emoji in the image (satori needs an extra emoji-font asset — not worth it for a card).

## The one real catch: crawler timeout vs the slow verdict

The verdict costs a Dune round-trip (~3–9s; cached per-tx after first fetch). Crawler patience:

| Channel | Tolerance | Verdict on first (cold) fetch |
|---|---|---|
| Telegram / Discord / Slack | patient (10–30s+) | ✅ reliable — these are the crypto-native channels |
| Twitter/X | tight (~few s) + aggressive cache | ⚠️ cold-start + cache-miss (~9s) may miss it |

**Mitigation (not built — the ship decision):** persist the verdict in **Vercel KV** so
`api/og.js` reads it instantly instead of calling Dune. Precompute on first human view (the
page already calls `checkSandwich`), so by the time a link is shared it's warm. This also fixes
the cold-start cache reset noted in `lib.js`. ~half-day. Until then it unfurls reliably on
Telegram/Discord/Slack and usually on Twitter after the first fetch warms it.

## Verdict
**Go.** The card works and shows the verdict today. Ship as-is for the crypto-native channels;
add Vercel KV when bulletproof Twitter unfurls matter (it's the same KV that hardens the
credit cache — one change, two wins).
