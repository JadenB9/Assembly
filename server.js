// Local dev server: serves public/ and runs the multiplayer realtime layer.
// The multiplayer state lives entirely in memory — this is meant for LAN / local
// play, not for production hosting. On j4den.com the same public/ files are
// served statically and the client gracefully falls back to single-player.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    pingInterval: 20000,
    pingTimeout: 25000
});

const PORT = process.env.PORT || 3001;
const NAME_MAX = 24;

const PALETTE = [
    '#d4a050', '#6a9955', '#569cd6', '#d16969',
    '#c586c0', '#4ec9b0', '#dcdcaa', '#9cdcfe'
];

const users = new Map();

function nextColor() {
    // Prefer colors that aren't currently in use.
    const taken = new Set([...users.values()].map(u => u.color));
    const free = PALETTE.filter(c => !taken.has(c));
    const pool = free.length ? free : PALETTE;
    return pool[Math.floor(Math.random() * pool.length)];
}

function makeName() {
    return 'user' + Math.floor(1000 + Math.random() * 9000);
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

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: 0,
    etag: true
}));

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    const user = {
        id: socket.id,
        name: makeName(),
        color: nextColor(),
        position: { x: 0, y: 4, z: 25 }
    };
    users.set(socket.id, user);

    socket.emit('self', user);
    socket.emit('roster', [...users.values()].filter(u => u.id !== socket.id));
    socket.broadcast.emit('joined', user);

    socket.on('rename', (raw) => {
        if (typeof raw !== 'string') return;
        const name = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
        if (!name) return;
        user.name = name;
        io.emit('updated', { id: user.id, name: user.name, color: user.color });
    });

    socket.on('move', (pos) => {
        if (!isFinitePos(pos)) return;
        user.position = clampPos(pos);
        socket.broadcast.emit('moved', { id: user.id, position: user.position });
    });

    socket.on('shot', (data) => {
        if (!data || !isFinitePos(data.origin) || !isFinitePos(data.direction)) return;
        socket.broadcast.emit('shot', {
            id: user.id,
            origin: data.origin,
            direction: data.direction
        });
    });

    socket.on('hit', (data) => {
        if (!data || typeof data.target !== 'string') return;
        const target = users.get(data.target);
        if (!target) return;
        io.emit('hit', {
            shooter: user.id,
            shooterName: user.name,
            target: target.id,
            targetName: target.name
        });
    });

    socket.on('code', (data) => {
        if (!data || typeof data.source !== 'string') return;
        if (data.source.length > 128 * 1024) return;
        io.emit('code', {
            by: user.id,
            byName: user.name,
            source: data.source,
            filename: (typeof data.filename === 'string' ? data.filename : 'shared.asm').slice(0, 64)
        });
    });

    socket.on('disconnect', () => {
        users.delete(socket.id);
        socket.broadcast.emit('left', user.id);
    });
});

server.listen(PORT, () => {
    console.log(`assembly viewer running at http://localhost:${PORT}`);
});
