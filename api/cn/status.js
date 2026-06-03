'use strict';
const { originAllowed, allow } = require('../_rl.js');
const CN = 'https://api.changenow.io/v2';
module.exports = async (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const rl = await allow(req, 'status', 60, 10); if (!rl.ok) return res.status(429).json({ error: 'slow down' });
  const id = (req.query || {}).id; if (!id) return res.status(400).json({ error: 'missing id' });
  try {
    const r = await fetch(`${CN}/exchange/by-id?id=${encodeURIComponent(id)}`, { headers: { 'x-changenow-api-key': process.env.CHANGENOW_API_KEY || '' } });
    const d = await r.json();
    return res.status(r.status).json({ id: d.id, status: d.status, payinAddress: d.payinAddress, payinExtraId: d.payinExtraId ?? null, amountFrom: d.amountFrom, amountTo: d.expectedAmountTo ?? d.amountTo, payoutHash: d.payoutHash || null });
  } catch (_) { return res.status(502).json({ error: 'upstream unavailable' }); }
};
