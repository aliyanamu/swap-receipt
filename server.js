#!/usr/bin/env node
// Swap Receipt Checker — Scenario D MVP.
// Paste an Ethereum mainnet swap tx hash -> plain-English post-mortem:
// tokens in/out, gas (exact), estimated slippage vs mid-price.
// No API keys: public RPC for the receipt, DefiLlama for symbol/decimals/price.
// No sandwich verdict yet (ZeroMEV dead as of 2026-07-08) — bolts on later.
//
// Run:   node server.js            -> http://localhost:3000
// Test:  node server.js --test     -> offline decode self-check
//
// ponytail: net-balance heuristic. token<->token and ETH->token decode fully;
// token->ETH and aggregator swaps hide the ETH output in an internal transfer,
// so they degrade to gas-exact + partial legs. Add trace_transaction only if
// that case turns out to matter — the plan forbids full router decoding.

const http = require("http");

const RPC = process.env.RPC || "https://ethereum-rpc.publicnode.com";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SWAP_V3 = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const SWAP_V2 = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

const rpc = (method, params) =>
  fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
      return j.result;
    });

const logAddr = (topic) => "0x" + topic.slice(-40);

// --- pure decode: receipt + tx -> {isSwap, user, inputs, outputs, partial} ---
// inputs/outputs are [{token, raw}] where token is a lowercase address or "ETH".
function decodeSwap(receipt, tx) {
  const isSwap = receipt.logs.some(
    (l) => l.topics[0] === SWAP_V3 || l.topics[0] === SWAP_V2
  );
  const user = receipt.from.toLowerCase();
  const net = {}; // token -> signed user balance change
  for (const l of receipt.logs) {
    if (l.topics[0] !== TRANSFER || l.topics.length !== 3) continue;
    const token = l.address.toLowerCase();
    const from = logAddr(l.topics[1]);
    const to = logAddr(l.topics[2]);
    const amt = BigInt(l.data);
    if (from === user) net[token] = (net[token] || 0n) - amt;
    if (to === user) net[token] = (net[token] || 0n) + amt;
  }
  const inputs = [];
  const outputs = [];
  const ethIn = BigInt(tx.value || "0x0");
  if (ethIn > 0n) inputs.push({ token: "ETH", raw: ethIn });
  for (const [token, n] of Object.entries(net)) {
    if (n < 0n) inputs.push({ token, raw: -n });
    else if (n > 0n) outputs.push({ token, raw: n });
  }
  // partial = a swap where we couldn't see both sides in ERC20 logs
  // (token->ETH output unwrapped internally, or router-executed with no user legs).
  const partial = isSwap && (inputs.length === 0 || outputs.length === 0);
  return { isSwap, user, inputs, outputs, partial };
}

// DefiLlama: symbol + decimals + USD price at a timestamp, one call for many tokens.
async function prices(tokens, ts) {
  const keys = tokens.map((t) =>
    t === "ETH" ? "coingecko:ethereum" : `ethereum:${t}`
  );
  const url = `https://coins.llama.fi/prices/historical/${ts}/${keys.join(",")}`;
  const j = await fetch(url).then((r) => r.json());
  const out = {};
  for (let i = 0; i < tokens.length; i++) {
    const c = j.coins[keys[i]];
    if (c)
      out[tokens[i]] = {
        symbol: c.symbol,
        decimals: tokens[i] === "ETH" ? 18 : c.decimals,
        price: c.price,
      };
  }
  return out;
}

const human = (raw, decimals) => Number(raw) / 10 ** decimals;

