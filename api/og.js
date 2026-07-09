// OG card: 1200x630 PNG summarizing a swap, including the sandwich verdict.
// Node runtime so it reuses lib.js (buildReceipt/checkSandwich).
// checkSandwich is cached; worst case ~9s live — see spike note on crawler timeouts.
const { ImageResponse } = require("@vercel/og");
const { buildReceipt, checkSandwich } = require("../lib");

const h = (type, style, children) => ({ type, props: { style, children } });
const usd = (n) => (n == null ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

module.exports = async (req, res) => {
  const hash = req.query.hash || "";
  const chain = req.query.chain || "ethereum";
  let d = null, sandwiched = null;
  try {
    [d, sandwiched] = await Promise.all([
      buildReceipt(hash, chain).catch(() => null),
      checkSandwich(hash),
    ]);
  } catch { /* fall through to a generic card */ }

  const pair = d && d.isSwap
    ? `${(d.inputs[0] || {}).symbol || "?"} → ${(d.outputs[0] || {}).symbol || "?"}`
    : "";
  const slip = d && d.slippagePct != null ? `est. slippage ${d.slippagePct.toFixed(1)}%` : null;
  const footer = [d && `Gas ${usd(d.gasUsd)}`, slip].filter(Boolean).join("  ·  ")
    || "on-chain swap post-mortem";

  let headline, sub, color;
  if (sandwiched === true) {
    headline = "You got sandwiched."; color = "#ff5a5f";
    sub = `An MEV bot front-ran and back-ran this ${pair || "swap"}. Avoidable with MEV Blocker.`;
  } else if (d && d.isSwap) {
    headline = pair || "Swap receipt"; color = "#4ade80";
    sub = sandwiched === false ? "No sandwich attack detected on this swap." : "Swap post-mortem.";
  } else {
    headline = "Swap Receipt"; color = "#c3c9d4";
    sub = "Paste a swap tx hash for a plain-English post-mortem.";
  }

  const el = h("div", {
    height: "100%", width: "100%", display: "flex", flexDirection: "column",
    background: "#0b0d10", color: "#fff", padding: 60, justifyContent: "space-between",
    fontFamily: "sans-serif",
  }, [
    h("div", { display: "flex", fontSize: 30, color: "#8a94a6" }, "swap-receipt.vercel.app"),
    h("div", { display: "flex", flexDirection: "column" }, [
      h("div", { display: "flex", fontSize: 82, fontWeight: 700, color }, headline),
      h("div", { display: "flex", fontSize: 34, color: "#c3c9d4", marginTop: 20 }, sub),
    ]),
    h("div", { display: "flex", fontSize: 30, color: "#8a94a6" }, footer),
  ]);

  const img = new ImageResponse(el, { width: 1200, height: 630 });
  const buf = Buffer.from(await img.arrayBuffer());
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
  res.end(buf);
};
