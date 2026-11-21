// Type-to-search for a native <select>, ported from the Microsoft To Do
// bookmarklet's SmartDropdown. With the select focused, typed characters build
// a search buffer shown above it, and ranked matches appear in a list below.
// Ranking tiers: exact > prefix > word boundary > substring > fuzzy
// (Levenshtein distance <= 2, only for searches of 3+ characters).
// Leading emojis/symbols in option text are ignored when matching.

// Strips leading emoji, symbols and whitespace, for sorting and matching.
const LEADING_SYMBOLS_RE = /^(?:[\u{0080}-\u{02AF}]|[\u{0300}-\u{03FF}]|[\u{0600}-\u{06FF}]|[\u{0C00}-\u{0C7F}]|[\u{1DC0}-\u{1DFF}]|[\u{1E00}-\u{1EFF}]|[\u{2000}-\u{209F}]|[\u{20D0}-\u{214F}]|[\u{2190}-\u{23FF}]|[\u{2460}-\u{25FF}]|[\u{2600}-\u{27EF}]|[\u{2900}-\u{29FF}]|[\u{2B00}-\u{2BFF}]|[\u{2C60}-\u{2C7F}]|[\u{2E00}-\u{2E7F}]|[\u{3000}-\u{303F}]|[\u{A490}-\u{A4CF}]|[\u{E000}-\u{F8FF}]|[\u{FE00}-\u{FE0F}]|[\u{FE30}-\u{FE4F}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{20000}-\u{2FFFF}]|\s)+/u;

function removeLeadingSymbols(text) {
  return text.replace(LEADING_SYMBOLS_RE, "");
}

