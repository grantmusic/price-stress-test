import { createHash } from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

// ── Crypto helpers ────────────────────────────────────────────────────────────

function sha256Upper(s) {
    return createHash('sha256').update(s).digest('hex').toUpperCase();
}

function buildUtcTimestamp(now = new Date()) {
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return (
        pad(now.getUTCFullYear(), 4) +
        pad(now.getUTCMonth() + 1) +
        pad(now.getUTCDate()) +
        pad(now.getUTCHours()) +
        pad(now.getUTCMinutes())
    );
}

function computeAppSecret(hardcodedValue, appId, appPassword, timestamp) {
    const s1 = sha256Upper(`${hardcodedValue}${appId}${appPassword}`);
    return sha256Upper(`${timestamp}${s1}`);
}

function toFormUrlEncoded(obj) {
    return Object.entries(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

// ── Mutex (serializes POSTs per session to prevent nonce races) ───────────────

function createMutex() {
    let chain = Promise.resolve();
    return fn => {
        const next = chain.then(() => fn(), () => fn());
        chain = next.then(() => {}, () => {});
        return next;
    };
}

// ── Client factory ────────────────────────────────────────────────────────────

export function createClient(cfg = {}) {
    const {
        baseUrl        = process.env.PRICE_BASE_URL,
        database       = process.env.PRICE_DATABASE,
        apiVersion     = process.env.PRICE_API_VERSION,
        appId          = process.env.PRICE_APP_ID,
        appPassword    = process.env.PRICE_APP_PASSWORD,
        hardcodedValue = process.env.PRICE_HARDCODED_VALUE,
        loginName      = process.env.PRICE_LOGIN_NAME,
        password       = process.env.PRICE_PASSWORD,
        timeoutMs      = 15000,
        retries        = 1,
        retryDelayMs   = 500,
    } = cfg;

    let sessionId;
    let nonce;
    const mutex = createMutex();

    function getBaseUrl() {
        const base = new URL(baseUrl);
        base.pathname = [base.pathname.replace(/\/+$/, ''), database].filter(Boolean).join('/');
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        return base.toString();
    }

    function buildUrl(endpoint, params = {}) {
        const url = new URL(endpoint.replace(/^\/+/, ''), getBaseUrl());
        const qp  = new URLSearchParams();
        if (sessionId) qp.set('SessionID', sessionId);
        if (nonce)     qp.set('Nonce', nonce);
        for (const [k, v] of Object.entries(params)) {
            if (v == null) continue;
            qp.set(k, String(v));
        }
        url.search = qp.toString();
        return url.toString();
    }

    async function doFetch(endpoint, init = {}, params = {}, opts = {}) {
        const url = buildUrl(endpoint, params);
        const t   = opts.timeoutMs ?? timeoutMs;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), t);

        const headers = { 'User-Agent': 'price-stress-test', ...init.headers };

        let attempt = 0;
        while (true) {
            try {
                const res = await fetch(url, { ...init, headers, signal: controller.signal });
                clearTimeout(timer);

                const text = await res.text();
                let parsed = null;
                try { parsed = JSON.parse(text); } catch {}

                if (!res.ok) {
                    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
                    if (retryable && attempt < retries) {
                        attempt++;
                        await new Promise(r => setTimeout(r, retryDelayMs * attempt));
                        continue;
                    }
                    throw new Error(`PRICE HTTP ${res.status}: ${text.slice(0, 200)}`);
                }

                return { text, parsed };
            } catch (err) {
                clearTimeout(timer);
                if (err.name === 'AbortError') throw new Error(`PRICE timeout after ${t}ms on ${endpoint}`);
                throw err;
            }
        }
    }

    async function login() {
        const ts        = buildUtcTimestamp();
        const appSecret = computeAppSecret(hardcodedValue, appId, appPassword, ts);

        const { parsed } = await doFetch(
            'create_session',
            {
                method:  'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body:    toFormUrlEncoded({ Password: password }),
            },
            { LoginName: loginName, AppID: appId, AppSecret: appSecret, APIVersion: apiVersion }
        );

        sessionId = parsed?.SessionID;
        nonce     = parsed?.Nonce;

        if (!sessionId || !nonce) {
            throw new Error('create_session did not return SessionID/Nonce');
        }
    }

    async function logout() {
        if (!sessionId) return;
        try {
            await doFetch('end_session', { method: 'POST' });
        } catch {}
        finally {
            sessionId = undefined;
            nonce     = undefined;
        }
    }

    async function get(endpoint, params = {}, opts = {}) {
        const { parsed } = await doFetch(endpoint, { method: 'GET' }, params, opts);
        return parsed;
    }

    async function postForm(endpoint, form, params = {}, opts = {}) {
        return mutex(async () => {
            const { parsed } = await doFetch(
                endpoint,
                {
                    method:  'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body:    toFormUrlEncoded(form),
                },
                params,
                opts
            );
            if (parsed?.Nonce) nonce = parsed.Nonce;
            return parsed;
        });
    }

    async function postJson(endpoint, body, params = {}, opts = {}) {
        return mutex(async () => {
            const { parsed } = await doFetch(
                endpoint,
                {
                    method:  'POST',
                    headers: { 'content-type': 'application/json' },
                    body:    JSON.stringify(body),
                },
                params,
                opts
            );
            if (parsed?.Nonce) nonce = parsed.Nonce;
            return parsed;
        });
    }

    async function postImageFile(endpoint, base64Data, params = {}, opts = {}) {
        return mutex(async () => {
            const { parsed } = await doFetch(
                endpoint,
                {
                    method:  'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body:    `ImageFile=${encodeURIComponent(base64Data)}`,
                },
                params,
                opts
            );
            if (parsed?.Nonce) nonce = parsed.Nonce;
            return parsed;
        });
    }

    return { login, logout, get, postForm, postJson, postImageFile };
}

export async function run(fn) {
    const client = createClient();
    await client.login();
    try {
        return await fn(client);
    } finally {
        await client.logout();
    }
}

export default { createClient, run };
