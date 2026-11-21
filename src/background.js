// Manifest permission rationale:
// activeTab grants access to the page only after the user invokes the action or context menu.
// scripting reads selected text from that granted tab; no content script makes network requests.
// contextMenus adds the requested page, link, and selection menu item.
// storage reads the locally saved access token.
// Chrome uses declarativeNetRequestWithHostAccess to remove Origin from its loopback API requests.
// Firefox uses a blocking webRequest listener instead, because DNR does not reliably match
// extension background fetches there; that listener covers all requests to the local API URL.
// host_permissions is limited to the Super Productivity loopback REST API.

const API_BASE = "http://127.0.0.1:3876";
const API_HOST_PERMISSION = "http://127.0.0.1/*";
const REQUEST_TIMEOUT_MS = 10000;
const MENU_ID = "add-to-super-productivity";
const ORIGIN_RULE_ID = 1;
const INBOX_PROJECT_ID = "INBOX_PROJECT";
// Super Productivity priorities: 1 = Low, 2 = Medium, 3 = High.
const HIGH_PRIORITY = 3;
const PRIORITY_PLACEHOLDER_TITLE = "Web Clipper task p1";
const PRIORITY_WAIT_MS = 2000;
const PRIORITY_POLL_MS = 150;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Chrome exposes chrome-extension://<id>/ and Firefox moz-extension://<uuid>/.
// This hostname is what the browser matches against initiatorDomains.
const EXTENSION_HOST = new URL(chrome.runtime.getURL("")).hostname;
const IS_FIREFOX = chrome.runtime.getURL("").startsWith("moz-extension:");
let originRulePromise;
let legacyRuleCleanupPromise;

if (IS_FIREFOX) {
  // Firefox does not reliably apply the DNR modifyHeaders rule to
  // extension-originated fetches, so remove Origin with webRequest instead.
  // The listener deliberately does not filter by initiator: Firefox reports
  // this extension's background fetches inconsistently (originUrl, tabId),
  // so every request to the local API URL is covered.
  // Firefox match patterns do not support port numbers, so the filter covers
  // loopback and the listener checks the API port itself.
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (!details.url.startsWith(`${API_BASE}/`)) return {};
      if (!details.requestHeaders) return {};

      return {
        requestHeaders: details.requestHeaders.filter(
          (header) => header.name.toLowerCase() !== "origin"
        )
      };
    },
    { urls: ["http://127.0.0.1/*"] },
    ["blocking", "requestHeaders"]
  );
}

chrome.runtime.onInstalled.addListener(() => {
  // Recreate the menu so an update never trips over the previous installation's item.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Add to Super Productivity",
      contexts: ["page", "link", "selection"]
    }, () => {
      // Reading lastError keeps a failed recreate from being reported as unchecked.
      chrome.runtime.lastError;
    });
  });
  ensureOriginRule().catch((error) => setGlobalFeedback(false, error.message));
});

chrome.runtime.onStartup.addListener(() => {
  ensureOriginRule().catch((error) => setGlobalFeedback(false, error.message));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  createTaskFromContext(info, tab).catch((error) => {
    setTabFeedback(tab?.id, false, getErrorMessage(error));
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    return false;
  }

  if (message?.type === "GET_PROJECTS") {
    getProjects()
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
    return true;
  }

  if (message?.type === "TEST_CONNECTION") {
    testConnection()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, step: "health", error: serializeError(error) }));
    return true;
  }

  if (message?.type === "CREATE_TASK" && isTaskInput(message.task)) {
    createTask(message.task)
      .then((data) => {
        setTabFeedback(message.tabId, true, "Task added to Super Productivity.");
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        setTabFeedback(message.tabId, false, getErrorMessage(error));
        sendResponse({ ok: false, error: serializeError(error) });
      });
    return true;
  }

  sendResponse({ ok: false, error: serializeError(new Error("Unsupported message.")) });
  return false;
});

async function createTaskFromContext(info, tab) {
  const pageUrl = info.linkUrl || info.pageUrl || tab?.url || "";
  const title = tab?.title || pageUrl;
  if (!title.trim()) {
    throw new Error("The current page has no title to use for a task.");
  }

  const selection = typeof info.selectionText === "string" ? info.selectionText.trim() : "";
  const task = {
    // The selection already becomes the title, so do not also quote it in the notes.
    title: selection || title,
    url: pageUrl,
    selectedText: ""
  };
  await createTask(task);
  setTabFeedback(tab?.id, true, "Task added to Super Productivity.");
}

