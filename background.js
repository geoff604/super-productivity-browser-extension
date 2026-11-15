// Manifest permission rationale:
// activeTab grants access to the page only after the user invokes the action or context menu.
// scripting reads selected text from that granted tab; no content script makes network requests.
// contextMenus adds the requested page, link, and selection menu item.
// storage reads the locally saved token and optional default project ID.
// declarativeNetRequest removes Origin only from this extension's API requests, which the app rejects otherwise.
// host_permissions is limited to the Super Productivity loopback REST API.

const API_BASE = "http://127.0.0.1:3876";
const REQUEST_TIMEOUT_MS = 10000;
const MENU_ID = "add-to-super-productivity";
const ORIGIN_RULE_ID = 1;
let originRulePromise;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add to Super Productivity",
    contexts: ["page", "link", "selection"]
  });
  ensureOriginRule().catch((error) => setActionFeedback(false, error.message));
});

chrome.runtime.onStartup.addListener(() => {
  ensureOriginRule().catch((error) => setActionFeedback(false, error.message));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  createTaskFromContext(info, tab).catch((error) => {
    setActionFeedback(false, getErrorMessage(error));
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
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: serializeError(error) }));
    return true;
  }

  return false;
});

async function createTaskFromContext(info, tab) {
  const pageUrl = info.linkUrl || info.pageUrl || tab?.url || "";
  const title = tab?.title || pageUrl;
  if (!title.trim()) {
    throw new Error("The current page has no title to use for a task.");
  }

  const selection = typeof info.selectionText === "string" ? info.selectionText.trim() : "";
  const settings = await chrome.storage.local.get(["accessToken", "defaultProjectId"]);
  const task = {
    title: selection || title,
    url: pageUrl,
    selectedText: selection,
    projectId: settings.defaultProjectId || ""
  };
  await createTask(task);
  setActionFeedback(true, "Task added to Super Productivity.");
}

async function createTask(taskInput) {
  const settings = await chrome.storage.local.get(["accessToken"]);
  const body = {
    title: taskInput.title.trim(),
    notes: makeNotes(taskInput.url, taskInput.selectedText, settings.accessToken || ""),
    isIgnoreShortSyntax: true
  };

  if (taskInput.projectId) body.projectId = taskInput.projectId;

  return apiRequest("/tasks", {
    method: "POST",
    token: settings.accessToken || "",
    body
  });
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
    const envelope = await response.json();

    if (!response.ok || envelope?.ok !== true) {
      const apiError = envelope?.error;
      throw new ApiError(
        redactToken(apiError?.code || `HTTP_${response.status}`, token),
        redactToken(apiError?.message || `Request failed with HTTP ${response.status}.`, token),
        response.status
      );
    }

    return envelope.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError();
  } finally {
    clearTimeout(timeoutId);
  }
}

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
  return task && typeof task.title === "string" && task.title.trim().length > 0 &&
    typeof task.url === "string" && typeof task.selectedText === "string" &&
    typeof task.projectId === "string";
}

function setActionFeedback(success, message) {
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
  return { code: "NETWORK_OR_TIMEOUT", message: getErrorMessage(error) };
}

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
