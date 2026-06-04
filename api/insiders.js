'use strict';
/*
 * GET /api/insiders?address=0xTOKEN
 *
 * Classifies every wallet that touched a token by HOW it got its tokens —
 * the scam tell isn't who holds, it's who got tokens without ever buying.
 *   buyer   : bought from the pool (paid for it)            🟢
 *   loaded  : got tokens free (transfer in), still holding  🟡 insider sitting on a free bag
 *   dumper  : got free, never bought, then sold to the pool 🔴 dumped on the community
 *   mover   : got free, never bought, sent it onward        🔴 distributing free bags
 * Plus the deployer, the pool/AMM addresses, and a plain verdict.
 */
const L = require('./_lib.js');
const ZERO = '0x0000000000000000000000000000000000000000';

function hexBig(h) { try { return (h && h !== '0x') ? BigInt(h) : 0n; } catch (_) { return 0n; } }

async function rpcBatch(calls, attempt) {
  attempt = attempt || 0;
  try {
    const r = await fetch(L.RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls),
    });
    const a = await r.json();
    if (Array.isArray(a)) return a;
    if (a && a.result !== undefined) return [a];
    throw new Error('bad batch shape');
  } catch (e) {
    if (attempt < 2) { await new Promise((s) => setTimeout(s, 250 * (attempt + 1))); return rpcBatch(calls, attempt + 1); }
    return [];
  }
}