async function createTask(taskInput) {
  const settings = await chrome.storage.local.get(["accessToken"]);
  const token = settings.accessToken || "";
  const title = taskInput.title.trim();
  const body = {
    title,
    // The popup sends the note exactly as the user edited it; the context
    // menu sends the URL and selection for the extension to format.
    notes: typeof taskInput.notes === "string"
      ? redactToken(taskInput.notes, token)
      : makeNotes(taskInput.url || "", taskInput.selectedText || "", token),
    isIgnoreShortSyntax: true
  };

  body.projectId = taskInput.projectId || INBOX_PROJECT_ID;
  // Always send tagIds, even when empty, so the app does not fall back to the
  // tag currently selected in its sidebar.
  body.tagIds = Array.isArray(taskInput.tagIds) ? taskInput.tagIds : [];
  if (taskInput.deadlineDay) body.deadlineDay = taskInput.deadlineDay;

  if (taskInput.isHighPriority) body.priority = HIGH_PRIORITY;

  const task = await apiRequest("/tasks", { method: "POST", token, body });
  if (!taskInput.isHighPriority || isHighPriority(task?.priority)) {
    return { task, priorityApplied: true };
  }
  // This app version drops `priority`; fall back to short syntax.
  return setHighPriorityViaShortSyntax(task, title, token);
}

// App versions whose REST API ignores `priority` still parse priority short
// syntax. Rename the task to a placeholder ending in "p1" (parsed), so the real
// title never goes through short syntax. The app parses asynchronously, so
// wait until it has stripped the token, then restore the real title literally.
async function setHighPriorityViaShortSyntax(task, title, token) {
  if (!task?.id) return { task, priorityApplied: false };
  const taskPath = `/tasks/${encodeURIComponent(task.id)}`;

  try {
    await apiRequest(taskPath, {
      method: "PATCH",
      token,
      body: { title: PRIORITY_PLACEHOLDER_TITLE }
    });
  } catch {
    // The task already has its real title; it just has no priority.
    return { task, priorityApplied: false };
  }

  let priorityApplied = false;
  const deadline = Date.now() + PRIORITY_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PRIORITY_POLL_MS));
    try {
      const current = await apiRequest(taskPath, { token });
      priorityApplied = isHighPriority(current?.priority);
      // Parsing is done once the token is gone from the title.
      if (current?.title !== PRIORITY_PLACEHOLDER_TITLE) break;
    } catch {
      // Stop waiting, but still restore the real title below.
      break;
    }
  }

  try {
    const restored = await apiRequest(taskPath, {
      method: "PATCH",
      token,
      body: { title, isIgnoreShortSyntax: true }
    });
    return { task: restored, priorityApplied };
  } catch (error) {
    throw new Error(
      `The task was created, but its title could not be restored (${getErrorMessage(error)}). ` +
      "Rename it in Super Productivity."
    );
  }
}

function isHighPriority(priority) {
  return priority === HIGH_PRIORITY || priority === "high";
}

async function getProjects() {
  const settings = await chrome.storage.local.get(["accessToken"]);
  return apiRequest("/projects", { token: settings.accessToken || "" });
}

async function testConnection() {
  try {
    await apiRequest("/health", { authenticate: false });
  } catch (error) {
    return { ok: false, step: "health", error: serializeError(error) };
  }

  try {
    await getProjects();
  } catch (error) {
    return { ok: false, step: "projects", error: serializeError(error) };
  }

  return { ok: true };
}

