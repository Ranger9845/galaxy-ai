/**
 * Galaxy AI - Main Server
 * Run: node server.js
 * Then open the URL printed below from any device on your network.
 */

require('dotenv').config({ path: require('path').join(require('./agent/config').DATA_DIR, '.env') });
// Also try local .env (dev mode)
require('dotenv').config();

const express  = require('express');
const { WebSocketServer } = require('ws');
const http     = require('http');
const path     = require('path');
const os       = require('os');

const { PUBLIC_DIR } = require('./agent/config');
const { requestPermissions }      = require('./agent/permissions');
const { takeScreenshot }          = require('./agent/screen');
const { executeAction }           = require('./agent/control');
const { chat }                    = require('./agent/ai');
const { remember, forget, loadMemory, loadProfile, saveProfile, buildContextString } = require('./agent/memory');

const PORT          = parseInt(process.env.PORT) || 3000;
const STREAM_FPS    = parseFloat(process.env.STREAM_FPS) || 2;
const EDEN_KEY      = process.env.EDEN_AI_KEY || '';
const EDEN_PROVIDER = process.env.EDEN_AI_PROVIDER || 'openai/gpt-4o';

// Express
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// REST API

app.get('/api/status', (req, res) => {
  const profile = loadProfile();
  res.json({
    status: 'ok',
    name: 'Galaxy AI',
    version: '1.1.0',
    hasApiKey: !!(EDEN_KEY && EDEN_KEY !== 'your_eden_ai_key_here'),
    hasProfile: !!profile,
    provider: EDEN_PROVIDER,
    userName: profile ? profile.name : null
  });
});

app.get('/api/profile', (req, res) => {
  res.json(loadProfile() || {});
});

app.post('/api/profile', (req, res) => {
  const updated = saveProfile(req.body);
  res.json({ ok: true, profile: updated });
});

app.get('/api/memory', (req, res) => {
  res.json(loadMemory());
});

app.post('/api/memory', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  const mem = remember(key, value);
  res.json({ ok: true, memory: mem });
});

app.delete('/api/memory/:key', (req, res) => {
  const mem = forget(decodeURIComponent(req.params.key));
  res.json({ ok: true, memory: mem });
});

// WS helper
function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

// WebSocket
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log('[ws] Connected: ' + ip);

  let streamInterval = null;
  const history = [];

  const profile = loadProfile();
  send(ws, {
    type: 'status',
    hasApiKey:  !!(EDEN_KEY && EDEN_KEY !== 'your_eden_ai_key_here'),
    hasProfile: !!profile,
    userName:   profile ? profile.name : null,
    provider:   EDEN_PROVIDER
  });

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      case 'chat': {
        send(ws, { type: 'thinking', text: 'Galaxy is thinking...' });

        const screenshot = await takeScreenshot();
        const aiResp = await chat(msg.text, screenshot, history, EDEN_KEY, EDEN_PROVIDER);

        history.push({ role: 'user',      content: msg.text });
        history.push({ role: 'assistant', content: aiResp.message });
        if (history.length > 40) history.splice(0, 2);

        if (aiResp.remember && aiResp.remember.length) {
          for (const entry of aiResp.remember) {
            if (entry.key && entry.value !== undefined) {
              remember(entry.key, String(entry.value));
            }
          }
          send(ws, { type: 'memory_saved', entries: aiResp.remember });
        }

        send(ws, {
          type:     'message',
          role:     'galaxy',
          content:  aiResp.message,
          thinking: aiResp.thinking
        });

        if (aiResp.actions && aiResp.actions.length) {
          send(ws, { type: 'actions_start', count: aiResp.actions.length });

          for (let i = 0; i < aiResp.actions.length; i++) {
            const action = aiResp.actions[i];
            send(ws, { type: 'action_executing', action, index: i });

            if (action.type === 'screenshot') {
              const fresh = await takeScreenshot();
              send(ws, { type: 'screenshot', data: fresh });

            } else if (action.type === 'remember') {
              remember(action.key, String(action.value));
              send(ws, { type: 'memory_saved', entries: [{ key: action.key, value: action.value }] });

            } else if (action.type === 'forget') {
              forget(action.key);
              send(ws, { type: 'memory_updated' });

            } else if (action.type === 'update_profile') {
              saveProfile({ [action.field]: action.value });
              send(ws, { type: 'profile_updated' });

            } else {
              const result = await executeAction(action);
              send(ws, { type: 'action_done', action, result, index: i });
              await new Promise(r => setTimeout(r, 120));
            }
          }

          const finalShot = await takeScreenshot();
          send(ws, { type: 'screenshot', data: finalShot });
          send(ws, { type: 'actions_done' });
        }
        break;
      }

      case 'screenshot': {
        const shot = await takeScreenshot();
        send(ws, { type: 'screenshot', data: shot });
        break;
      }

      case 'stream_start': {
        if (streamInterval) clearInterval(streamInterval);
        const fps = Math.min(msg.fps || STREAM_FPS, 10);
        streamInterval = setInterval(async () => {
          if (ws.readyState !== 1) return;
          const shot = await takeScreenshot();
          if (shot) send(ws, { type: 'screenshot', data: shot });
        }, Math.round(1000 / fps));
        send(ws, { type: 'stream_started', fps });
        break;
      }

      case 'stream_stop': {
        if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
        send(ws, { type: 'stream_stopped' });
        break;
      }

      case 'control': {
        const result = await executeAction(msg.action);
        send(ws, { type: 'control_result', action: msg.action, result });
        const shot = await takeScreenshot();
        send(ws, { type: 'screenshot', data: shot });
        break;
      }

      case 'save_profile': {
        const saved = saveProfile(msg.profile);
        send(ws, { type: 'profile_saved', profile: saved });
        break;
      }

      case 'remember': {
        remember(msg.key, msg.value);
        send(ws, { type: 'memory_saved', entries: [{ key: msg.key, value: msg.value }] });
        break;
      }
      case 'forget': {
        forget(msg.key);
        send(ws, { type: 'memory_updated', memory: loadMemory() });
        break;
      }
      case 'get_memory': {
        send(ws, { type: 'memory', data: loadMemory() });
        break;
      }

      case 'clear_history': {
        history.length = 0;
        send(ws, { type: 'history_cleared' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (streamInterval) clearInterval(streamInterval);
    console.log('[ws] Disconnected: ' + ip);
  });
  ws.on('error', err => console.error('[ws] Error:', err.message));
});

// Start

function getLocalIPs() {
  const ips = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

async function main() {
  await requestPermissions();

  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    const profile = loadProfile();
    const greet = profile ? ('— Hey, ' + profile.name + '!') : '— Ready';

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(('║  🌌  GALAXY AI ' + greet).padEnd(55) + '║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(('║  Local:    http://localhost:' + PORT).padEnd(56) + '║');
    ips.forEach(ip => {
      console.log(('║  Network:  http://' + ip + ':' + PORT).padEnd(56) + '║');
    });
    console.log('╠══════════════════════════════════════════════════════╣');
    if (!EDEN_KEY || EDEN_KEY === 'your_eden_ai_key_here') {
      console.log('║  ⚠️  EDEN_AI_KEY not set — add it to .env            ║');
    } else {
      console.log(('║  ✅  Eden AI: ' + EDEN_PROVIDER).padEnd(56) + '║');
    }
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('Open any URL above from phone, tablet, or browser.');
  });
}

main().catch(err => { console.error('Startup failed:', err); process.exit(1); });
