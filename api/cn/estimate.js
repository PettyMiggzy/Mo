'use strict';
const { originAllowed, allow } = require('../_rl.js');
const CN = 'https://api.changenow.io/v2';
module.exports = async (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const rl = await allow(req, 'est', 40, 10); if (!rl.ok) return res.status(429).json({ error: 'slow down' });
  const q = req.query || {};
  if (!q.fromCurrency || !q.toCurrency || !q.fromAmount) return res.status(400).json({ error: 'missing params' });
  const p = new URLSearchParams({ fromCurrency: q.fromCurrency, toCurrency: q.toCurrency, fromAmount: String(q.fromAmount), flow: 'standard', type: 'direct' });
  if (q.fromNetwork) p.set('fromNetwork', q.fromNetwork);
  if (q.toNetwork) p.set('toNetwork', q.toNetwork);
  try {
    const r = await fetch(`${CN}/exchange/estimated-amount?${p}`, { headers: { 'x-changenow-api-key': process.env.CHANGENOW_API_KEY || '' } });
    const d = await r.json();
    return res.status(r.status).json(d);
  } catch (_) { return res.status(502).json({ error: 'upstream unavailable' }); }
};
