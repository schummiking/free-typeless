# 🔄 Free Typeless — Dictionary Migration Tool

**Typeless free trial expired? Switch to a new account and keep all your words. One command. Zero hassle.**

> Typeless learns how you speak through a personal dictionary. Losing it when switching accounts sucks. This tool makes sure you never lose a single word.

## ✨ What it does

```
Old account (26 words) ──export──► JSON ──import──► New account (26 words)
```

- 📤 Exports your entire Typeless dictionary (words, languages, categories)
- 🔑 Logs into a new Typeless account automatically (headless browser)
- 📥 Imports every word into the new account, skipping duplicates
- ✅ Verifies the migration — word count in, word count out

**You never open a browser.** The script does all the clicking. You just provide an email and a verification code.

## 🚀 Quick start

```bash
# Export from current account (must be logged in on this Mac):
bash scripts/export-dictionary.sh
cp references/typeless-dictionary-export.json /tmp/source-dictionary.json

# Switch to new account (you'll be asked for a 6-digit code):
bash scripts/switch-account.sh --email <your-new-email>

# Import your dictionary:
bash scripts/import-dictionary.sh --input /tmp/source-dictionary.json

# Done. Verify:
bash scripts/export-dictionary.sh
```

Not logged in? Run `switch-account.sh` with your current email first.

## 🤖 Works with AI agents

Built as a skill for AI agents (Kiro, OpenClaw, etc.). The agent runs everything — you just answer two questions:

1. 📧 "What email for the new account?"
2. 🔢 "What's the 6-digit code?"

That's it. See `SKILL.md` for the full agent workflow.

## 📋 Requirements

- **macOS or Windows** with Typeless desktop app installed
- **Node.js** 18+
- An email that can receive verification codes

> ⚠️ **Google / Apple sign-in users:** The script only supports email login. Log into your current account via the Typeless desktop app first (Google/Apple auth), then run the export. The script reads the local session directly.

## 📧 Email compatibility

| Provider | Status | Notes |
|----------|:------:|-------|
| Gmail | ✅ | Recommended |
| Outlook / Hotmail | ✅ | |
| QQ Mail | ✅ | 国内用户推荐 |
| 163 Mail | ✅ | |
| Custom domain (Cloudflare catch-all) | ✅ | Best for automation |
| Gmail +tag (`user+tag@gmail.com`) | ❌ | Typeless rejects `+` in emails |
| DuckDuckGo (`@duck.com`) | ❌ | Forwarding breaks DKIM; emails silently dropped |
| Disposable email (mail.tm, etc.) | ❌ | Detected and blocked |

## 🔧 How account switching works

1. Clears the local Typeless login state
2. Deletes Typeless's device identifier from Keychain / Credential Manager
3. Opens a headless Chromium browser to the Typeless signup page
4. Fills in your email, submits
5. You provide the 6-digit verification code
6. Script captures tokens from browser, writes encrypted local session

Same encryption Typeless uses. The desktop app picks up the new session on next launch.

On macOS, the helper scripts look for Typeless in `~/Applications/Typeless.app` first and then `/Applications/Typeless.app`. Set `TYPELESS_APP_PATH` if you need to override the app location.

## 📁 Project structure

```
├── SKILL.md                          # AI agent skill definition
├── README.md                         # You are here
├── accounts.json                     # Account history (gitignored)
├── scripts/
│   ├── export-dictionary.sh/.ps1     # Dictionary export (macOS/Windows)
│   ├── export-dictionary.mjs         # Export logic (cross-platform)
│   ├── import-dictionary.sh/.ps1     # Dictionary import (macOS/Windows)
│   ├── import-dictionary.mjs         # Import logic (cross-platform)
│   ├── switch-account.sh/.ps1        # Account switcher (macOS/Windows)
│   ├── switch-account.mjs            # Switcher logic (cross-platform)
│   ├── reset-device-macos.sh         # Device reset (macOS)
│   └── reset-device-windows.ps1      # Device reset (Windows)
└── references/
    ├── extract-dictionary.md         # Technical deep-dive
    └── typeless-dictionary-export.*  # Export artifacts (gitignored)
```

