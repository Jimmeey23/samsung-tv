// Samsung TV bridge: serves the mobile web app and relays commands to the TV.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const CONFIG_FILE = path.join(__dirname, 'config.json');
const APP_NAME = Buffer.from('Web Remote').toString('base64');

let config = { ip: process.env.TV_IP || '', mac: process.env.TV_MAC || '', token: '' };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {}
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// ---------- TV websocket ----------
let sock = null;
let ready = false;
let connecting = null;

function connectTV() {
  if (ready && sock) return Promise.resolve();
  if (connecting) return connecting;
  if (!config.ip) return Promise.reject(new Error('TV IP not set'));
  connecting = new Promise((resolve, reject) => {
    const tok = config.token ? `&token=${config.token}` : '';
    const url = `wss://${config.ip}:8002/api/v2/channels/samsung.remote.control?name=${APP_NAME}${tok}`;
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 });
    const timer = setTimeout(() => { ws.terminate(); fail(new Error('Timed out — accept the prompt on the TV, then retry')); }, 30000);
    const fail = (e) => { clearTimeout(timer); connecting = null; ready = false; reject(e); };
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.event === 'ms.channel.connect') {
        clearTimeout(timer);
        if (msg.data?.token && msg.data.token !== config.token) { config.token = msg.data.token; saveConfig(); }
        sock = ws; ready = true; connecting = null; resolve();
      } else if (msg.event === 'ms.channel.unauthorized') {
        fail(new Error('Unauthorized — allow this device on the TV'));
      }
    });
    ws.on('error', fail);
    ws.on('close', () => { ready = false; sock = null; connecting = null; });
  });
  return connecting;
}

async function send(payload) {
  await connectTV();
  sock.send(JSON.stringify(payload));
}

const keyPayload = (key, cmd = 'Click') => ({
  method: 'ms.remote.control',
  params: { Cmd: cmd, DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
});

// ---------- helpers ----------
function wakeOnLan(mac) {
  return new Promise((resolve, reject) => {
    const hex = mac.replace(/[^0-9a-f]/gi, '');
    if (hex.length !== 12) return reject(new Error('Invalid MAC'));
    const m = Buffer.from(hex, 'hex');
    const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
    const s = dgram.createSocket('udp4');
    s.once('listening', () => s.setBroadcast(true));
    s.bind(() => {
      let n = 0;
      const blast = () => s.send(pkt, 9, '255.255.255.255', (e) => {
        if (e) { s.close(); return reject(e); }
        if (++n < 5) setTimeout(blast, 100); else { s.close(); resolve(); }
      });
      blast();
    });
  });
}

async function tvRest(method, p) {
  const ctl = AbortSignal.timeout(4000);
  const r = await fetch(`http://${config.ip}:8001/api/v2/${p}`, { method, signal: ctl });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: r.ok, body: t }; }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const readBody = (req) => new Promise((res) => {
  let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } });
});

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const routes = {
  'GET /api/status': async () => {
    let info = null;
    if (config.ip) { try { info = (await tvRest('GET', '')).device || null; } catch {} }
    return { ip: config.ip, mac: config.mac, paired: !!config.token, connected: ready, online: !!info, info };
  },
  'POST /api/config': async (b) => {
    if (b.ip !== undefined) { if (b.ip !== config.ip) { config.token = ''; sock?.close(); } config.ip = String(b.ip).trim(); }
    if (b.mac !== undefined) config.mac = String(b.mac).trim();
    saveConfig();
    return { ok: true };
  },
  'POST /api/pair': async () => { await connectTV(); return { ok: true, paired: !!config.token }; },
  'POST /api/key': async (b) => {
    if (!/^KEY_[A-Z0-9_]+$/.test(b.key || '')) throw new Error('Bad key');
    const cmd = ['Press', 'Release', 'Click'].includes(b.cmd) ? b.cmd : 'Click';
    await send(keyPayload(b.key, cmd));
    return { ok: true };
  },
  'POST /api/text': async (b) => {
    await send({ method: 'ms.remote.control', params: { Cmd: Buffer.from(String(b.text || '')).toString('base64'), DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' } });
    return { ok: true };
  },
  'POST /api/move': async (b) => {
    const x = Math.round(Number(b.x) || 0), y = Math.round(Number(b.y) || 0);
    await send({ method: 'ms.remote.control', params: { Cmd: 'Move', Position: { x, y, Time: String(Date.now()) }, TypeOfRemote: 'ProcessMouseDevice' } });
    return { ok: true };
  },
  'POST /api/click': async () => {
    await send({ method: 'ms.remote.control', params: { Cmd: 'LeftClick', TypeOfRemote: 'ProcessMouseDevice' } });
    return { ok: true };
  },
  'POST /api/app': async (b) => {
    if (!/^[\w.]+$/.test(b.appId || '')) throw new Error('Bad appId');
    try { await tvRest('POST', `applications/${b.appId}`); }
    catch { await send({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId: b.appId, action_type: 'DEEP_LINK' } } }); }
    return { ok: true };
  },
  'POST /api/browser': async (b) => {
    const url = String(b.url || '');
    if (!/^https?:\/\//.test(url)) throw new Error('URL must start with http(s)://');
    await send({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId: 'org.tizen.browser', action_type: 'NATIVE_LAUNCH', metaTag: url } } });
    return { ok: true };
  },
  'POST /api/wake': async () => {
    if (!config.mac) throw new Error('Set TV MAC address in settings');
    await wakeOnLan(config.mac);
    return { ok: true };
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try { json(res, 200, await handler(req.method === 'POST' ? await readBody(req) : {})); }
    catch (e) { json(res, 500, { error: e.message }); }
    return;
  }
  let file = path.normalize(path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Samsung remote running → http://localhost:${PORT}  (open from phone via this Mac's LAN IP)`);
});