async function apiRequest(path, { method = "GET", token = "", body, authenticate = true } = {}) {
  await ensureOriginRule();

  if (IS_FIREFOX) {
    // Firefox treats host permissions as revocable, so confirm access before
    // fetching; otherwise the CORS failure is reported as "not running".
    let hasHostAccess = true;
    try {
      hasHostAccess = await chrome.permissions.contains({ origins: [API_HOST_PERMISSION] });
    } catch {
      // Fall through to the fetch so a permissions API hiccup is not fatal.
    }
    if (!hasHostAccess) throw new PermissionError();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = { Accept: "application/json" };

  if (authenticate) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let envelope;
    let unreadable = false;

    if (text.trim()) {
      try {
        envelope = JSON.parse(text);
      } catch {
        unreadable = true;
      }
    }

    if (!response.ok) {
      const apiError = envelope?.error;
      throw new ApiError(
        redactToken(apiError?.code || `HTTP_${response.status}`, token),
        redactToken(apiError?.message || `Request failed with HTTP ${response.status}.`, token),
        response.status
      );
    }

    if (unreadable) {
      throw new ApiError(
        "INVALID_RESPONSE",
        `The app returned a response the extension could not read (HTTP ${response.status}).`,
        response.status
      );
    }

    if (envelope && envelope.ok !== true) {
      const apiError = envelope.error;
      throw new ApiError(
        redactToken(apiError?.code || `HTTP_${response.status}`, token),
        redactToken(apiError?.message || `Request failed with HTTP ${response.status}.`, token),
        response.status
      );
    }

    return envelope?.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError();
  } finally {
    clearTimeout(timeoutId);
  }
}

function ensureOriginRule() {
  if (IS_FIREFOX) {
    // Remove any DNR rule installed by an earlier build; the webRequest
    // listener above now handles Firefox.
    legacyRuleCleanupPromise ??= clearLegacyOriginRule();
    return legacyRuleCleanupPromise;
  }

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
            initiatorDomains: [EXTENSION_HOST],
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

async function clearLegacyOriginRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ORIGIN_RULE_ID]
    });
  } catch {
    // Firefox no longer grants the DNR permission, so there is nothing to clean up.
  }
}

function makeNotes(url, selectedText, token) {
  const notes = [redactToken(url, token)];
  if (selectedText) {
    const quoted = redactToken(selectedText, token)
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
    notes.push("", quoted);
  }
  return notes.join("\n");
}

function redactToken(message, token) {
  return token ? message.split(token).join("[redacted]") : message;
}

function isTaskInput(task) {
  const isOptional = (value, type) => value === undefined || value === null || typeof value === type;
  return Boolean(task) && typeof task.title === "string" && task.title.trim().length > 0 &&
    isOptional(task.notes, "string") &&
    isOptional(task.url, "string") && isOptional(task.selectedText, "string") &&
    isOptional(task.projectId, "string") &&
    isOptional(task.isHighPriority, "boolean") &&
    (task.deadlineDay === undefined || task.deadlineDay === null || task.deadlineDay === "" ||
      (typeof task.deadlineDay === "string" && DATE_RE.test(task.deadlineDay)));
}

function setTabFeedback(tabId, success, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.action.setBadgeBackgroundColor({ tabId, color: success ? "#188038" : "#b3261e" });
  chrome.action.setBadgeText({ tabId, text: success ? "OK" : "ERR" });
  chrome.action.setTitle({ tabId, title: message });
}

function setGlobalFeedback(success, message) {
  chrome.action.setBadgeBackgroundColor({ color: success ? "#188038" : "#b3261e" });
  chrome.action.setBadgeText({ text: success ? "OK" : "ERR" });
  chrome.action.setTitle({ title: message });
}

function serializeError(error) {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof RuleSetupError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof PermissionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof NetworkError) {
    return { code: "NETWORK_OR_TIMEOUT", message: getErrorMessage(error) };
  }
  return { code: "UNKNOWN", message: getErrorMessage(error) };
}

function getErrorMessage(error) {
  if (error instanceof ApiError && error.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc.";
  }
  if (error instanceof ApiError && error.code === "FORBIDDEN") {
    return "The app rejected the request. Super Productivity may have changed its API; check for an extension update.";
  }
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof PermissionError) return error.message;
  if (error instanceof NetworkError) {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  return error?.message || "Unexpected error.";
}

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

class PermissionError extends Error {
  constructor() {
    super("Firefox has not granted this extension access to 127.0.0.1. Open the options page and click Grant access, or enable it in about:addons -> this extension -> Permissions.");
    this.name = "PermissionError";
    this.code = "HOST_PERMISSION_MISSING";
  }
}

class RuleSetupError extends Error {
  constructor(detail) {
    super(detail
      ? `The extension could not install the narrowly scoped local API request rule: ${detail}`
      : "The extension could not install the narrowly scoped local API request rule.");
    this.name = "RuleSetupError";
    this.code = "ORIGIN_RULE_SETUP_FAILED";
  }
}
