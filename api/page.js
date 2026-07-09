// Serves /tx/<chain>/<hash> as HTML with per-tx OG meta tags so shared links
// unfurl with a card. Humans get the same app (index.html) + hydration via its
// existing client JS. Crawlers read the injected <meta> in <head>.
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

module.exports = (req, res) => {
  const p = req.url.split("?")[0].replace(/^\/tx\//, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [chain, hash] = p.length > 1 ? p : ["ethereum", p[0] || ""];
  const img = `https://${req.headers.host}/api/og?chain=${esc(chain)}&hash=${esc(hash)}`;
  const meta = `
<meta property="og:title" content="Swap Receipt — did you get sandwiched?" />
<meta property="og:description" content="Plain-English post-mortem for this swap: gas, slippage, and a sandwich check." />
<meta property="og:image" content="${img}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${img}" />`;
  const html = HTML.replace("<title>Swap Receipt</title>", `<title>Swap Receipt</title>${meta}`);
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
};
