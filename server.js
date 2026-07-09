#!/usr/bin/env node
// Local dev runner. Production deploys as static index.html + api/receipt.js (Vercel).
// Run:   node server.js         -> http://localhost:3000
// Test:  node server.js --test  -> offline decode self-check

const http = require("http");
const fs = require("fs");
const { buildReceipt, checkSandwich, decodeSwap, TRANSFER, SWAP_V3 } = require("./lib");

const PAGE = fs.readFileSync(__dirname + "/index.html");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(PAGE);
  }
  if (url.pathname === "/api/receipt") {
    try {
      const hash = url.searchParams.get("hash") || "";
      const isSandwich = url.searchParams.get("sandwich");
      const data = isSandwich
        ? { hash, sandwiched: await checkSandwich(hash) }
        : await buildReceipt(hash, url.searchParams.get("chain") || "ethereum");
      const final = isSandwich ? data.sandwiched !== null : true;
      const headers = { "content-type": "application/json" };
      if (final) headers["cache-control"] = "public, max-age=31536000, s-maxage=31536000, immutable";
      res.writeHead(200, headers);
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

// offline self-check: decode logic must not silently break.
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
  const R = "0x2222222222222222222222222222222222222222";

  let d = decodeSwap(...mk(U, [swapLog, t(A, U, R, 100n), t(B, R, U, 90n)]));
  assert(d.isSwap && !d.partial, "direct token<->token should be full");
  assert.equal(d.inputs.length, 1, "one input");
  assert.equal(d.inputs[0].token, A.toLowerCase());
  assert.equal(d.outputs[0].raw, 90n);

  d = decodeSwap(...mk(U, [swapLog, t(B, R, U, 90n)], "0xde0b6b3a7640000"));
  assert(!d.partial, "ETH->token should be full");
  assert.equal(d.inputs[0].token, "ETH");

  d = decodeSwap(...mk(U, [swapLog, t(A, U, R, 100n)]));
  assert(d.partial, "token->ETH (invisible output) should be partial");

  d = decodeSwap(...mk(U, [swapLog, t(A, R, "0xdead000000000000000000000000000000000000", 1n)]));
  assert(d.partial, "aggregator with no user legs should be partial");

  d = decodeSwap(...mk(U, [t(A, U, R, 100n)]));
  assert(!d.isSwap, "no Swap event -> not a swap");

  console.log("ok - decode self-check passed");
}

if (process.argv.includes("--test")) test();
else server.listen(3000, () => console.log("http://localhost:3000"));
