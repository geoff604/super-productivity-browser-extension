const INBOX_PROJECT_ID = "INBOX_PROJECT";
const PROJECTS_CACHE_KEY = "projectsCache";
const THEME_KEY = "theme";

const projectSelect = document.getElementById("project");
const starButton = document.getElementById("star");
const titleInput = document.getElementById("title");
const deadlineInput = document.getElementById("deadline");
const noteInput = document.getElementById("note");
const addButton = document.getElementById("add");
const addCloseButton = document.getElementById("add-close");
const themeToggle = document.getElementById("theme-toggle");
const statusOutput = document.getElementById("status");

let activeTabId;
let isSubmitting = false;

initTheme();
SmartDropdown.init(
  projectSelect,
  document.getElementById("search-buffer-display"),
  document.getElementById("smart-search-results")
);
// Focus the project dropdown so typing searches it straight away. Firefox
// ignores focus() until the popup has painted, hence the deferred retry.
projectSelect.focus();
setTimeout(() => {
  if (document.activeElement === document.body) projectSelect.focus();
}, 50);

initialize().catch((error) => showStatus(formatError(error), "err"));

starButton.addEventListener("click", () => setStarred(starButton.getAttribute("aria-pressed") !== "true"));
addButton.addEventListener("click", () => submitTask(false));
addCloseButton.addEventListener("click", () => submitTask(true));
themeToggle.addEventListener("click", toggleTheme);

titleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    submitTask(false);
  }
});

// Ctrl+Shift+Enter anywhere: Add & Close.
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey && event.shiftKey) {
    event.preventDefault();
    submitTask(true);
  }
});

// When the title is reached with the keyboard, put the cursor at the start
// so the beginning of a long page title is visible.
let isTitleMousedown = false;
titleInput.addEventListener("mousedown", () => {
  isTitleMousedown = true;
});
titleInput.addEventListener("focus", () => {
  if (!isTitleMousedown) setTimeout(() => titleInput.setSelectionRange(0, 0), 0);
  isTitleMousedown = false;
});

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  const pageUrl = tab?.url || "";
  const pageTitle = cleanTitle(tab?.title || pageUrl, pageUrl);
  titleInput.value = pageTitle;

  let selection = "";
  if (tab?.id !== undefined) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || ""
      });
      selection = typeof result?.result === "string" ? result.result.trim() : "";
    } catch {
      // Pages such as the browser's own settings cannot be scripted.
    }
  }
  noteInput.value = makeNote(pageTitle, pageUrl, selection);

  await loadProjects();
}

// Gmail tab titles look like "Subject - you@gmail.com - Gmail"; keep only the subject.
function cleanTitle(title, url) {
  let cleaned = title.trim();
  try {
    if (new URL(url).hostname === "mail.google.com") {
      cleaned = cleaned.replace(/\s+-\s+[^\s@]+@[^\s@]+\s+-\s+Gmail$/, "").trim() || cleaned;
    }
  } catch {
    // Not a parseable URL; leave the title as it is.
  }
  return cleaned;
}

// Same layout as the Microsoft To Do bookmarklet: title, URL, then any selection.
function makeNote(title, url, selection) {
  let note = `${title}\n\n${url}`;
  if (selection) note += `\n\n${selection}\n`;
  return note;
}

async function loadProjects() {
  const cached = (await chrome.storage.local.get([PROJECTS_CACHE_KEY]))[PROJECTS_CACHE_KEY];
  if (Array.isArray(cached) && cached.length) showProjects(cached);

  const result = await chrome.runtime.sendMessage({ type: "GET_PROJECTS" })
    .catch((error) => ({ ok: false, error }));
  if (!result?.ok) {
    showStatus(formatError(result?.error), "err");
    return;
  }

  const fresh = toProjectList(result.data);
  await chrome.storage.local.set({ [PROJECTS_CACHE_KEY]: fresh });
  if (JSON.stringify(fresh) !== JSON.stringify(cached)) showProjects(fresh);
}

