// Vercel serverless function.
//   GET /api/receipt?hash=0x...            -> fast receipt (gas, tokens, slippage)
//   GET /api/receipt?hash=0x...&sandwich=1 -> slow binary sandwich flag (Dune)
const { buildReceipt, checkSandwich } = require("../lib");

module.exports = async (req, res) => {
  const hash = req.query.hash || "";
  try {
    if (req.query.sandwich) {
      const sandwiched = await checkSandwich(hash);
      res.status(200).json({ hash, sandwiched });
    } else {
      res.status(200).json(await buildReceipt(hash, req.query.chain || "ethereum"));
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
