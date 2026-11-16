const titleInput = document.getElementById("title");
const urlOutput = document.getElementById("url");
const selectionInput = document.getElementById("selection");
const selectionChoice = document.querySelector('input[name="titleSource"][value="selection"]');
const projectSelect = document.getElementById("project");
const tagSearch = document.getElementById("tagSearch");
const tagList = document.getElementById("tagList");
const tagChips = document.getElementById("tagChips");
const submitButton = document.getElementById("submit");
const statusOutput = document.getElementById("status");

let pageTitle = "";
let pageUrl = "";
let activeTabId;
let allTags = [];
const selectedTagIds = new Set();

initialize().catch((error) => showError(formatError(error)));

document.querySelectorAll('input[name="titleSource"]').forEach((choice) => {
  choice.addEventListener("change", () => {
    if (choice.checked) {
      titleInput.value = choice.value === "selection" ? selectionInput.value : pageTitle;
    }
  });
});

selectionInput.addEventListener("input", () => {
  if (selectionChoice.checked) titleInput.value = selectionInput.value;
});

submitButton.addEventListener("click", submitTask);
titleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    submitTask();
  }
});
tagSearch.addEventListener("input", renderTags);

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  pageTitle = tab?.title || tab?.url || "";
  pageUrl = tab?.url || "";
  titleInput.value = pageTitle;
  urlOutput.textContent = pageUrl;

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

  const [projects] = await Promise.all([
    sendMessage({ type: "GET_PROJECTS" }).catch((error) => ({ ok: false, error })),
    loadTags()
  ]);

  if (!projects?.ok) {
    showError(formatError(projects?.error));
    return;
  }
  fillProjects(projects.data);
}

function fillProjects(projects) {
  const visible = (Array.isArray(projects) ? projects : [])
    .filter((project) => project && !project.isArchived && !project.isHiddenFromMenu && !project.isDone);

  for (const project of visible) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.title || "";
    projectSelect.append(option);
  }
}

async function loadTags() {
  try {
    const result = await sendMessage({ type: "GET_TAGS" });
    if (!result.ok) throw result.error;
    fillTags(result.data);
  } catch (error) {
    tagList.textContent = formatError(error);
  }
}

function fillTags(tags) {
  allTags = (Array.isArray(tags) ? tags : []).filter((tag) => tag && tag.id);
  renderTags();
}

function renderTags() {
  tagList.textContent = "";
  if (!allTags.length) {
    tagList.textContent = "No tags available.";
    return;
  }

  const query = tagSearch.value.trim().toLowerCase();
  const matches = allTags.filter((tag) => tagTitle(tag).toLowerCase().includes(query));
  if (!matches.length) {
    tagList.textContent = "No tags match.";
    return;
  }

  for (const tag of matches) {
    const label = document.createElement("label");
    label.className = "choice";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = tag.id;
    box.checked = selectedTagIds.has(tag.id);
    box.addEventListener("change", () => {
      if (box.checked) selectedTagIds.add(tag.id);
      else selectedTagIds.delete(tag.id);
      renderChips();
    });
    label.append(box, tagTitle(tag));
    tagList.append(label);
  }
}

function renderChips() {
  tagChips.textContent = "";
  for (const id of selectedTagIds) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove tag ${findTagTitle(id)}`);
    remove.addEventListener("click", () => {
      selectedTagIds.delete(id);
      renderChips();
      const box = tagList.querySelector(`input[value="${CSS.escape(id)}"]`);
      if (box) box.checked = false;
    });
    chip.append(findTagTitle(id), remove);
    tagChips.append(chip);
  }
}

function tagTitle(tag) {
  return tag.title || tag.id;
}

function findTagTitle(id) {
  const tag = allTags.find((item) => item.id === id);
  return tag ? tagTitle(tag) : id;
}

async function submitTask() {
  if (submitButton.disabled) return;

  const title = titleInput.value.trim();
  if (!title) {
    showError("Enter a task title.");
    titleInput.focus();
    return;
  }

  setBusy(true);
  statusOutput.textContent = "";
  const tagIds = [...selectedTagIds];
  try {
    const result = await sendMessage({
      type: "CREATE_TASK",
      tabId: activeTabId,
      task: {
        title,
        url: pageUrl,
        selectedText: selectionInput.value.trim(),
        projectId: projectSelect.value,
        tagIds
      }
    });
    if (!result.ok) throw result.error;
    statusOutput.textContent = "Task added to Super Productivity.";
    statusOutput.style.color = "#188038";
  } catch (error) {
    showError(formatError(error));
  } finally {
    setBusy(false);
  }
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function showError(message) {
  statusOutput.textContent = message;
  statusOutput.style.color = "#b3261e";
}

function formatError(error) {
  if (error?.code === "UNAUTHORIZED" || error?.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc.";
  }
  if (error?.code === "FORBIDDEN") {
    return "The app rejected the request. Super Productivity may have changed its API; check for an extension update.";
  }
  if (error?.code === "NETWORK_OR_TIMEOUT") {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  if (error?.code === "UNKNOWN") return error.message || "Something went wrong.";
  if (error?.code && error?.message) return `${error.code}: ${error.message}`;
  return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Adding..." : "Add to Super Productivity";
}
