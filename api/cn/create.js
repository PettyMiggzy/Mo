'use strict';
const { originAllowed, allow } = require('../_rl.js');
const CN = 'https://api.changenow.io/v2';
module.exports = async (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const rl = await allow(req, 'create', 15, 60); if (!rl.ok) return res.status(429).json({ error: 'slow down' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  if (!b) b = {};
  for (const f of ['fromCurrency', 'toCurrency', 'fromAmount', 'address']) if (!b[f]) return res.status(400).json({ error: 'missing ' + f });
  if (!(Number(b.fromAmount) > 0)) return res.status(400).json({ error: 'bad amount' });
  if (typeof b.address !== 'string' || b.address.length < 16 || b.address.length > 130) return res.status(400).json({ error: 'bad destination address' });
  const payload = {
    fromCurrency: String(b.fromCurrency), toCurrency: String(b.toCurrency),
    fromNetwork: b.fromNetwork ? String(b.fromNetwork) : undefined,
    toNetwork: b.toNetwork ? String(b.toNetwork) : undefined,
    fromAmount: String(b.fromAmount), address: String(b.address), flow: 'standard', type: 'direct',
  };
  if (b.extraId) payload.extraId = String(b.extraId);
  try {
    const r = await fetch(`${CN}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-changenow-api-key': process.env.CHANGENOW_API_KEY || '' }, body: JSON.stringify(payload) });
    const d = await r.json();
    const safe = { id: d.id, payinAddress: d.payinAddress, payinExtraId: d.payinExtraId ?? null, fromCurrency: d.fromCurrency, toCurrency: d.toCurrency, fromAmount: d.fromAmount, toAmount: d.toAmount, payoutAddress: d.payoutAddress, status: d.status, ...(d.error ? { error: d.error, message: d.message } : {}) };
    return res.status(r.status).json(safe);
  } catch (_) { return res.status(502).json({ error: 'upstream unavailable' }); }
};
