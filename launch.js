import { existsSync } from 'fs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

import { start } from './server.js';

const port = await start();
const url  = `http://localhost:${port}`;

const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
].filter(Boolean);

const browserPath = candidates.find(p => existsSync(p));

if (browserPath) {
    spawn(browserPath, [
        `--app=${url}`,
        '--window-size=1440,900',
        '--disable-extensions',
    ], { detached: true, stdio: 'ignore' }).unref();
    console.log(`[price-stress-test] Launched app window`);
} else {
    console.log(`[price-stress-test] Chrome/Edge not found — open manually: ${url}`);
    console.log('[price-stress-test] Set CHROME_PATH in .env to specify the browser executable.');
}
