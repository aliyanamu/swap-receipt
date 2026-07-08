# Swap Receipt Checker — Plan

_Last updated: 2026-07-08_

> **Status: Scenario D shipped** (`server.js` + `index.html`, no deps, no API keys).
> Public RPC + DefiLlama. Gas exact, slippage estimate, MEV Blocker nudge. ZeroMEV still
> dead (530). Build plan: `docs/plans/2026-07-08-feat-swap-receipt-mvp-scenario-d-plan.md`.
> **Known gap:** token→ETH & aggregator swaps degrade to gas-only (ETH output is internal;
> full decode needs tracing = out of scope). Next: add sandwich verdict when a supplier revives.

Paste a DEX swap tx hash → plain-English post-mortem: what you received, gas paid,
whether you got sandwiched, and whether the loss was avoidable + how to avoid it next time.

**Hard rule for this project: no gold-plating.** Every feature = the smallest thing
that works. One page, one function, no login, no platform. If you catch yourself adding
fee decomposition, routing analysis, multi-chain, or a swap button — stop.

---

## What it's good for (and not)

**The job:** closure + education after a swap that "felt bad." A casual user swaps,
gets less than the number they saw, and wonders "did I get ripped off?" No existing tool
answers that in plain English for a non-technical user.

**Good for:**
- Diagnosis — "here's where your money went, and was it avoidable."
- Behaviour change — "slippage was 3%, set 0.5% + use MEV Blocker, you'd have kept $X."
- Virality / top-of-funnel — "I lost $40 to a sandwich" is a shareable screenshot. **Highest-value use.**
- Portfolio piece — clean on-chain decoding demo.

