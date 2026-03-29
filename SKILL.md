---
name: typeless-dictionary
description: Export, verify, and migrate Typeless custom dictionary data on a macOS machine. Supports switching between Typeless accounts via automated headless email login. The user only needs to provide an email address and a 6-digit verification code — everything else is automated. Use when you want to extract the current Typeless dictionary, switch to a different Typeless account, or migrate your dictionary to a new account.
---

# Typeless Dictionary

## Language

Always respond in the same language the user used in their initial message. If they wrote in Chinese, respond in Chinese throughout. If they wrote in English, respond in English throughout.

## Overview

Use this skill to pull the current Typeless account's custom dictionary from the local macOS app state and Typeless API, then save the export into this skill's `references/` folder. The skill also supports switching between Typeless accounts and migrating dictionaries.

**The entire flow is interactive — the user does not need to open a browser or visit any website.** The script handles all browser automation (account registration, login, verification) via a headless Chromium instance. The user only needs to:

1. Provide an email address
2. Check their inbox for a 6-digit code
3. Provide the code

This design means new Typeless accounts are created automatically by the script.

## Prerequisites

You need email addresses that can receive Typeless verification codes. You need roughly one new address per month.

**If the user's current Typeless account uses Google or Apple sign-in:** The script only supports email-based login. Ask the user to manually log into their Typeless account on this Mac via the desktop app first (using Google/Apple auth), then proceed. The export step reads the local session directly — no script-based re-login needed for the source account.

**What works:**
- Gmail, Outlook, QQ Mail, 163 Mail, or any standard email provider
- Custom domain with catch-all forwarding (e.g. Cloudflare Email Routing) — best for automation

**What doesn't work:**
- Gmail +tag (`user+tag@gmail.com`) — Typeless rejects `+` in email addresses
- DuckDuckGo Email Protection (`@duck.com`) — forwarding breaks DKIM, verification emails get silently dropped
- Disposable email services (mail.tm, mail.gw, etc.) — detected and blocked by Typeless

See `SETUP.md` for the full compatibility table and usage instructions.

## Quick Start

### Export dictionary

1. Confirm Typeless is logged into the source account (or switch to it first — see below).
2. From the skill directory, run `bash scripts/export-dictionary.sh`.
3. Read the generated files in `references/`:
   - `typeless-dictionary-export.json`
   - `typeless-dictionary-export.txt`
   - `typeless-dictionary-export.csv`

### Switch account

```bash
bash scripts/switch-account.sh --email <target-email>
```

The script will automate the browser login flow and prompt you for the 6-digit verification code. Check your email inbox for the code from Typeless.

If you already have the code, pass it directly:

```bash
bash scripts/switch-account.sh --email <target-email> --code 123456
```

## Workflow

### 1. Switch account (if needed)

```bash
# Log into a Typeless account (will prompt for verification code):
bash scripts/switch-account.sh --email user@example.com

# Or pass the code directly:
bash scripts/switch-account.sh --email user@example.com --code 123456
```

The script will:
1. Delete the local encrypted login state (`user-data.json`) and clear `app-storage.json`.
2. Open a headless Chromium browser to the Typeless login page.
3. Automate the "Continue with email" flow: fill email → submit.
4. Prompt for the 6-digit verification code (or accept it via `--code`).
5. Submit the code, wait for login success, and read the access/refresh tokens from the browser's localStorage.
6. Write the new login state into `user-data.json` using the same encryption Typeless uses.
7. Record the account in `accounts.json`.

**Important notes:**

- Only email-based login is supported (not Google or Apple sign-in).
- The switch only affects the local data files. The running Typeless desktop app keeps its in-memory session until restarted. However, the export script reads directly from the data files, so exports will use the newly switched account immediately.

### 2. Extract the dictionary

```bash
bash scripts/export-dictionary.sh
```

See `references/extract-dictionary.md` for detailed extraction path, storage locations, key derivation, and API call.

### 3. Import dictionary into another account

