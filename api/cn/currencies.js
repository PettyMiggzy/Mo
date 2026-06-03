'use strict';
const { originAllowed, allow } = require('../_rl.js');
const CN = 'https://api.changenow.io/v2';
module.exports = async (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const rl = await allow(req, 'cur', 60, 10); if (!rl.ok) return res.status(429).json({ error: 'slow down' });
  try {
    const r = await fetch(`${CN}/exchange/currencies?active=true&flow=standard`, { headers: { 'x-changenow-api-key': process.env.CHANGENOW_API_KEY || '' } });
    const data = await r.json();
    res.setHeader('cache-control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(r.status).json(data);
  } catch (_) { return res.status(502).json({ error: 'upstream unavailable' }); }
};
