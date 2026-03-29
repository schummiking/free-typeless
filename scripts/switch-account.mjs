#!/usr/bin/env node
/**
 * Typeless Account Switcher
 *
 * Logs out the current Typeless account locally, then automates email login
 * via a headless Chromium browser, captures the tokens from localStorage,
 * and writes the new login state into the local Typeless data files.
 *
 * Usage:
 *   node scripts/switch-account.mjs --email <email> [--code <code>]
 *
 * The --code flag is optional. When omitted the script will prompt
 * interactively for the 6-digit verification code sent to the email.
 *
 * Requires: TYPELESS_VENDOR_NODE_MODULES env var pointing to the
 * .vendor runtime that contains electron-store and puppeteer.
 * The wrapper script (scripts/switch-account.sh) sets this up.
 *
 * --- Auto-fetch extension point ---
 * To add automated verification code retrieval (e.g. via a temp email API,
 * Cloudflare Email Worker, or IMAP client), implement a module that exports:
 *   async function fetchVerificationCode(email): Promise<string>
 * Then pass it as a codeResolver function to automateLogin(). The resolver
 * is called after the verification email has been triggered, so it can poll
 * an inbox API until the 6-digit code arrives.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL, fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── constants ────────────────────────────────────────────────────────────────
const APP_NAME = 'Typeless';
const USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Typeless');
const REFER_URL = 'https://www.typeless.com/refer?code=JTIF7BK';
const TOKEN_LS_KEY = 'MAXAI_CLIENT__FEATURES__AUTH__TOKEN_INFO';

// ── arg helpers ──────────────────────────────────────────────────────────────
function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

function ask(question) {
  // If running non-interactively (e.g. from an AI agent), the code can be
  // supplied via a file at /tmp/typeless-code.txt instead of stdin.
  // The agent writes the code to that file after the verification email is sent.
  const codeFile = '/tmp/typeless-code.txt';
  return new Promise((resolve) => {
    // Poll for the code file for up to 5 minutes
    const poll = setInterval(() => {
      if (fs.existsSync(codeFile)) {
        const code = fs.readFileSync(codeFile, 'utf8').trim();
        fs.unlinkSync(codeFile);
        clearInterval(poll);
        console.error(`[switch] Read code from file`);
        resolve(code);
      }
    }, 500);

    // Also listen on stdin in parallel (for interactive use)
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, ans => {
      clearInterval(poll);
      rl.close();
      resolve(ans.trim());
    });
  });
}

// ── crypto: derive the same encryption key Typeless uses ─────────────────────
function deriveKey() {
  const seed = crypto.createHash('sha256')
    .update(`${process.platform}-${process.arch}`)
    .digest('hex');
  return crypto.pbkdf2Sync(seed + APP_NAME, 'typeless-user-service', 10000, 32, 'sha256');
}

async function loadElectronStore() {
  const vendorRoot = process.env.TYPELESS_VENDOR_NODE_MODULES;
  if (!vendorRoot) throw new Error('Missing TYPELESS_VENDOR_NODE_MODULES env var');
  const modPath = path.join(vendorRoot, 'electron-store', 'index.js');
  if (!fs.existsSync(modPath)) throw new Error(`electron-store not found: ${modPath}`);
  const mod = await import(pathToFileURL(modPath).href);
  return mod.default;
}

// ── (reserved) auto-fetch integration ────────────────────────────────────────
// To enable automated code retrieval, implement a fetchVerificationCode(email)
// function and wire it as a codeResolver in main(). See file header for details.

// ── Step 1: Logout ───────────────────────────────────────────────────────────
async function getCurrentEmail() {
  try {
    const Store = await loadElectronStore();
    const store = new Store({
      name: 'user-data',
      cwd: USER_DATA_DIR,
      encryptionKey: deriveKey(),
    });
    const raw = store.get('userData');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.email || null;
  } catch {
    return null;
  }
}

function logoutLocal() {
  const userDataPath = path.join(USER_DATA_DIR, 'user-data.json');
  if (fs.existsSync(userDataPath)) {
    fs.unlinkSync(userDataPath);
    console.error('[switch] Deleted user-data.json');
  }
  const appStoragePath = path.join(USER_DATA_DIR, 'app-storage.json');
  if (fs.existsSync(appStoragePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(appStoragePath, 'utf8'));
      delete data.userData;
      delete data.quotaUsage;
      fs.writeFileSync(appStoragePath, JSON.stringify(data, null, '\t'));
      console.error('[switch] Cleared login state from app-storage.json');
    } catch { /* ignore */ }
  }

  // Reset device identifier so Typeless treats this as a new device
  try {
    execSync(
      'security delete-generic-password ' +
      '-s "now.typeless.desktop.deviceIdentifier" ' +
      '-a "now.typeless.desktop.security.auth_key" 2>/dev/null',
      { stdio: 'ignore' },
    );
    console.error('[switch] Reset device identifier');
  } catch { /* may not exist, that's fine */ }

  // Restart Typeless app to avoid stale in-memory state
  try {
    const isRunning = execSync('pgrep -f "Typeless.app" || true', { encoding: 'utf8' }).trim();
    if (isRunning) {
      console.error('[switch] Restarting Typeless app…');
      execSync('osascript -e \'quit app "Typeless"\'', { stdio: 'ignore' });
      for (let i = 0; i < 10; i++) {
        const still = execSync('pgrep -f "Typeless.app" || true', { encoding: 'utf8' }).trim();
        if (!still) break;
        execSync('sleep 0.5');
      }
      execSync('open -a Typeless', { stdio: 'ignore' });
      console.error('[switch] Typeless restarted');
    }
  } catch { /* non-critical */ }
}