To copy a dictionary from one account to another:

1. Export the source account's dictionary first (step 2 above).
2. Save the export file before switching accounts:
   ```bash
   cp references/typeless-dictionary-export.json /tmp/source-dictionary.json
   ```
3. Switch to the target account:
   ```bash
   bash scripts/switch-account.sh --email <target-email>
   ```
4. Import:
   ```bash
   bash scripts/import-dictionary.sh --input /tmp/source-dictionary.json
   ```

The import script will:
- Read the exported JSON file.
- List the target account's existing words and skip duplicates (matched by term + lang).
- Call `POST /user/dictionary/add` for each new word.
- Note: Typeless deduplicates terms case-insensitively.

Use `--dry-run` to preview what would be imported without making changes.

### 4. Use the scripts first

Prefer the bundled scripts instead of rewriting the logic during each run.

**macOS (bash):**
- Dictionary export: `bash scripts/export-dictionary.sh`
- Dictionary import: `bash scripts/import-dictionary.sh`
- Account switcher: `bash scripts/switch-account.sh`
- Device reset: `bash scripts/reset-device-macos.sh`

**Windows (PowerShell):**
- Dictionary export: `powershell -ExecutionPolicy Bypass -File scripts\export-dictionary.ps1`
- Dictionary import: `powershell -ExecutionPolicy Bypass -File scripts\import-dictionary.ps1`
- Account switcher: `powershell -ExecutionPolicy Bypass -File scripts\switch-account.ps1`
- Device reset: `powershell -ExecutionPolicy Bypass -File scripts\reset-device-windows.ps1`

The underlying `.mjs` scripts are cross-platform — the shell/PowerShell wrappers just set up dependencies and environment variables.

The wrappers install local runtime dependencies under `scripts/.vendor/` on first run.

### 5. Verify the export

After export:

- Check the reported total word count.
- Spot-check expected terms if the user mentioned any anchor words.
- Treat `references/typeless-dictionary-export.json` as the canonical export for later compare/import work.

## Default Workflow

When the user asks to "run this skill" or "do the dictionary migration", follow this interactive sequence:

### Phase 1: Export from source account

**If the user is already logged in locally** (check by running the export script — if it succeeds, skip to export):

On macOS: `bash scripts/export-dictionary.sh`
On Windows: `powershell -ExecutionPolicy Bypass -File scripts\export-dictionary.ps1`

1. Export the dictionary → note the account email and word count.
2. Save the export:
   - macOS: `cp references/typeless-dictionary-export.json /tmp/source-dictionary.json`
   - Windows: `copy references\typeless-dictionary-export.json %TEMP%\source-dictionary.json`

**If the user is NOT logged in locally** (export fails with "No Typeless login state found"):

- **If they use email login**: Ask for their email, run the account switcher, ask for the verification code.
- **If they use Google/Apple login**: Ask them to open the Typeless desktop app, log in manually with Google/Apple, wait for it to sync, then come back. After that, the export will work without any script-based login.

### Phase 2: Import into target account

1. **Ask the user**: "What email address would you like to use for the new Typeless account? (Gmail, Outlook, QQ Mail, etc. — any real email you can check.)"
2. Start the account switcher in the background:
   - macOS: `bash scripts/switch-account.sh --email <target-email> &`
   - Windows: `Start-Process node -ArgumentList "scripts/switch-account.mjs","--email","<target-email>" -NoNewWindow`
3. Wait for the script to reach the verification code prompt.
4. **Ask the user**: "I've sent a verification code to `<target-email>`. Please check your inbox (including spam) and give me the 6-digit code."
5. Write the code to the signal file (cross-platform temp dir):
   - macOS: `echo "<code>" > /tmp/typeless-code.txt`
   - Windows: `echo <code> > %TEMP%\typeless-code.txt`