// Inbox first, then the visible projects sorted by name ignoring leading emoji.
function toProjectList(projects) {
  const list = (Array.isArray(projects) ? projects : [])
    .filter((project) => project?.id && !project.isArchived && !project.isHiddenFromMenu && !project.isDone)
    .map((project) => ({ id: project.id, title: project.title || project.id }));

  const inbox = list.find((project) => project.id === INBOX_PROJECT_ID) || { id: INBOX_PROJECT_ID, title: "Inbox" };
  const others = list
    .filter((project) => project.id !== INBOX_PROJECT_ID)
    .sort((a, b) => removeLeadingSymbols(a.title).localeCompare(removeLeadingSymbols(b.title)));
  return [inbox, ...others];
}

// Rebuilds the options, keeping a selection the user already made and
// otherwise starting on the Inbox.
function showProjects(projects) {
  const previous = projectSelect.value;
  SmartDropdown.beginUpdate();
  projectSelect.textContent = "";
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.title;
    projectSelect.append(option);
  }
  projectSelect.value = projects.some((project) => project.id === previous) ? previous : INBOX_PROJECT_ID;
  if (!projectSelect.value) projectSelect.selectedIndex = 0;
  SmartDropdown.endUpdate();
}

function setStarred(isStarred) {
  starButton.setAttribute("aria-pressed", String(isStarred));
}

async function submitTask(closeAfterAdd) {
  if (isSubmitting) return;

  const title = titleInput.value.trim();
  if (!title) {
    showStatus("Enter a task title.", "err");
    titleInput.focus();
    return;
  }

  const isHighPriority = starButton.getAttribute("aria-pressed") === "true";
  setBusy(true);
  showStatus("Adding...", "");
  try {
    const result = await chrome.runtime.sendMessage({
      type: "CREATE_TASK",
      tabId: activeTabId,
      task: {
        title,
        notes: noteInput.value,
        projectId: projectSelect.value || INBOX_PROJECT_ID,
        deadlineDay: deadlineInput.value || null,
        isHighPriority
      }
    });
    if (!result?.ok) throw result?.error;

    const priorityMissed = isHighPriority && result.data?.priorityApplied === false;
    if (closeAfterAdd && !priorityMissed) {
      window.close();
      return;
    }

    titleInput.value = "";
    noteInput.value = "";
    deadlineInput.value = "";
    setStarred(false);
    if (priorityMissed) {
      showStatus(
        "Task added, but High priority could not be set. Turn on priority short syntax in Super Productivity (Settings -> Short Syntax).",
        "warn"
      );
    } else {
      showStatus("Task added.", "ok");
    }
  } catch (error) {
    showStatus(formatError(error), "err");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  isSubmitting = isBusy;
  addButton.disabled = isBusy;
  addCloseButton.disabled = isBusy;
}

function showStatus(message, kind) {
  statusOutput.textContent = message;
  statusOutput.className = kind;
}

function formatError(error) {
  if (error?.code === "UNAUTHORIZED" || error?.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc, then paste it in this extension's Options.";
  }
  if (error?.code === "FORBIDDEN") {
    return "The app rejected the request. Super Productivity may have changed its API; check for an extension update.";
  }
  if (error?.code === "NETWORK_OR_TIMEOUT") {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  if (error?.code === "UNKNOWN") return error.message || "Something went wrong.";
  if (error?.code && error?.message) return `${error.code}: ${error.message}`;
  if (error?.message) return error.message;
  return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
}

// Theme: follow the system until the user picks one with the toggle.
function initTheme() {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
  chrome.storage.local.get([THEME_KEY]).then((stored) => {
    if (stored[THEME_KEY] === "dark" || stored[THEME_KEY] === "light") applyTheme(stored[THEME_KEY]);
  });
}

function applyTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function toggleTheme() {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ [THEME_KEY]: next });
}
