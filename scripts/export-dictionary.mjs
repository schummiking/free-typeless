import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

const APP_NAME = 'Typeless';
const USER_DATA_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Typeless.exe')
  : path.join(os.homedir(), 'Library', 'Application Support', 'Typeless');
const API_URL = 'https://api.typeless.com/user/dictionary/list?size=10000';

function getArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function deriveKey() {
  const seed = crypto.createHash('sha256').update(`${process.platform}-${process.arch}`).digest('hex');
  return crypto.pbkdf2Sync(seed + APP_NAME, 'typeless-user-service', 10000, 32, 'sha256');
}

async function loadElectronStore() {
  const vendorRoot = process.env.TYPELESS_VENDOR_NODE_MODULES;
  if (!vendorRoot) throw new Error('缺少 TYPELESS_VENDOR_NODE_MODULES 环境变量');
  const modPath = path.join(vendorRoot, 'electron-store', 'index.js');
  if (!fs.existsSync(modPath)) throw new Error(`未找到 electron-store: ${modPath}`);
  const mod = await import(pathToFileURL(modPath).href);
  return mod.default;
}

function writeTextFile(filePath, text) {
  fs.writeFileSync(filePath, text.endsWith('\n') ? text : `${text}\n`);
}

function redactPath(p) {
  // Replace home directory with ~ in output to avoid leaking absolute paths
  return p.replace(os.homedir(), '~');
}

async function main() {
  const outputDir = path.resolve(getArg('--output-dir', path.join(process.cwd(), 'references')));
  fs.mkdirSync(outputDir, { recursive: true });

  const Store = await loadElectronStore();
  const store = new Store({
    name: 'user-data',
    cwd: USER_DATA_DIR,
    encryptionKey: deriveKey(),
  });

  const raw = store.get('userData');
  if (!raw || typeof raw !== 'string') {
    throw new Error('未读取到 Typeless 登录态（userData 为空）');
  }

  const user = JSON.parse(raw);
  if (!user?.access_token) {
    throw new Error('未读取到 access_token，请确认 Typeless 已登录且本机仍保留会话');
  }

  const res = await fetch(API_URL, {
    headers: {
      Authorization: `Bearer ${user.access_token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Typeless-Dictionary-Skill/1.0',
    },
  });

  const data = await res.json();
  if (!res.ok || data?.status !== 'OK') {
    throw new Error(`词典列表请求失败: HTTP ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  }

  const words = Array.isArray(data?.data?.words) ? data.data.words : [];
  const jsonPath = path.join(outputDir, 'typeless-dictionary-export.json');
  const txtPath = path.join(outputDir, 'typeless-dictionary-export.txt');
  const csvPath = path.join(outputDir, 'typeless-dictionary-export.csv');

  fs.writeFileSync(jsonPath, JSON.stringify({
    exported_at: new Date().toISOString(),
    source: {
      app_name: APP_NAME,
      app_data_dir: redactPath(USER_DATA_DIR),
      api_url: API_URL,
    },
    account: {
      user_id: user.user_id ?? null,
      email: user.email ?? null,
    },
    total_count: words.length,
    words,
  }, null, 2));

  writeTextFile(txtPath, words.map(word => word.term).filter(Boolean).join('\n'));

  const csvLines = ['term,lang,category,auto,replace'];
  for (const word of words) {
    csvLines.push([
      word.term,
      word.lang,
      word.category,
      String(Boolean(word.auto)),
      String(Boolean(word.replace)),
    ].map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','));
  }
  writeTextFile(csvPath, csvLines.join('\n'));

  console.log(JSON.stringify({
    ok: true,
    total: words.length,
    output_dir: outputDir,
    files: [jsonPath, txtPath, csvPath],
    account: {
      user_id: user.user_id ?? null,
      email: user.email ?? null,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
