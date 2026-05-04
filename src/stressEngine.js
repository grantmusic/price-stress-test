import { EventEmitter } from 'events';
import { createClient } from './priceApi.js';
import { getEnabledTransactions, executeTransaction } from './transactions.js';

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export class StressEngine extends EventEmitter {
    #running = false;
    #config  = null;
    #metrics = null;
    #spawnTimer   = null;
    #stopTimer    = null;
    #metricsTimer = null;

    get isRunning() { return this.#running; }

    start(config) {
        if (this.#running) throw new Error('Test already running');

        const enabledTx = getEnabledTransactions(config.transactions || {});
        if (!enabledTx.length) throw new Error('No transactions enabled');
        if (config.loanRange.min > config.loanRange.max) throw new Error('Loan range min must be ≤ max');

        this.#running = true;
        this.#config  = config;
        this.#metrics = {
            activeSessions:    0,
            totalSessions:     0,
            completedSessions: 0,
            completedRequests: 0,
            failedRequests:    0,
            recentTimes:       [],
            startTime:         Date.now(),
        };

        const intervalMs = Math.max(100, 60000 / config.sessionsPerMinute);
        this.#spawnTimer = setInterval(() => this.#maybeSpawn(), intervalMs);
        this.#maybeSpawn();

        if (config.durationSec > 0) {
            this.#stopTimer = setTimeout(() => this.stop(), config.durationSec * 1000);
        }

        this.#metricsTimer = setInterval(() => this.emit('metrics', this.getMetrics()), 1000);

        this.emit('log', { type: 'info', msg: `Test started — ${config.sessionsPerMinute} sess/min, ${config.durationSec > 0 ? config.durationSec + 's' : 'manual stop'}, loans ${config.loanRange.min}–${config.loanRange.max}` });
        this.emit('started');
    }

    stop() {
        if (!this.#running) return;
        this.#running = false;
        clearInterval(this.#spawnTimer);
        clearInterval(this.#metricsTimer);
        clearTimeout(this.#stopTimer);
        this.emit('log', { type: 'warn', msg: 'Stopping — active sessions will finish their current call' });
        this.emit('stopped', this.getMetrics());
    }

    getMetrics() {
        const m = this.#metrics;
        if (!m) return {
            activeSessions: 0, totalSessions: 0, completedSessions: 0,
            completedRequests: 0, failedRequests: 0, errorRate: 0,
            throughput: 0, avgResponseMs: 0, elapsedSec: 0,
        };

        const now = Date.now();
        const windowMs = 10000;
        m.recentTimes = m.recentTimes.filter(t => now - t.ts < windowMs);

        const throughput    = +(m.recentTimes.length / (windowMs / 1000)).toFixed(1);
        const avgResponseMs = m.recentTimes.length > 0
            ? Math.round(m.recentTimes.reduce((s, t) => s + t.ms, 0) / m.recentTimes.length)
            : 0;
        const total = m.completedRequests + m.failedRequests;

        return {
            activeSessions:    m.activeSessions,
            totalSessions:     m.totalSessions,
            completedSessions: m.completedSessions,
            completedRequests: m.completedRequests,
            failedRequests:    m.failedRequests,
            errorRate:         total > 0 ? +((m.failedRequests / total) * 100).toFixed(1) : 0,
            throughput,
            avgResponseMs,
            elapsedSec:        Math.round((now - m.startTime) / 1000),
        };
    }

    #maybeSpawn() {
        if (!this.#running) return;
        const { maxConcurrent } = this.#config;
        if (maxConcurrent > 0 && this.#metrics.activeSessions >= maxConcurrent) {
            this.emit('log', { type: 'warn', msg: `Spawn skipped — at max concurrent sessions (${maxConcurrent})` });
            return;
        }
        this.#runSession().catch(() => {});
    }

    async #runSession() {
        const config = this.#config;
        const m      = this.#metrics;
        const loanNumber  = randInt(config.loanRange.min, config.loanRange.max);
        const sessionNum  = ++m.totalSessions;
        m.activeSessions++;

        this.emit('log', { type: 'session', msg: `Session #${sessionNum} started (loan ${loanNumber})` });

        const client = createClient({ timeoutMs: config.timeoutMs ?? 15000 });
        try {
            await client.login();

            const txList = getEnabledTransactions(config.transactions);
            for (let i = 0; i < config.transactionsPerSession; i++) {
                if (!this.#running) break;
                const tx = txList[randInt(0, txList.length - 1)];
                const t0 = Date.now();
                try {
                    await executeTransaction(client, tx, loanNumber);
                    const ms = Date.now() - t0;
                    m.completedRequests++;
                    m.recentTimes.push({ ts: Date.now(), ms });
                    this.emit('log', { type: 'ok', msg: `${tx.type} → ${ms}ms (loan ${loanNumber})` });
                } catch (err) {
                    m.failedRequests++;
                    this.emit('log', { type: 'error', msg: `${tx.type} failed (loan ${loanNumber}): ${err.message}` });
                }
                if (i < config.transactionsPerSession - 1 && this.#running) {
                    await delay(config.delayMs);
                }
            }
        } catch (err) {
            m.failedRequests++;
            this.emit('log', { type: 'error', msg: `Session #${sessionNum} login failed: ${err.message}` });
        } finally {
            if (config.endSessions) {
                try { await client.logout(); } catch {}
                this.emit('log', { type: 'info', msg: `Session #${sessionNum} ended (loan ${loanNumber})` });
            } else {
                this.emit('log', { type: 'info', msg: `Session #${sessionNum} left open (loan ${loanNumber})` });
            }
            m.activeSessions--;
            m.completedSessions++;
        }
    }
}
