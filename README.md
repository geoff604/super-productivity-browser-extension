# Add Task to Super Productivity

An unofficial browser extension for Chrome and Firefox that adds the current tab to your Super Productivity task list in one click.

> Not affiliated with, endorsed by, or supported by Super Productivity

## What it does

Adds the current tab as a task in the Super Productivity app. The task gets the page title, the page URL in its notes, and optionally the text you selected. You can choose a project and tags before saving.

## Requirements

- The Super Productivity desktop app, installed and running.
- The app's local REST API turned on.
- Chrome, or Firefox 140 or later.

## Build

The extension is plain JavaScript with no dependencies. `src/` holds the shared runtime files and `manifests/` holds one manifest per browser.

```bash
node scripts/build.mjs
```

This writes `dist/chrome/` and `dist/firefox/`. Each folder contains the shared files plus its own `manifest.json`, ready to load or package.

### Load the build

- **Chrome:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `dist/firefox/manifest.json`.

To validate the Firefox package before submitting it:

```bash
npx web-ext lint --source-dir dist/firefox
```

## Setup

1. Open Super Productivity, then go to **Settings → Misc**.
2. Turn on **Enable local REST API**.
3. Still under **Settings → Misc**, copy the **Access Token**.
4. Open the extension's **Options** page (right-click the toolbar icon → **Options**).
5. Paste the token and click **Save**.
6. Click **Test connection**. You should see a success message.

If **Test connection** fails, check that the app is running and the local REST API is still enabled.

## How to use

- **Popup:** Click the toolbar icon, adjust the title if you like, optionally pick a project or tags, then click **Add to Super Productivity**.
- **Right-click menu:** Right-click a page, a link, or some selected text and choose **Add to Super Productivity**.
- **Keyboard shortcut:** Press `Ctrl+Shift+Y` to open the popup.

While a task is being saved, the popup button reads **Adding...** and the Options test button reads **Testing...**.

## What goes into the task

| How you add it | Task title | Notes |
|---|---|---|
| Popup, **Page title** source, no selected text | the page title (editable) | the page URL |
| Popup, **Page title** source, text in **Selected text** | the page title (editable) | the page URL, then that text quoted line by line with `>` |
| Popup, **Selected text** source | the selected text (editable) | the page URL |
| Right-click with text selected | the selected text | the page URL, or the link URL if you right-clicked a link |
| Right-click with nothing selected | the page title | the page URL, or the link URL if you right-clicked a link |

The page title and selected text are only ever sent to the app on your own computer.

## Why the extension changes a request header

The extension has to remove the `Origin` header because the app's API rejects browser requests that include it. The two browsers need different mechanisms:

- **Chrome** uses the `declarativeNetRequestWithHostAccess` permission for a rule scoped to this extension's own requests to `http://127.0.0.1:3876/`.
- **Firefox** uses the `webRequest` and `webRequestBlocking` permissions with a listener that removes `Origin` from any request to `http://127.0.0.1:3876/`. Firefox does not reliably identify this extension's own background requests there, so the listener cannot be scoped to them; it is still limited to that one local URL.

Nothing else about the request is changed, and neither mechanism applies to requests from ordinary web pages.

## Project layout

```text
src/                 shared runtime files (background, popup, options, icons)
manifests/           chrome.json and firefox.json
scripts/build.mjs    copies src/ into dist/chrome and dist/firefox
dist/                generated packages (not committed)
```

## Known limits

If a Super Productivity update changes its local API, the extension may need an update. Please open a GitHub issue.

## Problems

Found a bug or something unclear? Please open an issue on this repository.

## License

MIT. See [LICENSE](LICENSE).

Built by Sravan Branwal.
