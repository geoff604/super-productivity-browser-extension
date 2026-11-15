const titleInput = document.getElementById("title");
const urlOutput = document.getElementById("url");
const selectionInput = document.getElementById("selection");
const selectionChoice = document.querySelector('input[name="titleSource"][value="selection"]');
const projectSelect = document.getElementById("project");
const submitButton = document.getElementById("submit");
const statusOutput = document.getElementById("status");

let pageTitle = "";
let pageUrl = "";

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

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

  const settings = await chrome.storage.local.get(["defaultProjectId"]);
  if (settings.defaultProjectId) {
    const option = document.createElement("option");
    option.value = settings.defaultProjectId;
    option.textContent = `Default project (${settings.defaultProjectId})`;
    option.selected = true;
    projectSelect.append(option);
  }

  const projects = await sendMessage({ type: "GET_PROJECTS" });
  if (!projects.ok) {
    showError(formatError(projects.error));
    return;
  }
}

async function submitTask() {
  const title = titleInput.value.trim();
  if (!title) {
    showError("Enter a task title.");
    titleInput.focus();
    return;
  }

  setBusy(true);
  statusOutput.textContent = "";
  try {
    const result = await sendMessage({
      type: "CREATE_TASK",
      task: {
        title,
        url: pageUrl,
        selectedText: selectionInput.value.trim(),
        projectId: projectSelect.value
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
  if (error?.code === "NETWORK_OR_TIMEOUT") {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  if (error?.code && error?.message) return `${error.code}: ${error.message}`;
  return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Adding..." : "Add to Super Productivity";
}
