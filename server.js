// Local dev server: serves public/ over HTTP and runs a tiny WebSocket
// multiplayer relay on /ws. The same wire format is implemented by the
// Cloudflare Durable Object worker that backs the live site, so the client
// can speak to either with no code change.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt':  'text/plain; charset=utf-8',
    '.asm':  'text/plain; charset=utf-8',
    '.s':    'text/plain; charset=utf-8'
};

function serveStatic(req, res) {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    // Reject anything trying to escape the public dir.
    const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403); res.end('forbidden'); return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

const httpServer = http.createServer(serveStatic);

// === Multiplayer relay ===

const PALETTE = [
    '#d4a050', '#6a9955', '#569cd6', '#d16969',
    '#c586c0', '#4ec9b0', '#dcdcaa', '#9cdcfe'
];

const sessions = new Set();
let nextId = 0;

function pickColor() {
    const taken = new Set([...sessions].map(s => s.user.color));
    const free = PALETTE.filter(c => !taken.has(c));
    return (free.length ? free : PALETTE)[Math.floor(Math.random() * (free.length ? free.length : PALETTE.length))];
}

function isFinitePos(p) {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function clampPos(p) {
    return {
        x: Math.max(-500, Math.min(500, p.x)),
        y: Math.max(-50, Math.min(300, p.y)),
        z: Math.max(-500, Math.min(500, p.z))
    };
}

function send(ws, msg) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
}

function broadcast(except, msg) {
    const data = JSON.stringify(msg);
    for (const s of sessions) {
        if (s === except) continue;
        if (s.ws.readyState !== 1) continue;
        try { s.ws.send(data); } catch (_) {}
    }
}

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
    const session = {
        ws,
        user: {
            id: `u${++nextId}-${Math.random().toString(36).slice(2, 8)}`,
            name: `user${Math.floor(1000 + Math.random() * 9000)}`,
            color: pickColor(),
            position: { x: 0, y: 4, z: 25 }
        }
    };
    sessions.add(session);

    send(ws, { type: 'self', user: session.user });
    send(ws, {
        type: 'roster',
        users: [...sessions].filter(s => s !== session).map(s => s.user)
    });
    broadcast(session, { type: 'joined', user: session.user });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        if (!msg || typeof msg.type !== 'string') return;

        switch (msg.type) {
            case 'rename': {
                if (typeof msg.name !== 'string') return;
                const name = msg.name.trim().replace(/\s+/g, ' ').slice(0, 24);
                if (!name) return;
                session.user.name = name;
                broadcast(null, {
                    type: 'updated',
                    id: session.user.id,
                    name,
                    color: session.user.color
                });
                break;
            }
            case 'move': {
                if (!isFinitePos(msg.position)) return;
                session.user.position = clampPos(msg.position);
                broadcast(session, {
                    type: 'moved',
                    id: session.user.id,
                    position: session.user.position
                });
                break;
            }
            case 'shot': {
                if (!isFinitePos(msg.origin) || !isFinitePos(msg.direction)) return;
                broadcast(session, {
                    type: 'shot',
                    id: session.user.id,
                    origin: msg.origin,
                    direction: msg.direction
                });
                break;
            }
            case 'hit': {
                if (typeof msg.target !== 'string') return;
                const target = [...sessions].find(s => s.user.id === msg.target);
                if (!target) return;
                broadcast(null, {
                    type: 'hit',
                    shooter: session.user.id,
                    shooterName: session.user.name,
                    target: target.user.id,
                    targetName: target.user.name
                });
                break;
            }
            case 'code': {
                if (typeof msg.source !== 'string') return;
                if (msg.source.length > 128 * 1024) return;
                const filename = (typeof msg.filename === 'string'
                    ? msg.filename
                    : 'shared.asm').slice(0, 64);
                broadcast(null, {
                    type: 'code',
                    by: session.user.id,
                    byName: session.user.name,
                    source: msg.source,
                    filename
                });
                break;
            }
        }
    });

    const cleanup = () => {
        if (!sessions.has(session)) return;
        sessions.delete(session);
        broadcast(null, { type: 'left', id: session.user.id });
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
});

httpServer.listen(PORT, () => {
    console.log(`assembly viewer running at http://localhost:${PORT}`);
});