6. Wait for the background process to complete (the script reads the file and finishes login automatically).
7. Import the dictionary:
   - macOS: `bash scripts/import-dictionary.sh --input /tmp/source-dictionary.json`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts\import-dictionary.ps1 --input %TEMP%\source-dictionary.json`
8. Verify by running the export script again and confirming the word count matches the source.

### Phase 3: Report

Tell the user:
- "Migration complete. Your dictionary (`N` words) has been moved from `<source-email>` to `<target-email>`."
- "Your old account's dictionary is still intact — nothing was deleted."

## Agent Interaction Templates

Use these when interacting with the user during migration:

**Greeting / start:**
> "I'll help you migrate your Typeless dictionary to a new account. I'll handle all the technical steps — you just need to provide an email address and a verification code. Ready?"

**Asking for source account (if not logged in):**
> "What email address is your current Typeless account registered with? I need to log in to export your dictionary."

**Asking for source verification code:**
> "I've triggered a verification code to `<email>`. Please check your inbox (and spam folder) for a 6-digit code from Typeless, then paste it here."

**Asking for target account:**
> "Now I need a new email address to create the target account. Use any real email you can check — Gmail, Outlook, QQ Mail, 163, etc. What address would you like to use?"

**Asking for target verification code:**
> "I've triggered a verification code to `<email>`. Check your inbox for the 6-digit code and paste it here. You don't need to open any website — just the code."

**Completion:**
> "Done! Your dictionary (`N` words) has been migrated from `<source>` to `<target>`. Your old account is untouched."

**If user's current account uses Google/Apple login:**
> "Since your current Typeless account uses Google/Apple sign-in, I can't log in automatically for the export step. Please open the Typeless desktop app on this Mac, log in with your Google/Apple account, and let it sync. Once you're logged in, come back and I'll take it from there."
> "If you haven't received the code, check your spam/junk folder. Make sure you're using a real email provider (Gmail, Outlook, QQ Mail, etc.) — disposable email services and email forwarding services like DuckDuckGo @duck.com are known to not work with Typeless."

## Automating Verification Code Retrieval

The default flow requires manual code input. If you want to automate this, `switch-account.mjs` supports a `codeResolver` function extension point — see the comment at the top of the file.

Possible implementations:
- A Cloudflare Email Worker that stores incoming emails in KV, queried via API.
- An IMAP client that polls a real mailbox.
- A SimpleLogin webhook + local server.

This is left as an exercise for advanced users who need fully unattended migration.

## Account Records

All accounts used by this skill are recorded in `accounts.json` at the skill root:

```json
{
  "accounts": [
    {
      "address": "user@example.com",
      "created_at": "2026-01-01T00:00:00.000Z",
      "typeless_user_id": "..."
    }
  ]
}
```

## Guardrails

- Do not print or persist Typeless access tokens in logs, chat, or output files.
- Keep export artifacts inside this skill's `references/` folder unless the user explicitly asks for another location.
- If the script cannot read the current login state, switch to the target account first using `switch-account.sh`.
- Do not import anything automatically during export-only work.
- The `accounts.json` file may contain sensitive info. It is listed in `.gitignore`.

## Resources

- `scripts/export-dictionary.sh` / `.ps1` — dictionary export wrapper (macOS / Windows)
- `scripts/export-dictionary.mjs` — dictionary export logic (cross-platform)
- `scripts/import-dictionary.sh` / `.ps1` — dictionary import wrapper (macOS / Windows)
- `scripts/import-dictionary.mjs` — dictionary import logic (cross-platform)
- `scripts/switch-account.sh` / `.ps1` — account switcher wrapper (macOS / Windows)
- `scripts/switch-account.mjs` — account switcher logic (cross-platform)
- `scripts/reset-device-macos.sh` — standalone device reset (macOS)
- `scripts/reset-device-windows.ps1` — standalone device reset (Windows)
- `references/extract-dictionary.md` — detailed extraction/import procedure and troubleshooting
- `references/typeless-dictionary-export.*` — latest exported dictionary artifacts
- `accounts.json` — local record of accounts used by this skill