**NOT good for:**
- Recovery — it's a post-mortem, never gets money back.
- Monetization — nobody pays to be told they lost money yesterday. Value is captured upstream by prevention tools.
- Retention — the honest fix ("use CoW / MEV Blocker") points users elsewhere unless you become the router (heavy, don't).

**Verdict: great free utility + audience magnet + portfolio flex. NOT a standalone business.**
Ship free, make the sandwich verdict shareable, use as top-of-funnel to a prevention step.

---

## Competitors (checked)

| Tool | Does | Gap it leaves |
|---|---|---|
| ZeroMEV | Free per-tx sandwich detection + amount, public API | Sandwich-only, researcher UX, no plain-English "avoidable?" |
| EigenPhi | Per-tx sandwich P&L, token-flow charts | Powerful but technical; API is paid/enterprise |
| OKX / Paybis / 0x articles | Explain slippage generically | Educational, not "analyze *my* tx" |

**Our wedge:** casual full post-mortem + avoidability verdict, NOT another MEV analytics tool.

**GitHub check (no existing repo does this):**
- `"swap slippage analyzer"` → 0 repos. `"dex transaction analysis pnl"` → 0.
- Existing MEV repos are **real-time monitors**, not paste-a-hash post-mortems:
  - `koriyoshi2041/mev-recon` — live ETH mempool watcher + HTML dashboard, "no API keys." Possible source to crib self-detection logic from. 0 stars, unvetted.
  - `claygeo/sandwich-rs` — same, Solana, Rust.
- Build-on dependency exists: `zeromev/zeromev-api` (public tx-level API), `zeromev/zeromev-core` (full engine, don't need).

---

## Tech scope — lean MVP

**Flow:** input tx hash + chain → fetch → plain-English verdict page. Read-only, no login.

**Data sources:**
- Gas + Swap logs (tokens, amountIn/out): Etherscan or Alchemy.
- Sandwich verdict + extracted amount: ZeroMEV API (SEE BLOCKER BELOW).
- Historical USD prices: DefiLlama (free, historical by timestamp).

**Output (one page):** "Swapped A→B, received X. Gas −$g (exact). Sandwiched: yes −$m (exact).
Est. slippage vs mid-price ~Z%. **Verdict:** avoidable → use MEV Blocker / set 0.5% slippage."

**Honest data limit:** we don't have the user's original front-end quote, so "expected vs actual"
is reconstructed, not exact. Only **gas** (from receipt) and **sandwich extraction** (from ZeroMEV)
are precise — lead with those, label the rest an estimate. Don't claim precision we can't back.

**Skip until asked (gold-plating):** precise price-impact-vs-routing decomposition (needs pool-state
replay at block−1, multi-hop attribution, fee-on-transfer handling), multi-chain, swap execution.

### ZeroMEV API response shape (from docs)
Endpoints under `https://data.zeromev.org/v1/`: `mevBlock` (by block), `mevTransactions`
(by address), `mevTransactionsSummary`. Per-tx fields:
- `mev_type` — `sandwich` (victim) / `frontrun` / `backrun` / `arb` / `liquid` / `swap`
- `user_swap_volume_usd` — your swap size ex-extraction
- `extractor_swap_volume_usd` — swaps used to extract from you
- `protocol` — DEX (or "multiple")
- `imbalance` — sandwich re-balancing signal
- NOTE: docs do **not** expose a clean `user_loss_usd` — loss must be derived.

---

## ⚠️ BLOCKER: ZeroMEV is down (as of 2026-07-08)

Every ZeroMEV host returns **HTTP 530 / Cloudflare origin-DNS error** — including the
**main site `zeromev.org` itself**, `data.zeromev.org/v1/...`, and `/docs/`. Origin is
`api-zeromev.cow.fi` (ZeroMEV folded into CoW). Main site + API both dead reads as an
outage or wind-down, not a blip. **Could not pull a single live JSON sample.** Only the
static GitHub-Pages docs page still loads.

This invalidates the "afternoon build on ZeroMEV's free API" assumption. See scenarios below.

---

## Cost

**Running / infra — ≈ $0/mo at hobby scale:**
| Item | Cost |
|---|---|
| Hosting (static page + 1 serverless fn) | $0 — Vercel / Cloudflare free tier |
| RPC + logs + gas (Alchemy/Etherscan) | $0 — free tiers cover low traffic |
| Historical USD prices (DefiLlama) | $0 |
| Domain | ~$12/yr |
| **Total** | **≈ $0/mo + $12/yr**; ~$20–50/mo only if real traffic exceeds free tiers |

**Build effort:**
| Scenario | Effort | Notes |
|---|---|---|
| **A.** ZeroMEV revives, black-box it | 1–2 days | Original plan. Blocked right now. |
| **B.** Dune API for sandwich lookup | +2–4 days | Free tier exists; write SQL, call per-tx. Viable fallback. |
| **C.** Self-detect (replay block, pattern-match) | +1–2 weeks | Accurate detection is the hard part ZeroMEV was hiding. |
| **D.** Drop MEV; MVP = gas + received + est. slippage | 1–2 days | No sandwich hook — loses the shareable core. |
| ~~E. Self-host ZeroMEV stack~~ | weeks + $100s/mo | archive node + Postgres + classifier. **Gold-plating — don't.** |

---

## Decision + Next steps

**Do NOT** self-host ZeroMEV (E) or self-build detection yet (C) — both break the hard rule.

- [x] **Build Scenario D** (done 2026-07-08): gas + received + slippage-vs-mid-price. Zero API keys (public RPC + DefiLlama). Verified live: ETH→token full decode w/ slippage; token→ETH & aggregator degrade to gas-exact; bad hash errors. Offline decode self-check passes.
- [ ] **Re-check ZeroMEV after ~2026-07-11** (3–5 days out): `curl -s -o /dev/null -w "%{http_code}\n" https://zeromev.org/` and the `data.zeromev.org/v1/mevBlock?block_number=18000000&count=1` endpoint. If 200 → sandwich verdict via Scenario A is back on.
- [ ] **If ZeroMEV alive → add sandwich verdict** onto the shipped D page: serverless call to ZeroMEV, derive user loss, render the shareable "sandwiched −$X" line. Get a live JSON sample first to confirm field names.
- [ ] **Else → prototype the Dune sandwich query (B)** to see if it's clean before committing to it as the supplier.
- [x] **Deploy** (done 2026-07-09): live at https://swap-receipt.vercel.app — Vercel free tier, zero config (static `index.html` + `api/receipt.js`). Verified: API full-decodes ETH→token w/ slippage, errors on bad hash, page 200. Optional: grab a custom domain (~$12/yr).

**Next move:** ship D (deploy) and add the sandwich hook the moment a supplier is alive — that line is the shareable core the whole top-of-funnel depends on.

**Stack:** static frontend + one serverless function (Vercel or Cloudflare Workers). Keep it to one page.

---

## Links
- ZeroMEV API docs (static, still up): https://info.zeromev.org/api.html
- ZeroMEV API repo: https://github.com/zeromev/zeromev-api
- MEV Blocker (the prevention fix to recommend): https://mevblocker.io
- DefiLlama prices API: https://defillama.com/docs/api
- Reference (real-time detector, possible crib): https://github.com/koriyoshi2041/mev-recon
