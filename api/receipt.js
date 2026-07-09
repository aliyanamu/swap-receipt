// Vercel serverless function: GET /api/receipt?hash=0x...
const { buildReceipt } = require("../lib");

module.exports = async (req, res) => {
  try {
    const data = await buildReceipt(req.query.hash || "", req.query.chain || "ethereum");
    res.status(200).json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
