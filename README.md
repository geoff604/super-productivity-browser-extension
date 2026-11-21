# Web Clipper for Super Productivity

An unofficial browser extension for Chrome and Firefox that adds the current tab to your Super Productivity task list in one click.

## What it does

Adds the current tab as a task in the Super Productivity app. The popup fills in the page title as the task title, and a note with the title, the page URL and any text you selected. Before saving you can pick a project, mark the task High priority with the star, set a deadline, and edit the note.

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

- **Popup:** Click the toolbar icon (or press `Ctrl+Shift+Y`). Pick a project, adjust the title and note, optionally star it or set a deadline, then click **Add** or **Add & Close**.
- **Right-click menu:** Right-click a page, a link, or some selected text and choose **Add to Super Productivity**.

### The popup

- **Project:** starts on the Inbox. The dropdown has focus when the popup opens, so you can type part of a project name right away. Matches are ranked exact, prefix, word start, substring, then fuzzy (small typos are fine), and leading emojis in project names are ignored. Use `↑`/`↓` and `Enter` to pick, `Escape` or `Backspace` to clear the search. The project list is cached so the popup opens instantly, then refreshes in the background.
- **Star:** sets the task to **High** priority.
- **Title:** the page title. On Gmail, the ` - you@gmail.com - Gmail` suffix is removed. Press `Enter` in the title to add.
- **Deadline:** sets the task's deadline day. A deadline of today also plans the task for Today, as in the app.
- **Note:** becomes the task's notes exactly as shown. It starts with the title, the page URL, and any text you had selected.
- **Add** saves the task and clears the form; **Add & Close** (or `Ctrl+Shift+Enter` anywhere) saves and closes the popup.
- **🌓 Theme** switches between light and dark. Until you use it, the popup follows your system theme.

### How High priority is set

A starred task is sent with `priority: 3` (High). Current Super Productivity versions ignore that field in the local REST API, so when the created task comes back without a priority, the extension falls back to short syntax: it renames the task to a placeholder ending in `p1`, waits for the app to turn that into High priority, then restores the real title, stored literally. Your page title itself is never parsed as short syntax. The fallback needs priority short syntax turned on (it is by default); if the priority does not appear, the popup says so.

## What goes into the task

| How you add it | Task title | Notes |
|---|---|---|
| Popup | the title field | the note field, exactly as shown |
| Right-click with text selected | the selected text | the page URL, or the link URL if you right-clicked a link |
| Right-click with nothing selected | the page title | the page URL, or the link URL if you right-clicked a link |

The page title and selected text are only ever sent to the app on your own computer.

## Why the extension changes a request header

The extension has to remove the `Origin` header because the app's API rejects browser requests that include it. The two browsers need different mechanisms:

- **Chrome** uses the `declarativeNetRequestWithHostAccess` permission for a rule scoped to this extension's own requests to `http://127.0.0.1:3876/`.
- **Firefox** uses the `webRequest` and `webRequestBlocking` permissions with a listener that removes `Origin` from any request to `http://127.0.0.1:3876/`. Firefox does not reliably identify this extension's own background requests there, so the listener cannot be scoped to them; it is still limited to that one local URL.

Nothing else about the request is changed. On Chrome the rule applies only to this extension's own requests. On Firefox it applies to any request to that local URL, including requests from web pages. The API still requires the access token.

## Project layout

```text
src/                 shared runtime files (background, popup, smart-dropdown, options, icons)
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