const SmartDropdown = (() => {
  const INACTIVITY_MS = 120000;
  const MAX_RESULTS = 10;

  let searchBuffer = "";
  let searchTimeout = null;
  let highlightedIndex = -1;
  let currentResults = [];
  let isUpdatingOptions = false;
  let select, bufferDisplay, resultsList;

  function init(selectElement, bufferElement, resultsElement) {
    select = selectElement;
    bufferDisplay = bufferElement;
    resultsList = resultsElement;

    select.addEventListener("focus", () => {
      if (!isUpdatingOptions) clearSearch();
    });
    select.addEventListener("blur", () => {
      // Delay so a click on a result is handled first.
      setTimeout(() => {
        if (!isUpdatingOptions && document.activeElement !== select) clearSearch();
      }, 150);
    });
    select.addEventListener("keydown", handleKeyDown);

    // A click on the label focuses the select for typing without opening
    // the native picker.
    for (const label of document.querySelectorAll(`label[for="${select.id}"]`)) {
      label.addEventListener("click", (event) => {
        event.preventDefault();
        select.focus();
      });
    }

    resultsList.addEventListener("mousedown", (event) => {
      const item = event.target.closest("li[data-value]");
      event.preventDefault(); // keep focus on the select
      if (item) selectOption(item.dataset.value);
    });
  }

  function handleKeyDown(event) {
    // Let Ctrl+Shift+Enter reach the document-level Add & Close handler.
    if (event.key === "Enter" && event.ctrlKey && event.shiftKey) return;

    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
      handleNavigation(event);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      clearSearch();
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;

    // Replace the native "jump to first letter" behavior.
    event.preventDefault();
    searchBuffer += event.key.toLowerCase();
    resetInactivityTimeout();
    updateUI();
  }

  function handleNavigation(event) {
    if (!searchBuffer) return; // native select behavior when not searching
    event.preventDefault();

    if (event.key === "Escape") {
      // Stop the popup from closing on Escape while a search is open.
      event.stopPropagation();
      clearSearch();
      return;
    }
    if (event.key === "Enter") {
      // Selecting a result must not also submit the task.
      event.stopPropagation();
      if (currentResults[highlightedIndex]) selectOption(currentResults[highlightedIndex].value);
      return;
    }
    if (event.key === "ArrowDown" && highlightedIndex < currentResults.length - 1) {
      highlightedIndex += 1;
      updateHighlight();
    }
    if (event.key === "ArrowUp" && highlightedIndex > 0) {
      highlightedIndex -= 1;
      updateHighlight();
    }
  }

  // Call around a rebuild of the select's options, so the focus/blur events
  // the rebuild can fire do not reset an in-progress search.
  function beginUpdate() {
    isUpdatingOptions = true;
  }

  function endUpdate() {
    if (searchBuffer) {
      currentResults = rankOptions(searchBuffer);
      highlightedIndex = currentResults.length ? 0 : -1;
      renderList();
    }
    setTimeout(() => {
      isUpdatingOptions = false;
    }, 80);
  }

  function resetInactivityTimeout() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(clearSearch, INACTIVITY_MS);
  }

  function clearSearch() {
    if (isUpdatingOptions) return;
    searchBuffer = "";
    highlightedIndex = -1;
    currentResults = [];
    bufferDisplay.hidden = true;
    bufferDisplay.textContent = "";
    resultsList.hidden = true;
    resultsList.textContent = "";
  }

  function selectOption(value) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    clearSearch();
    select.focus();
  }

  function updateUI() {
    if (!searchBuffer) {
      clearSearch();
      return;
    }
    bufferDisplay.textContent = `Searching: "${searchBuffer}"`;
    bufferDisplay.hidden = false;
    currentResults = rankOptions(searchBuffer);
    highlightedIndex = currentResults.length ? 0 : -1;
    renderList();
  }

  function renderList() {
    resultsList.textContent = "";
    if (!currentResults.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No matches found";
      resultsList.append(empty);
    } else {
      for (const result of currentResults) {
        const item = document.createElement("li");
        item.setAttribute("role", "option");
        item.dataset.value = result.value;
        item.textContent = result.text;
        resultsList.append(item);
      }
    }
    // Unhide before highlighting so scroll measurements are real.
    resultsList.hidden = false;
    updateHighlight();
  }

  function updateHighlight() {
    const items = resultsList.querySelectorAll("li[data-value]");
    items.forEach((item, index) => {
      const isHighlighted = index === highlightedIndex;
      item.classList.toggle("highlighted", isHighlighted);
      item.setAttribute("aria-selected", String(isHighlighted));
    });

    const item = items[highlightedIndex];
    if (!item) return;
    // Keep the highlighted item inside the scrolled area.
    const top = resultsList.scrollTop;
    const bottom = top + resultsList.clientHeight;
    if (item.offsetTop < top) {
      resultsList.scrollTop = item.offsetTop;
    } else if (item.offsetTop + item.offsetHeight > bottom) {
      resultsList.scrollTop = item.offsetTop + item.offsetHeight - resultsList.clientHeight;
    }
  }

  function rankOptions(buffer) {
    const ranked = [];
    for (const option of select.options) {
      const text = option.textContent;
      const score = calculateScore(buffer, removeLeadingSymbols(text).trim().toLowerCase());
      if (score > 0) ranked.push({ text, value: option.value, score });
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }

  function calculateScore(buffer, target) {
    const bufLen = buffer.length;
    const targetLen = target.length;

    if (buffer === target) return 1000;
    if (target.startsWith(buffer)) return 900 - targetLen;

    if (target.split(/\s+/).some((word) => word.startsWith(buffer))) return 700 - targetLen;

    const index = target.indexOf(buffer);
    if (index !== -1) return 600 - index;

    if (bufLen >= 3) {
      const prefixDist = levenshtein(buffer, target.substring(0, bufLen));
      if (prefixDist <= 2) return 400 - prefixDist * 50;

      let minSubDist = Infinity;
      for (let i = 0; i <= targetLen - bufLen; i += 1) {
        minSubDist = Math.min(minSubDist, levenshtein(buffer, target.substring(i, i + bufLen)));
      }
      if (minSubDist <= 2) return 200 - minSubDist * 50;
    }

    return 0;
  }

  function levenshtein(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, () => []);
    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        matrix[i][j] = a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
      }
    }
    return matrix[a.length][b.length];
  }

  return { init, beginUpdate, endUpdate };
})();