// ── Step 2-5: Headless browser login ─────────────────────────────────────────
// codeOrResolver can be:
//   - a string (the 6-digit code)
//   - a function () => Promise<string> that fetches the code (called after the
//     verification email has been triggered)
//   - null/undefined (will prompt interactively)
async function automateLogin(email, codeOrResolver) {
  const vendorRoot = process.env.TYPELESS_VENDOR_NODE_MODULES;
  const puppeteerPath = path.join(vendorRoot, 'puppeteer', 'lib', 'cjs', 'puppeteer', 'puppeteer.js');
  if (!fs.existsSync(puppeteerPath)) throw new Error(`puppeteer not found: ${puppeteerPath}`);
  const puppeteer = await import(pathToFileURL(puppeteerPath).href);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    // 1. Navigate to refer page
    console.error('[switch] Opening login page…');
    await page.goto(REFER_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // 2. Click "Claim your $5 credit" to open the login modal
    console.error('[switch] Clicking Claim button to open login modal…');
    const claimClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('a, button')) {
        if (el.textContent.trim() === 'Claim your $5 credit') {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (!claimClicked) throw new Error('Could not find "Claim your $5 credit" button');
    await new Promise(r => setTimeout(r, 2000));

    // 3. Wait for the modal and click "Continue with email"
    console.error('[switch] Waiting for login modal…');
    await page.waitForSelector('[role="presentation"]', { timeout: 10000 });
    console.error('[switch] Clicking Continue with email…');
    const emailBtnClicked = await page.evaluate(() => {
      // Look inside the modal specifically
      const modal = document.querySelector('[role="presentation"]');
      if (!modal) return null;
      for (const p of modal.querySelectorAll('p')) {
        if (p.textContent.trim() === 'Continue with email') {
          const rect = p.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });
    if (!emailBtnClicked) throw new Error('Could not find "Continue with email" button');
    await page.mouse.click(emailBtnClicked.x, emailBtnClicked.y);
    await new Promise(r => setTimeout(r, 2000));
    await page.waitForSelector('input', { timeout: 10000 });

    // 4. Fill email and submit
    console.error(`[switch] Entering email: ${email}`);
    const emailInput = await page.$('[role="presentation"] input[placeholder="Email address"], [role="presentation"] input[type="email"], input[placeholder="Email address"]');
    if (!emailInput) {
      throw new Error('Could not find email input');
    }
    await emailInput.type(email, { delay: 20 });
    await new Promise(r => setTimeout(r, 500));
    // Click the submit button inside the modal
    await page.evaluate(() => {
      const modal = document.querySelector('[role="presentation"]');
      if (!modal) return;
      for (const b of modal.querySelectorAll('button')) {
        if (b.textContent.trim() === 'Continue with email') { b.click(); return; }
      }
    });

    // 4. Wait for code input
    console.error('[switch] Waiting for verification code page…');
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes('verification code') || text.includes('6-digit') || text.includes('code has sent');
      },
      { timeout: 30000 },
    );
    await new Promise(r => setTimeout(r, 1000));

    // Resolve the verification code
    let code;
    if (typeof codeOrResolver === 'function') {
      console.error('[switch] Fetching verification code automatically…');
      code = await codeOrResolver();
    } else if (typeof codeOrResolver === 'string' && codeOrResolver.length === 6) {
      code = codeOrResolver;
    } else {
      code = await ask('[switch] Enter 6-digit verification code: ');
    }
    if (!code || code.length !== 6) throw new Error('Invalid verification code');

    // 5. Fill code and submit
    console.error('[switch] Entering verification code…');
    const codeInput = await page.$('input[placeholder*="erification" i], input[placeholder*="code" i], input[type="text"], input[type="number"]');
    if (!codeInput) throw new Error('Could not find verification code input');
    await codeInput.type(code, { delay: 20 });
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.trim() === 'Sign in') { b.click(); return; }
      }
    });

    // 6. Wait for success page (allow extra time for slow networks)
    console.error('[switch] Waiting for login success…');
    await page.waitForFunction(
      () => document.body.innerText.includes('Open the desktop app')
        || document.body.innerText.includes('Download Typeless'),
      { timeout: 60000 },
    );

    // 7. Read tokens from localStorage
    const tokenJson = await page.evaluate((key) => localStorage.getItem(key), TOKEN_LS_KEY);
    if (!tokenJson) throw new Error('Could not read token from localStorage');

    const tokens = JSON.parse(tokenJson);
    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      user_id: tokens.userId,
      email: tokens.email,
    };
  } finally {
    await browser.close();
  }
}

