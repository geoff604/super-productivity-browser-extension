const tokenInput = document.getElementById("token");
const saveButton = document.getElementById("save");
const testButton = document.getElementById("test");
const statusOutput = document.getElementById("status");

loadSettings();
saveButton.addEventListener("click", saveSettings);
testButton.addEventListener("click", testConnection);

async function loadSettings() {
  const settings = await chrome.storage.local.get(["accessToken"]);
  tokenInput.value = settings.accessToken || "";
}

async function saveSettings() {
  await chrome.storage.local.set({
    accessToken: tokenInput.value.trim()
  });
  showStatus("Settings saved locally.", true);
}

async function testConnection() {
  await saveSettings();
  setBusy(true);
  showStatus("Checking GET /health...", true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (result.ok) {
      showStatus("Connection successful: GET /health and authenticated GET /projects succeeded.", true);
      return;
    }

    const failedStep = result.step === "health" ? "GET /health" : "authenticated GET /projects";
    showStatus(`${failedStep} failed: ${formatError(result.error)}`, false);
  } catch (error) {
    showStatus(formatError(error), false);
  } finally {
    setBusy(false);
  }
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

function showStatus(message, success) {
  statusOutput.textContent = message;
  statusOutput.style.color = success ? "#188038" : "#b3261e";
}

function setBusy(isBusy) {
  testButton.disabled = isBusy;
  saveButton.disabled = isBusy;
  testButton.textContent = isBusy ? "Testing..." : "Test connection";
}