async function buildInsiders(token) {
  token = L.lc(token);

  // 1) transfer history — launch window (asc) + recent window (desc) so we capture
  //    BOTH early snipers and wallets that accumulated later. balanceOf gives the
  //    true current balance; we only need the full SET of addresses that ever held.
  let xfers = [];
  let partial = false;
  async function pullDir(sort, maxPages) {
    const out = [];
    for (let p = 1; p <= maxPages; p++) {
      let r = [];
      try { r = await L.esCall({ module: 'account', action: 'tokentx', contractaddress: token, page: String(p), offset: '10000', sort }); }
      catch (e) { partial = true; break; }
      out.push(...r);
      if (r.length < 10000) return out;     // exhausted this direction
      if (p === maxPages) partial = true;    // more exists beyond what we pulled
    }
    return out;
  }
  const _asc = await pullDir('asc', 2);    // up to 20k from launch
  const _desc = await pullDir('desc', 1);  // up to 10k most recent
  const _seen = new Set();
  for (const t of [..._asc, ..._desc]) {
    const k = (t.hash || '') + '-' + t.from + '-' + t.to + '-' + t.value;
    if (_seen.has(k)) continue;
    _seen.add(k); xfers.push(t);
  }
  if (!xfers.length) {
    const e = new Error('No token transfers found — is this a token contract address?');
    e.code = 'NOTOKEN'; throw e;
  }

  // 2) deployer
  let deployer = null;
  try {
    const cc = await L.esCall({ module: 'contract', action: 'getcontractcreation', contractaddresses: token });
    if (cc && cc[0] && cc[0].contractCreator) deployer = L.lc(cc[0].contractCreator);
  } catch (_) { /* best effort */ }

  // 3) identify pool/AMM: bidirectional, high-degree contracts
  const ins = {}, outs = {};
  for (const t of xfers) { const f = L.lc(t.from), to = L.lc(t.to); outs[f] = (outs[f] || 0) + 1; ins[to] = (ins[to] || 0) + 1; }
  let cand = [...new Set([...Object.keys(ins), ...Object.keys(outs)])]
    .filter((a) => (ins[a] || 0) > 3 && (outs[a] || 0) > 3 && a !== ZERO);
  cand.sort((a, b) => ((ins[b] || 0) + (outs[b] || 0)) - ((ins[a] || 0) + (outs[a] || 0)));
  const top = cand.slice(0, 6);
  const typed = await L.typeAddresses(top);
  const pools = new Set(top.filter((a) => typed[a] === 'contract'));
  const poolsAll = new Set([...pools, ZERO]);

  // 4) per-wallet aggregates
  const agg = {};
  const A = (w) => (agg[w] || (agg[w] = { inPool: 0, outPool: 0, inFree: 0, outFree: 0, firstFrom: null, firstTs: null }));
  for (const t of xfers) {
    const f = L.lc(t.from), to = L.lc(t.to), ts = Number(t.timeStamp) || 0;
    if (!poolsAll.has(to)) { const a = A(to); if (pools.has(f)) a.inPool++; else a.inFree++; if (a.firstTs === null) { a.firstFrom = f; a.firstTs = ts; } }
    if (!poolsAll.has(f)) { const a = A(f); if (pools.has(to)) a.outPool++; else a.outFree++; }
  }
  let wallets = Object.keys(agg).filter((w) => !poolsAll.has(w) && w !== deployer);

  // 5) supply + current balances
  const supRes = await rpcBatch([{ jsonrpc: '2.0', id: 0, method: 'eth_call', params: [{ to: token, data: '0x18160ddd' }, 'latest'] }]);
  const supply = hexBig(supRes[0] && supRes[0].result);
  // cap candidates by on-chain activity so a huge token can't time out the function
  const act = (w) => { const a = agg[w]; return a.inPool + a.outPool + a.inFree + a.outFree; };
  wallets.sort((x, y) => act(y) - act(x));
  if (wallets.length > 300) wallets = wallets.slice(0, 300);
  const bal = {};
  const CHUNK = 20;
  // resolve EVERY wallet's balance — retry the ones that come back empty so results are
  // complete & consistent run-to-run (public RPC drops calls under load).
  let pending = wallets.slice();
  let balPartial = false;
  for (let round = 0; round < 4 && pending.length; round++) {
    const missing = [];
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK);
      const res = await rpcBatch(chunk.map((w, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_call', params: [{ to: token, data: '0x70a08231' + '0'.repeat(24) + w.slice(2) }, 'latest'] })));
      const byId = {};
      for (const c of res) { if (c && c.id != null && c.result) byId[c.id] = c.result; }
      chunk.forEach((w, j) => { if (byId[j] !== undefined) bal[w] = hexBig(byId[j]); else missing.push(w); });
      if (i + CHUNK < pending.length) await new Promise((s) => setTimeout(s, 35));
    }
    pending = missing;
    if (pending.length && round < 3) await new Promise((s) => setTimeout(s, 200));
  }
  if (pending.length) balPartial = true; // couldn't resolve some balances even after retries

  // 6) classify
  const pct = (b) => (supply > 0n ? Number(b * 1000000n / supply) / 10000 : 0);
  const rows = [];
  let buyers = 0;
  for (const w of wallets) {
    const a = agg[w]; const b = bal[w] || 0n;
    const bought = a.inPool > 0, sold = a.outPool > 0, free = a.inFree > 0;
    let cat;
    if (free && !bought) cat = sold ? 'dumper' : (b > 0n ? 'loaded' : 'mover');
    else if (bought) { buyers++; cat = (b > 0n ? 'buyer' : 'exited'); }
    else continue;
    rows.push({ address: w, cat, pct: pct(b), bal: b.toString(), boughtN: a.inPool, soldN: a.outPool, freeN: a.inFree, fromDeployer: a.firstFrom === deployer, firstFrom: a.firstFrom });
  }

  // flag contract holders (staking / LP / treasury / vesting) so they aren't smeared as insider bags
  try {
    const topRows = rows.slice().sort((x, y) => y.pct - x.pct).slice(0, 45);
    const codeRes = await rpcBatch(topRows.map((r, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getCode', params: [r.address, 'latest'] })));
    const cById = {};
    for (const c of codeRes) { if (c && c.id != null) cById[c.id] = c.result; }
    topRows.forEach((r, j) => { const cd = cById[j]; if (cd && cd !== '0x' && cd.length > 4) r.cat = 'contract'; });
  } catch (_) { /* best effort */ }

  const side = rows.filter((r) => r.cat === 'dumper' || r.cat === 'loaded' || r.cat === 'mover');
  const loaded = side.filter((r) => r.cat === 'loaded');
  const dumpers = side.filter((r) => r.cat === 'dumper');
  const byPct = (arr) => arr.slice().sort((x, y) => y.pct - x.pct);
  const sidePct = side.reduce((s, r) => s + r.pct, 0);
  const loadedPct = loaded.reduce((s, r) => s + r.pct, 0);

  // current holders (bal>0) for the bubble map: bought (green) vs got-free insider (red)
  const holders = byPct(rows.filter((r) => { try { return BigInt(r.bal) > 0n; } catch (_) { return false; } }))
    .slice(0, 80)
    .map((r) => ({ address: r.address, pct: r.pct, cat: r.cat, fromDeployer: r.fromDeployer, firstFrom: r.firstFrom }));

  // risk driven by supply actually held by free-bag insiders (forward dump risk), not harmless historical movers
  let risk = 'low';
  if (loadedPct >= 8) risk = 'high';
  else if (loadedPct >= 2.5) risk = 'medium';
  if (risk === 'low' && dumpers.length >= 10) risk = 'medium';

  return {
    token, deployer, pools: [...pools], supply: supply.toString(),
    risk,
    stats: {
      wallets: wallets.length, buyers,
      side: side.length, sidePct: Math.round(sidePct * 100) / 100,
      loaded: loaded.length, loadedPct: Math.round(loadedPct * 100) / 100,
      dumped: dumpers.length,
      transfers: xfers.length, partial: partial || balPartial,
    },
    loaded: byPct(loaded).slice(0, 60),
    dumpers: byPct(dumpers).slice(0, 60),
    side: byPct(side).slice(0, 120),
    holders,
  };
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const address = L.lc((req.query && req.query.address) || '');
  if (!L.isAddress(address)) { res.status(400).json({ error: 'pass ?address=0x… (token contract)' }); return; }
  try {
    const payload = await buildInsiders(address);
    res.status(200).json(payload);
  } catch (err) {
    res.status(err.code === 'NOTOKEN' ? 400 : 502).json({ error: String(err.message || err) });
  }
};

module.exports.buildInsiders = buildInsiders;
