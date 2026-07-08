---
title: Swap Receipt MVP — Scenario D (gas + received + est. slippage, no MEV dependency)
type: feat
status: active
date: 2026-07-08
---

# Swap Receipt MVP — Scenario D

Ship the honest core today: paste a tx hash → "you swapped A→B, received X, gas cost $g,
estimated slippage ~Z% vs mid-price." **No sandwich verdict** — ZeroMEV is dead (HTTP 530 on
both `zeromev.org` and `data.zeromev.org` as of 2026-07-08). The MEV hook bolts on later via
Dune (Scenario B) if/when a supplier is alive. Don't block the tool on ZeroMEV.

**Hard rule (from plan.md): no gold-plating.** One page, one serverless function. If you catch
yourself adding routing decomposition, multi-chain, fee attribution, or a swap button — stop.

## Acceptance Criteria

- [ ] Paste an Ethereum mainnet swap tx hash → page renders a plain-English receipt.
- [ ] Shows: tokens in/out + amounts, gas paid (exact, in ETH + USD), estimated slippage vs mid-price (labelled estimate).
- [ ] Gas is presented as **exact** (from receipt); slippage as **estimate** — never claim precision we can't back (plan.md honesty limit).
- [ ] Graceful failure: non-swap tx, unknown token, or missing price → clear message, not a stack trace.
- [ ] Deploys on Vercel/Cloudflare free tier, $0/mo.

## Data sources (all verified reachable 2026-07-08)

| Need | Source | Note |
|---|---|---|
| Tx receipt (gas used, status, logs) | Etherscan **V2** `api.etherscan.io/v2/api?chainid=1&...` | ⚠️ V1 is deprecated/NOTOK. Needs free API key. Or use Alchemy RPC. |
| Swap decode (token in/out, amounts) | Same receipt — parse ERC-20 `Transfer` + Uniswap `Swap` logs | No extra call. |
| Token metadata (symbol, decimals) | `eth_call` to token contract (or Etherscan tokeninfo) | Cache in-memory per fn cold start. |
| Historical USD price | DefiLlama `coins.llama.fi/prices/historical/{ts}/{chain}:{addr}` | ✅ Works, no key. Confirmed live. |
| ETH price for gas USD | DefiLlama `coingecko:ethereum` at block timestamp | ✅ Confirmed. |

## Proposed shape

```
/                      static page: one input (tx hash) + result area
/api/receipt?hash=…    serverless fn: fetch receipt → decode swap → price → JSON
```

- **Frontend:** single HTML/JS file. `<input>` + fetch → render. No framework needed; ponytail.
- **Backend:** one function. Pseudocode:

```js
// api/receipt.js
export default async (req) => {
  const hash = req.query.hash;                 // validate: /^0x[0-9a-f]{64}$/i
  const receipt = await etherscanV2(hash);     // gas used, status, logs
  const swap = decodeSwap(receipt.logs);       // {tokenIn, tokenOut, amtIn, amtOut} from Transfer/Swap logs
  const ts = await blockTimestamp(receipt.blockNumber);
  const [pIn, pOut, pEth] = await defiLlamaPrices([swap.tokenIn, swap.tokenOut, "ethereum"], ts);
  const gasUsd = receipt.gasUsed * receipt.effectiveGasPrice * pEth;
  const slippagePct = estSlippageVsMid(swap, pIn, pOut);  // (valueIn - valueOut)/valueIn, labelled estimate
  return json({ swap, gasUsd, slippagePct, exact: ["gasUsd"], estimated: ["slippagePct"] });
};
```

## Slippage estimate — be honest about what it is

We have no user front-end quote, so "expected vs actual" is reconstructed. Use DefiLlama mid-prices:
`slippage ≈ (usdValueIn − usdValueOut) / usdValueIn`. This folds price impact + fees + MEV into one
number — that's fine for an MVP verdict as long as it's **labelled an estimate** and gas is shown
separately as exact. Do NOT decompose it (that's the gold-plating plan.md forbids).

## Skip until asked (gold-plating guardrails)

- Sandwich detection (revisit ZeroMEV after ~2026-07-11, or prototype Dune query first).
- Multi-chain, multi-hop routing attribution, fee-on-transfer handling.
- Shareable screenshot card — nice for virality but Scenario D has no sandwich number, which is the
  shareable core. Add it together with the MEV hook, not before.

## Build steps

1. [ ] Scaffold: static `index.html` + `api/receipt.js` on Vercel (or CF Worker). Get one free Etherscan V2 key.
2. [ ] `decodeSwap`: parse `Transfer` + `Swap` logs from a known Uniswap v2/v3 tx. **Write one assert-based test with a real tx hash's expected token/amount.**
3. [ ] Wire DefiLlama prices + compute gasUsd (exact) and slippage estimate.
4. [ ] Render plain-English receipt. Handle the 3 failure cases.
5. [ ] Deploy, test with 3–4 real swap hashes (a clean swap, a high-slippage swap, a non-swap tx).

## Test status

Not started. Data sources verified live 2026-07-08 (DefiLlama ✅, Etherscan V2 migration needed ⚠️,
ZeroMEV dead ❌). The one non-trivial unit — `decodeSwap` — must ship with a runnable assert against
a real tx's known amounts.

## References
- Strategy + competitor/cost analysis: `plan.md`
- Etherscan V2 migration: https://docs.etherscan.io/v2-migration
- DefiLlama prices: https://defillama.com/docs/api
- MEV Blocker (the fix to recommend once sandwich verdict exists): https://mevblocker.io
