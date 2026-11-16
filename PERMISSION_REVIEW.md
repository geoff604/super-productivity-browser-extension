# Permission review export

Repo: `sravan-kb/first-extension` · Branch: `main` @ `a3ce5c3` · Exported: 2026-11-16

Contents for a reviewer: the full manifest, the Origin rule, hardcoded-ID scan,
`scripting` usage, and the error-handling functions.

## Token safety check (done before writing this file)

| Check | Command | Result |
|---|---|---|
| Hardcoded extension IDs | `grep -rn "chrome-extension://" .` | no matches |
| Hardcoded bearer token | `grep -rn "Bearer \|accessToken\s*[:=]\s*\"[A-Za-z0-9]" --include=*.js --include=*.html --include=*.json .` | only `background.js:147` — the template `` `Bearer ${token}` ``, no literal token |

The access token lives in `chrome.storage.local` and is read at runtime
(`background.js:107-108`, `:130-131`). No secrets appear in the source, so
nothing below needs redaction.

---

## 1. `manifest.json` (complete)

```json
{
  "manifest_version": 3,
  "name": "Super Productivity Page Clipper",
  "version": "1.0.0",
  "description": "Clip the current page into Super Productivity.",
  "permissions": [
    "activeTab",
    "scripting",
    "contextMenus",
    "storage",
    "declarativeNetRequest"
  ],
  "host_permissions": [
    "http://127.0.0.1:3876/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "Add page to Super Productivity",
    "default_popup": "popup.html"
  },
  "options_page": "options.html",
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y"
      },
      "description": "Open the page clipper"
    }
  }
}
```

---

## 2. `ensureOriginRule` and the constants it uses

### Constants (`background.js:9-13`)

```js
const API_BASE = "http://127.0.0.1:3876";
const REQUEST_TIMEOUT_MS = 10000;
const MENU_ID = "add-to-super-productivity";
const ORIGIN_RULE_ID = 1;
let originRulePromise;
```

### The function (`background.js:177-204`)

```js
function ensureOriginRule() {
  if (!originRulePromise) {
    originRulePromise = (async () => {
      const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
      const hasRule = currentRules.some((rule) => rule.id === ORIGIN_RULE_ID);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: hasRule ? [ORIGIN_RULE_ID] : [],
        addRules: [{
          id: ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "origin", operation: "remove" }]
          },
          condition: {
            urlFilter: "|http://127.0.0.1:3876/",
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ["xmlhttprequest"]
          }
        }]
      });
    })().catch((error) => {
      originRulePromise = undefined;
      throw new RuleSetupError(error?.message);
    });
  }
  return originRulePromise;
}
```

### Where it runs / is awaited

`background.js:15-26` — installed and startup:

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add to Super Productivity",
    contexts: ["page", "link", "selection"]
  });
  ensureOriginRule().catch((error) => setGlobalFeedback(false, error.message));
});

chrome.runtime.onStartup.addListener(() => {
  ensureOriginRule().catch((error) => setGlobalFeedback(false, error.message));
});
```

`background.js:141-142` — every API call awaits it first:

```js
async function apiRequest(path, { method = "GET", token = "", body, authenticate = true } = {}) {
  await ensureOriginRule();
  const controller = new AbortController();
```

### `RuleSetupError`, thrown by that catch (`background.js:277-286`)

```js
class RuleSetupError extends Error {
  constructor(detail) {
    super(detail
      ? `Chrome could not install the narrowly scoped local API request rule: ${detail}`
      : "Chrome could not install the narrowly scoped local API request rule.");
    this.name = "RuleSetupError";
    this.code = "ORIGIN_RULE_SETUP_FAILED";
  }
}
```

Key facts for the reviewer:

- Exactly **one** dynamic rule, id `1`, `priority: 1`.
- Action is `modifyHeaders`, removing **only** the `origin` request header.
- Scoped by `urlFilter: "|http://127.0.0.1:3876/"` (the loopback API base).
- Scoped by `initiatorDomains: [chrome.runtime.id]` — the extension itself only.
- Scoped by `resourceTypes: ["xmlhttprequest"]`.
- Idempotent: replaces rule `1` if present, so it never accumulates rules.

---

## 3. Hardcoded extension IDs

Command run in `first-extension`:

```console
$ grep -rn "chrome-extension://" .
(no output)
```

The extension never hardcodes an ID. It is referenced only dynamically:

`background.js:37` — message sender validation:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    return false;
  }
```

`background.js:193` — rule scoping:

```js
            initiatorDomains: [chrome.runtime.id],
```

---

## 4. Where `scripting` is used

Only one call site: **`popup.js:45`**. `background.js` has **zero** matches for
`executeScript` and never touches `chrome.scripting`.

`popup.js:43-52` with context:

```js
  if (tab?.id !== undefined) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || ""
      });
      selectionInput.value = typeof result?.result === "string" ? result.result : "";
      selectionChoice.disabled = !selectionInput.value;
    } catch {
      selectionInput.value = "";
      selectionChoice.disabled = true;
    }
  } else {
    selectionChoice.disabled = true;
  }
```

`background.js` mentions `scripting` only in the permission-rationale comment
(`background.js:3`), not in code:

```js
// scripting reads selected text from that granted tab; no content script makes network requests.
```

---

## 5. Error messages

### `serializeError` (`background.js:241-249`)

```js
function serializeError(error) {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof RuleSetupError) {
    return { code: error.code, message: error.message };
  }
  return { code: "NETWORK_OR_TIMEOUT", message: getErrorMessage(error) };
}
```

### `getErrorMessage` (`background.js:251-260`)

```js
function getErrorMessage(error) {
  if (error instanceof ApiError && error.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc.";
  }
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof NetworkError) {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  return error?.message || "Unexpected error.";
}
```

### Error classes those branches rely on (`background.js:262-286`)

```js
class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

class NetworkError extends Error {
  constructor() {
    super("Super Productivity isn't running, or the local REST API is off (Settings -> Misc).");
    this.name = "NetworkError";
  }
}

class RuleSetupError extends Error {
  constructor(detail) {
    super(detail
      ? `Chrome could not install the narrowly scoped local API request rule: ${detail}`
      : "Chrome could not install the narrowly scoped local API request rule.");
    this.name = "RuleSetupError";
    this.code = "ORIGIN_RULE_SETUP_FAILED";
  }
}
```

### User-facing duplicates (same strings, used by the pages)

`popup.js:197-206`:

```js
function formatError(error) {
  if (error?.code === "UNAUTHORIZED" || error?.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc.";
  }
  if (error?.code === "NETWORK_OR_TIMEOUT") {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  if (error?.code && error?.message) return `${error.code}: ${error.message}`;
  return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
}
```

`options.js:42-51` is byte-identical to the above.

---

## Observations (facts, not changes)

1. **Plain errors are labelled as network failures.** `serializeError` falls
   through to `code: "NETWORK_OR_TIMEOUT"` for any error that isn't `ApiError`
   or `RuleSetupError`. A thrown `Error("The current page has no title to use
   for a task.")` (`background.js:81-83`) therefore reaches the popup as a
   network/timeout message, and the popup's `formatError` prints the local-API
   hint for it.
2. **Token advice is duplicated** in three places (`getErrorMessage`,
   `popup.js:formatError`, `options.js:formatError`) with identical wording.
3. **Stale comment:** `background.js:5` still says storage holds "the locally
   saved token and optional default project ID". The default project ID was
   removed in `a3ce5c3`.
4. `activeTab` is the only grant used for page access; the single
   `executeScript` reads `window.getSelection()` and nothing else. There is no
   content script and no remote code.
