// Swap Receipt — shared decode + fetch logic (used by both api/receipt.js and server.js).
// No API keys: public RPC for the receipt, DefiLlama for symbol/decimals/price.
//
// ponytail: net-balance heuristic. token<->token and ETH->token decode fully;
// token->ETH and aggregator swaps hide the ETH output in an internal transfer,
// so they degrade to gas-exact + partial legs. Add trace_transaction only if
// that case turns out to matter — the plan forbids full router decoding.

const RPC = process.env.RPC || "https://ethereum-rpc.publicnode.com";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SWAP_V3 = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const SWAP_V2 = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

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
const human = (raw, decimals) => Number(raw) / 10 ** decimals;
const sum = (legs) => legs.reduce((a, l) => (l.usd != null ? a + l.usd : a), 0) || null;

// pure decode: receipt + tx -> {isSwap, user, inputs, outputs, partial}.
// inputs/outputs are [{token, raw}] where token is a lowercase address or "ETH".
function decodeSwap(receipt, tx) {
  const isSwap = receipt.logs.some(
    (l) => l.topics[0] === SWAP_V3 || l.topics[0] === SWAP_V2
  );
  const user = receipt.from.toLowerCase();
  const net = {};
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

async function buildReceipt(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Not a valid tx hash.");
  const [receipt, tx] = await Promise.all([
    rpc("eth_getTransactionReceipt", [hash]),
    rpc("eth_getTransactionByHash", [hash]),
  ]);
  if (!receipt) throw new Error("Transaction not found (or not yet mined).");
  if (receipt.status === "0x0") throw new Error("This transaction reverted (failed).");

  const gasEth = human(
    BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice),
    18
  );
  const decoded = decodeSwap(receipt, tx);
  if (!decoded.isSwap)
    return {
      hash,
      isSwap: false,
      gasEth,
      note: "This doesn't look like a DEX swap — no Swap event found.",
    };

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

module.exports = { buildReceipt, decodeSwap, TRANSFER, SWAP_V3, SWAP_V2 };
