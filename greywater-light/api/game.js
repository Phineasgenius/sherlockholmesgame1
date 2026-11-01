'use strict';
/*
 * The whole backend: one Vercel serverless function.  POST /api/game  { a: "<action>", ... }
 *
 * Environment variables (set in Vercel > Settings > Environment Variables):
 *   SESSION_SECRET             long random string, signs login tokens
 *   ADMIN_USER / ADMIN_PASS    organiser login (never shipped to the browser)
 *   SUPABASE_URL               https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  service_role key (server only, NOT the anon key)
 * Without the Supabase variables the function falls back to an in-memory store (local demo only).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { LEVELS, HINT_PENALTY_MIN, FINAL_CODE, GAME_TITLE } = require('./_levels');

const scrypt = promisify(crypto.scrypt);
const TOTAL = LEVELS.length;
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const SECRET = process.env.SESSION_SECRET || (IS_PROD ? '' : crypto.randomBytes(32).toString('hex'));

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };

/* ------------------------------------------------------------------ storage */
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
let sb = null;
if (useSupabase) {
  sb = require('@supabase/supabase-js').createClient(
    process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
const must = ({ data, error }) => { if (error) { console.error('db error', error); fail(500, 'Database error'); } return data; };

const RESET = {
  level: 0, started_at: null, last_solve_at: null, finished_at: null, hints_used: 0,
  level_hints: 0, attempts: 0, wrong_attempts: 0, last_attempt_at: null, solve_times: []
};

const mem = global.__huntMem || (global.__huntMem = { players: new Map(), settings: { hunt_open: true, announcement: '' } });

const store = useSupabase ? {
  async byName(lower) { return must(await sb.from('players').select('*').eq('username_lower', lower).maybeSingle()); },
  async byId(id) { return must(await sb.from('players').select('*').eq('id', id).maybeSingle()); },
  async insert(row) { return must(await sb.from('players').insert(row).select().single()); },
  async update(id, patch, cond) {
    let q = sb.from('players').update(patch).eq('id', id);
    for (const k of Object.keys(cond || {})) q = q.eq(k, cond[k]);
    return must(await q.select().maybeSingle());
  },
  async all() { return must(await sb.from('players').select('*').limit(5000)) || []; },
  async remove(id) { must(await sb.from('players').delete().eq('id', id)); },
  async settings() { return must(await sb.from('settings').select('*').eq('id', 1).maybeSingle()) || { hunt_open: true, announcement: '' }; },
  async setSettings(patch) { must(await sb.from('settings').upsert({ id: 1, ...patch })); }
} : {
  async byName(lower) { return [...mem.players.values()].find(p => p.username_lower === lower) || null; },
  async byId(id) { return mem.players.get(id) || null; },
  async insert(row) {
    const p = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...RESET, solve_times: [], ...row };
    mem.players.set(p.id, p); return p;
  },
  async update(id, patch, cond) {
    const p = mem.players.get(id); if (!p) return null;
    for (const k of Object.keys(cond || {})) if (p[k] !== cond[k]) return null;
    Object.assign(p, patch); return p;
  },
  async all() { return [...mem.players.values()]; },
  async remove(id) { mem.players.delete(id); },
  async settings() { return { ...mem.settings }; },
  async setSettings(patch) { Object.assign(mem.settings, patch); }
};

/* ------------------------------------------------------------------ crypto helpers */
const b64u = b => Buffer.from(b).toString('base64url');
function sign(payload) {
  if (!SECRET) fail(500, 'Server is missing SESSION_SECRET');
  const body = b64u(JSON.stringify(payload));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(token) {
  if (!SECRET || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
async function hashPw(pw, salt) { return (await scrypt(pw, salt, 64)).toString('hex'); }

const hits = new Map(); // tiny in-memory brute-force limiter (best effort on serverless)
function limited(key, max) { const h = hits.get(key); return !!h && h.t > Date.now() && h.n >= max; }
function strike(key, windowMs) {
  const h = hits.get(key);
  if (!h || h.t < Date.now()) hits.set(key, { n: 1, t: Date.now() + windowMs }); else h.n++;
}

/* ------------------------------------------------------------------ game helpers */
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const assetCache = new Map();
function asset(file) {
  if (!assetCache.has(file)) {
    const buf = fs.readFileSync(path.join(__dirname, '_assets', file));
    assetCache.set(file, 'data:image/png;base64,' + buf.toString('base64'));
  }
  return assetCache.get(file);
}
function levelPayload(idx, hintsBought) {
  const L = LEVELS[idx];
  return {
    n: idx + 1, title: L.title, story: L.story,
    blocks: L.blocks.map(b => b.kind === 'lab' ? { kind: 'lab', src: asset(b.asset), tools: b.tools } : b),
    hints_total: L.hints.length, hints: L.hints.slice(0, hintsBought)
  };
}
function adjMs(p) {
  if (!p.started_at || !p.last_solve_at) return null;
  return Date.parse(p.last_solve_at) - Date.parse(p.started_at) + (p.hints_used || 0) * HINT_PENALTY_MIN * 60000;
}
function ranked(players) {
  const rows = players.filter(p => p.started_at).map(p => ({ p, ms: adjMs(p) }));
  rows.sort((x, y) => (y.p.level - x.p.level)
    || ((x.ms ?? Infinity) - (y.ms ?? Infinity))
    || (Date.parse(x.p.started_at) - Date.parse(y.p.started_at)));
  return rows;
}
async function stateFor(p) {
  const s = await store.settings();
  const finished = p.level >= TOTAL;
  const live = !!p.started_at && s.hunt_open && !finished;
  const rows = ranked(await store.all());
  const idx = rows.findIndex(r => r.p.id === p.id);
  return {
    game: GAME_TITLE, user: p.username, total: TOTAL, level: p.level, finished,
    started_at: p.started_at, finished_at: p.finished_at, last_solve_at: p.last_solve_at,
    hints_used: p.hints_used, hint_penalty_min: HINT_PENALTY_MIN, server_now: Date.now(),
    hunt_open: !!s.hunt_open, announcement: s.announcement || '',
    time_ms: adjMs(p), rank: idx >= 0 ? idx + 1 : null, players: rows.length,
    final_code: finished ? FINAL_CODE : null,
    current: live ? levelPayload(p.level, p.level_hints) : null,
    journal: LEVELS.slice(0, p.level).map((L, i) => ({ n: i + 1, title: L.title, answer: L.answers[0] }))
  };
}

/* ------------------------------------------------------------------ auth plumbing */
function who(req) {
  const h = req.headers['authorization'] || '';
  return verify(h.startsWith('Bearer ') ? h.slice(7) : '');
}
async function needPlayer(req) {
  const t = who(req);
  if (!t || t.r !== 'p') fail(401, 'Please sign in again.');
  const p = await store.byId(t.id);
  if (!p) fail(401, 'This account no longer exists.');
  return p;
}
function needAdmin(req) {
  const t = who(req);
  if (!t || t.r !== 'a') fail(401, 'Organiser sign-in required.');
}
const ip = req => ((req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || 'x';
const lbRow = ({ p, ms }, i) => ({
  rank: i + 1, username: p.username, solved: p.level, finished: p.level >= TOTAL,
  time_ms: ms, hints: p.hints_used, last_solve_at: p.last_solve_at
});

/* ------------------------------------------------------------------ actions */
const ACTIONS = {
  async register({ req, body }) {
    const name = String(body.username || '').trim(), pw = String(body.password || '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) fail(400, 'Username must be 3-20 letters, numbers or underscores.');
    if (pw.length < 6 || pw.length > 100) fail(400, 'Password must be at least 6 characters.');
    if (ADMIN_USER && name.toLowerCase() === ADMIN_USER.toLowerCase()) fail(409, 'That username is taken.');
    if (limited('reg:' + ip(req), 20)) fail(429, 'Too many sign-ups from this network. Try later.');
    if (await store.byName(name.toLowerCase())) fail(409, 'That username is taken.');
    strike('reg:' + ip(req), 3600e3);
    const salt = crypto.randomBytes(16).toString('hex');
    let p;
    try {
      p = await store.insert({ username: name, username_lower: name.toLowerCase(), pass_salt: salt, pass_hash: await hashPw(pw, salt) });
    } catch (e) { fail(409, 'That username is taken.'); }
    return { token: sign({ r: 'p', id: p.id, exp: Date.now() + 7 * 864e5 }), state: await stateFor(p) };
  },

  async login({ req, body }) {
    const name = String(body.username || '').trim().toLowerCase(), pw = String(body.password || '');
    const key = 'login:' + ip(req);
    if (limited(key, 10)) fail(429, 'Too many attempts. Wait a few minutes.');
    const p = name && name.length < 40 && pw.length < 200 ? await store.byName(name) : null;
    const ok = p && crypto.timingSafeEqual(Buffer.from(await hashPw(pw, p.pass_salt)), Buffer.from(p.pass_hash));
    if (!ok) { strike(key, 600e3); fail(401, 'Wrong username or password.'); }
    return { token: sign({ r: 'p', id: p.id, exp: Date.now() + 7 * 864e5 }), state: await stateFor(p) };
  },

  async admin_login({ req, body }) {
    if (!ADMIN_USER || !ADMIN_PASS) fail(503, 'Organiser login is not configured on the server.');
    const key = 'admin:' + ip(req);
    if (limited(key, 5)) fail(429, 'Too many attempts. Wait a few minutes.');
    const ok = safeEq(body.username || '', ADMIN_USER) & safeEq(body.password || '', ADMIN_PASS);
    if (!ok) { strike(key, 600e3); fail(401, 'Wrong organiser credentials.'); }
    return { token: sign({ r: 'a', exp: Date.now() + 12 * 3600e3 }) };
  },

  async me({ req }) { return { state: await stateFor(await needPlayer(req)) }; },

  async begin({ req }) {
    const p = await needPlayer(req);
    const s = await store.settings();
    if (!s.hunt_open) fail(403, 'The hunt is not open yet.');
    const q = p.started_at ? p : await store.update(p.id, { started_at: new Date().toISOString() });
    return { state: await stateFor(q) };
  },

  async submit({ req, body }) {
    const p = await needPlayer(req);
    const s = await store.settings();
    if (!s.hunt_open) fail(403, 'The hunt is paused right now.');
    if (!p.started_at) fail(400, 'Start the hunt first.');
    if (p.level >= TOTAL) fail(400, 'You have already finished.');
    const now = Date.now();
    if (p.last_attempt_at && now - Date.parse(p.last_attempt_at) < 1500) fail(429, 'Slow down. One guess every couple of seconds.');
    const guess = norm(body.answer);
    if (!guess || guess.length > 80) fail(400, 'Type an answer first.');
    const L = LEVELS[p.level];
    const iso = new Date(now).toISOString();
    if (!L.answers.some(a => norm(a) === guess)) {
      await store.update(p.id, { attempts: p.attempts + 1, wrong_attempts: p.wrong_attempts + 1, last_attempt_at: iso });
      return { ok: false, message: 'Not the word. Look again.' };
    }
    const done = p.level + 1 >= TOTAL;
    const q = await store.update(p.id, {
      level: p.level + 1, level_hints: 0, attempts: p.attempts + 1, last_attempt_at: iso, last_solve_at: iso,
      finished_at: done ? iso : null, solve_times: [...(p.solve_times || []), iso]
    }, { level: p.level });
    if (!q) return { ok: false, message: 'Your progress changed in another tab. Reloading.', state: await stateFor(await store.byId(p.id)) };
    return { ok: true, finished: done, state: await stateFor(q) };
  },

  async hint({ req }) {
    const p = await needPlayer(req);
    const s = await store.settings();
    if (!s.hunt_open || !p.started_at || p.level >= TOTAL) fail(400, 'No hints available right now.');
    if (p.level_hints >= LEVELS[p.level].hints.length) fail(400, 'No more hints for this level.');
    const q = await store.update(p.id, { level_hints: p.level_hints + 1, hints_used: p.hints_used + 1 },
      { level: p.level, level_hints: p.level_hints });
    return { state: await stateFor(q || await store.byId(p.id)) };
  },

  async leaderboard() {
    const rows = ranked(await store.all());
    const s = await store.settings();
    return { total: TOTAL, hint_penalty_min: HINT_PENALTY_MIN, hunt_open: !!s.hunt_open, now: Date.now(),
      rows: rows.slice(0, 200).map(lbRow) };
  },

  /* ---- organiser ---- */
  async admin_data({ req }) {
    needAdmin(req);
    const all = await store.all();
    const rows = ranked(all).map(lbRow);
    const byName = new Map(all.map(p => [p.username, p]));
    const waiting = all.filter(p => !p.started_at).map(p => ({ id: p.id, username: p.username, created_at: p.created_at }));
    const s = await store.settings();
    return {
      total: TOTAL, now: Date.now(), settings: { hunt_open: !!s.hunt_open, announcement: s.announcement || '' },
      registered: all.length,
      finished: all.filter(p => p.level >= TOTAL).length,
      players: rows.map(r => { const p = byName.get(r.username); return { ...r, id: p.id, attempts: p.attempts,
        wrong: p.wrong_attempts, started_at: p.started_at, last_attempt_at: p.last_attempt_at, splits: p.solve_times || [] }; }),
      waiting
    };
  },
  async admin_levels({ req }) {
    needAdmin(req);
    return { levels: LEVELS.map((L, i) => ({ n: i + 1, title: L.title, answers: L.answers, hints: L.hints.length })) };
  },
  async admin_reset({ req, body }) {
    needAdmin(req);
    if (!(await store.byId(body.id))) fail(404, 'No such player.');
    await store.update(body.id, RESET); return { ok: true };
  },
  async admin_delete({ req, body }) {
    needAdmin(req); await store.remove(body.id); return { ok: true };
  },
  async admin_settings({ req, body }) {
    needAdmin(req);
    const patch = {};
    if (typeof body.hunt_open === 'boolean') patch.hunt_open = body.hunt_open;
    if (typeof body.announcement === 'string') patch.announcement = body.announcement.slice(0, 300);
    await store.setSettings(patch);
    const s = await store.settings();
    return { settings: { hunt_open: !!s.hunt_open, announcement: s.announcement || '' } };
  }
};

module.exports = async function handler(req, res) {
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.a) ? ACTIONS[body.a] : null;
  if (!fn) return send(400, { error: 'Unknown action' });
  try { send(200, await fn({ req, body })); }
  catch (e) {
    if (e instanceof HttpError) return send(e.code, { error: e.message });
    console.error(e); send(500, { error: 'Something went wrong on the server.' });
  }
};
