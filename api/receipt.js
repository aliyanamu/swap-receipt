// Vercel serverless function.
//   GET /api/receipt?hash=0x...            -> fast receipt (gas, tokens, slippage)
//   GET /api/receipt?hash=0x...&sandwich=1 -> slow binary sandwich flag (Dune)
// Confirmed results are immutable (a mined tx never changes) -> cache forever in
// the browser AND Vercel's CDN, so repeats never re-hit the function or Dune.
// Only final answers are cached: "not found" / sandwiched:null stay uncached so
// they can resolve later.
const { buildReceipt, checkSandwich } = require("../lib");

const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";

module.exports = async (req, res) => {
  const hash = req.query.hash || "";
  try {
    if (req.query.sandwich) {
      const sandwiched = await checkSandwich(hash);
      if (sandwiched !== null) res.setHeader("cache-control", IMMUTABLE);
      res.status(200).json({ hash, sandwiched });
    } else {
      const data = await buildReceipt(hash, req.query.chain || "ethereum");
      res.setHeader("cache-control", IMMUTABLE); // success = a real mined receipt = final
      res.status(200).json(data);
    }
  } catch (e) {
    // errors (not-found may mine later, reverted, bad hash) — never cache
    res.status(400).json({ error: e.message });
  }
};