// ── Step 6: Write login state ────────────────────────────────────────────────
async function writeLoginState({ access_token, refresh_token, email, user_id }) {
  if (!access_token || !refresh_token || !email || !user_id) {
    throw new Error('Missing required login parameters');
  }

  const Store = await loadElectronStore();
  const store = new Store({
    name: 'user-data',
    cwd: USER_DATA_DIR,
    encryptionKey: deriveKey(),
  });

  store.set('userData', JSON.stringify({
    email,
    access_token,
    refresh_token,
    login_time: Date.now(),
    user_id,
  }));

  console.error(`[switch] Login state written: ${email} (${user_id})`);
}

// ── accounts.json helpers ────────────────────────────────────────────────────
const ACCOUNTS_PATH = path.resolve(__dirname, '..', 'accounts.json');

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')); }
  catch { return { accounts: [] }; }
}

function saveOrUpdateAccount(email, typelessUserId) {
  const data = loadAccounts();
  let entry = data.accounts.find(a => a.address === email);
  if (!entry) {
    entry = { address: email, created_at: new Date().toISOString(), typeless_user_id: null };
    data.accounts.push(entry);
  }
  if (typelessUserId) entry.typeless_user_id = typelessUserId;
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(data, null, 2) + '\n');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  let email = getArg('--email');
  let code = getArg('--code');

  if (!email) {
    console.error('Usage:');
    console.error('  node scripts/switch-account.mjs --email <email> [--code <code>]');
    console.error('');
    console.error('Options:');
    console.error('  --email <email>   Target email address to log into Typeless');
    console.error('  --code <code>     6-digit verification code (if omitted, will prompt interactively)');
    process.exit(1);
  }

  const currentEmail = await getCurrentEmail();
  if (currentEmail) {
    console.error(`[switch] Current account: ${currentEmail}`);
  }

  // 1. Logout
  logoutLocal();

  // 2-5. Browser login → get tokens
  // To plug in automated code retrieval, replace `code` with a codeResolver
  // function here. See the file header comment for the extension point spec.
  const tokens = await automateLogin(email, code);

  // 6. Write local state
  await writeLoginState(tokens);

  // Record in accounts.json
  saveOrUpdateAccount(email, tokens.user_id);

  // Output result
  console.log(JSON.stringify({
    ok: true,
    email: tokens.email,
    user_id: tokens.user_id,
    previous_account: currentEmail || null,
  }, null, 2));
}

main().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