## 🔌 Automating verification codes

Default flow is manual code input. `switch-account.mjs` has a `codeResolver` extension point for full automation — see the file header.

Ideas:
- Cloudflare Email Worker → KV → API query
- IMAP client polling a mailbox
- Any programmatic inbox reader

## 📄 License

MIT

---

# 🔄 Free Typeless — 词典迁移工具

**Typeless 免费额度用完了？换个号，词典一个不丢。一条命令搞定。**

> Typeless 通过个人词典学习你的说话习惯。换号丢词典太亏了。这个工具让你一个词都不会丢。

## ✨ 功能

```
旧账号 (26个词) ──导出──► JSON ──导入──► 新账号 (26个词)
```

- 📤 导出完整词典（词条、语言、分类）
- 🔑 自动登录新账号（无头浏览器，不用你动手）
- 📥 导入所有词条，自动跳过重复
- ✅ 验证迁移结果

**全程不需要打开浏览器。** 脚本帮你点完所有按钮，你只需要提供邮箱和验证码。

## 🚀 快速开始

```bash
# 导出当前账号词典（需要本机已登录）：
bash scripts/export-dictionary.sh
cp references/typeless-dictionary-export.json /tmp/source-dictionary.json

# 切换到新账号（会提示输入验证码）：
bash scripts/switch-account.sh --email <新邮箱>

# 导入词典：
bash scripts/import-dictionary.sh --input /tmp/source-dictionary.json

# 验证：
bash scripts/export-dictionary.sh
```

没登录？先用当前邮箱跑一次 `switch-account.sh` 登录。

## 🤖 支持 AI Agent

本项目可作为 AI Agent（Kiro、OpenClaw 等）的 skill 使用。Agent 负责所有操作，你只需要回答两个问题：

1. 📧 "新账号用什么邮箱？"
2. 🔢 "验证码是多少？"

完整 Agent 工作流见 `SKILL.md`。

## 📋 环境要求

- **macOS 或 Windows**，已安装 Typeless 桌面应用
- **Node.js** 18+
- 一个能收验证码的邮箱

> ⚠️ **Google / Apple 登录用户：** 脚本仅支持邮箱登录。请先在 Typeless 桌面应用中手动完成 Google/Apple 登录，等同步完成后再运行导出。

## 📧 邮箱兼容性

| 邮箱 | 状态 | 备注 |
|------|:----:|------|
| Gmail | ✅ | 推荐 |
| Outlook / Hotmail | ✅ | |
| QQ 邮箱 | ✅ | 国内用户推荐 |
| 163 邮箱 | ✅ | |
| 自定义域名（Cloudflare 全收）| ✅ | 适合自动化使用 |
| Gmail +tag（`user+tag@gmail.com`）| ❌ | Typeless 拒绝含 `+` 的邮箱 |
| DuckDuckGo（`@duck.com`）| ❌ | 转发破坏 DKIM，验证码被静默丢弃 |
| 临时邮箱（mail.tm 等）| ❌ | 被识别并屏蔽 |

## 🔧 账号切换原理

1. 清除本地 Typeless 登录态
2. 删除 Keychain / Credential Manager 中的 Typeless 设备标识
3. 无头浏览器打开 Typeless 注册页面
4. 自动填入邮箱并提交
5. 你提供 6 位验证码
6. 脚本捕获 token，写入加密的本地登录态

使用与 Typeless 相同的加密方式，桌面应用下次启动时自动识别新会话。

在 macOS 上，脚本会优先查找 `~/Applications/Typeless.app`，其次查找 `/Applications/Typeless.app`。如需覆盖默认路径，可设置环境变量 `TYPELESS_APP_PATH`。

## 🔌 自动化验证码获取

默认需要手动输入验证码。`switch-account.mjs` 提供了 `codeResolver` 扩展点——详见文件顶部注释。

可能的实现：
- Cloudflare Email Worker → KV → API 查询
- IMAP 客户端轮询邮箱
- 任何能编程读取收件箱的服务

## 📄 许可证

MIT
