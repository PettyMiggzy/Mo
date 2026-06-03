'use strict';
const ALLOWED = ['mojakcto.xyz', 'mojak.xyz', 'monjak.fun', 'localhost', 'vercel.app'];
function originAllowed(req) {
  const o = req.headers.origin || req.headers.referer || '';
  if (!o) return true;
  return ALLOWED.some((d) => o.includes(d));
}
function ip(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'] || 'unknown';
}
// shared sliding-ish limit via Upstash REST. Fails OPEN if not configured.
async function allow(req, bucket, limit = 30, windowSec = 10) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return { ok: true, skipped: true };
  const key = `mojak:${bucket}:${ip(req)}`;
  try {
    const r = await fetch(`${url}/incr/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    const n = j.result;
    if (n === 1) await fetch(`${url}/expire/${encodeURIComponent(key)}/${windowSec}`, { headers: { Authorization: `Bearer ${tok}` } });
    return { ok: n <= limit, count: n };
  } catch (_) { return { ok: true, error: true }; }
}
module.exports = { originAllowed, allow, ip };
