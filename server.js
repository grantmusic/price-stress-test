import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { StressEngine } from './src/stressEngine.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app    = express();
const engine = new StressEngine();
const sseClients = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE ──────────────────────────────────────────────────────────────────────

app.get('/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));

    send(res, 'status', { state: engine.isRunning ? 'running' : 'idle' });
    if (engine.isRunning) send(res, 'metrics', engine.getMetrics());
});

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.write(payload);
}

function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Engine events → SSE ───────────────────────────────────────────────────────

engine.on('metrics', m  => broadcast('metrics', m));
engine.on('log',     e  => broadcast('log', e));
engine.on('started', () => broadcast('status', { state: 'running' }));
engine.on('stopped', () => {
    broadcast('status',  { state: 'idle' });
    broadcast('metrics', engine.getMetrics());
});

// ── API routes ────────────────────────────────────────────────────────────────

app.post('/api/start', (req, res) => {
    if (engine.isRunning) return res.status(409).json({ error: 'Test already running' });
    try {
        engine.start(req.body);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/stop', (_req, res) => {
    engine.stop();
    res.json({ ok: true });
});

app.get('/api/status', (_req, res) => {
    res.json({ running: engine.isRunning, metrics: engine.getMetrics() });
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function start() {
    const port = parseInt(process.env.PORT || '3737', 10);
    return new Promise(resolve => {
        app.listen(port, () => {
            console.log(`[price-stress-test] http://localhost:${port}`);
            resolve(port);
        });
    });
}