async function buildReceipt(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Not a valid tx hash.");
  const [receipt, tx] = await Promise.all([
    rpc("eth_getTransactionReceipt", [hash]),
    rpc("eth_getTransactionByHash", [hash]),
  ]);
  if (!receipt) throw new Error("Transaction not found (or not yet mined).");
  if (receipt.status === "0x0") throw new Error("This transaction reverted (failed).");

  const gasEth =
    human(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice), 18);
  const decoded = decodeSwap(receipt, tx);
  if (!decoded.isSwap)
    return { hash, isSwap: false, gasEth, note: "This doesn't look like a DEX swap — no Swap event found." };

  const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const ts = parseInt(block.timestamp, 16);

  const toks = [
    ...new Set([
      "ETH",
      ...decoded.inputs.map((x) => x.token),
      ...decoded.outputs.map((x) => x.token),
    ]),
  ];
  const px = await prices(toks, ts);

  const value = (legs) =>
    legs.map((l) => {
      const p = px[l.token];
      const amount = p ? human(l.raw, p.decimals) : null;
      return {
        symbol: p ? p.symbol : l.token.slice(0, 8),
        amount,
        usd: p && amount != null ? amount * p.price : null,
      };
    });

  const inputs = value(decoded.inputs);
  const outputs = value(decoded.outputs);
  const gasUsd = px.ETH ? gasEth * px.ETH.price : null;

  const usdIn = sum(inputs);
  const usdOut = sum(outputs);
  let slippagePct = null;
  if (!decoded.partial && usdIn && usdOut)
    slippagePct = ((usdIn - usdOut) / usdIn) * 100;

  return {
    hash,
    isSwap: true,
    partial: decoded.partial,
    gasEth,
    gasUsd,
    inputs,
    outputs,
    slippagePct,
  };
}

const sum = (legs) => legs.reduce((a, l) => (l.usd != null ? a + l.usd : a), 0) || null;

// --- HTTP ---
const PAGE = require("fs").readFileSync(__dirname + "/index.html");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(PAGE);
  }
  if (url.pathname === "/api/receipt") {
    try {
      const data = await buildReceipt(url.searchParams.get("hash") || "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

// --- offline self-check: decode logic must not silently break ---
function test() {
  const assert = require("assert");
  const mk = (from, logs, value = "0x0") => [{ from, status: "0x1", logs }, { value }];
  const t = (tok, f, to, amt) => ({
    address: tok,
    topics: [TRANSFER, "0x".padEnd(66 - 40, "0") + f.slice(2), "0x".padEnd(66 - 40, "0") + to.slice(2)],
    data: "0x" + amt.toString(16),
  });
  const swapLog = { address: "0xpool", topics: [SWAP_V3], data: "0x" };
  const U = "0x1111111111111111111111111111111111111111";
  const A = "0xaaaa000000000000000000000000000000000000";
  const B = "0xbbbb000000000000000000000000000000000000";
  const R = "0x2222222222222222222222222222222222222222"; // router

  // token->token direct: user sends A, receives B -> full decode
  let d = decodeSwap(...mk(U, [swapLog, t(A, U, R, 100n), t(B, R, U, 90n)]));
  assert(d.isSwap && !d.partial, "direct token<->token should be full");
  assert.equal(d.inputs.length, 1, "one input");
  assert.equal(d.inputs[0].token, A.toLowerCase());
  assert.equal(d.outputs[0].raw, 90n);

  // ETH->token: value>0 in, token B out -> full decode
  d = decodeSwap(...mk(U, [swapLog, t(B, R, U, 90n)], "0xde0b6b3a7640000"));
  assert(!d.partial, "ETH->token should be full");
  assert.equal(d.inputs[0].token, "ETH");

  // token->ETH: user sends A, ETH out is internal (invisible) -> partial
  d = decodeSwap(...mk(U, [swapLog, t(A, U, R, 100n)]));
  assert(d.partial, "token->ETH (invisible output) should be partial");

  // aggregator: user is not a party to any transfer -> partial
  d = decodeSwap(...mk(U, [swapLog, t(A, R, "0xdead000000000000000000000000000000000000", 1n)]));
  assert(d.partial, "aggregator with no user legs should be partial");

  // non-swap: no Swap event
  d = decodeSwap(...mk(U, [t(A, U, R, 100n)]));
  assert(!d.isSwap, "no Swap event -> not a swap");

  console.log("ok - decode self-check passed");
}

if (process.argv.includes("--test")) test();
else server.listen(3000, () => console.log("http://localhost:3000"));
