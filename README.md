# Swap Receipt

Paste a DEX swap transaction hash → a plain-English post-mortem: what you swapped, gas paid,
whether you got **sandwiched**, and an estimate of the slippage — with a shareable card.

**Live:** https://swap-receipt.vercel.app
**Try it:** [a real sandwiched swap →](https://swap-receipt.vercel.app/tx/ethereum/0x15c6f25831a17f79499347425e8de72e0740c000359ca38a11e70554bb1c6e56)

No login, no keys required to use it, no wallet connection. It's a read-only post-mortem —
it never touches your funds and can't get money back. The point is closure and behaviour
change: *"here's where your money went, and how to avoid it next time."*

## What it tells you

- **Tokens in/out** — decoded from the transaction's Transfer/Swap logs.
- **Gas paid** — exact, from the receipt (ETH + USD).
- **Sandwich verdict** — binary yes/no, from Dune's `dex.sandwiched` dataset.
- **Estimated slippage** — vs mid-price. Labelled an *estimate*: it folds price impact, fees
  and any MEV into one number. Only gas and the sandwich flag are exact.

### Honest limits

- **No dollar loss for the sandwich.** The per-victim loss isn't obtainable honestly from the
  available data (the attacker's gross across a bracket ≠ what *you* lost — off ~15× in
  testing). So we show the flag, never a fake number. See `docs/spikes/`.
- **`token → ETH` and aggregator swaps** show gas only. Their ETH output is an internal
  transfer, invisible in the logs; decoding it needs full tx tracing, which is out of scope.

## How it works

```
index.html        static page — vanilla JS, no framework
api/receipt.js    receipt: gas + tokens + slippage (fast) / ?sandwich=1 flag (Dune)
api/og.js         1200×630 share card (edge runtime, @vercel/og)
api/page.js       serves /tx/<chain>/<hash> with per-tx OG meta so links unfurl
lib.js            shared decode + fetch logic (edge-safe)
server.js         local dev server (node --env-file=.env server.js)
```

**Data sources** (all free tier):

- **Public RPC** (`ethereum-rpc.publicnode.com`) — transaction receipt, no key.
- **DefiLlama** — token symbol, decimals and historical USD price in one call, no key.
- **Dune Analytics** — sandwich detection (`dex.sandwiched`). Needs a free `DUNE_API_KEY`.

**Caching.** A mined transaction never changes, so confirmed results are served with
`Cache-Control: immutable` and cached by Vercel's CDN — repeats never re-hit the function or
Dune, so API credits burn roughly once per transaction globally.

## Run locally

```sh
npm install
cp .env.example .env        # add your DUNE_API_KEY (free: https://dune.com/settings/api)
node --env-file=.env server.js   # http://localhost:3000
node server.js --test            # offline decode self-check
```

The sandwich flag is optional — without `DUNE_API_KEY` everything else still works; the flag
just returns "unknown".

## Deploy

Zero-config on Vercel. Set `DUNE_API_KEY` in the project's environment variables, then deploy.
`vercel.json` wires the `/tx/` routing and function settings.

## License

MIT
