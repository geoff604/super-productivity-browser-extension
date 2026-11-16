# Add Task to Super Productivity

An unofficial Chrome extension that adds the current tab to your Super Productivity task list in one click.

> Not affiliated with, endorsed by, or supported by Super Productivity or its author, Johannes Millan.

## What it does

Adds the current tab as a task in the Super Productivity app. The task gets the page title, the page URL in its notes, and optionally the text you selected. You can choose a project and tags before saving.

## Requirements

- The Super Productivity desktop app, installed and running.
- The app's local REST API turned on.
- Chrome.

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

The app's local API rejects requests that carry a browser `Origin` header. To make its own requests work, the extension removes only that `Origin` header, and only for requests it makes to `http://127.0.0.1:3876/`. Nothing else about the request is changed, and the rule applies to this extension only.

## Known limits

If a Super Productivity update changes its local API, the extension may need an update. Please open a GitHub issue.

## Problems

Found a bug or something unclear? Please open an issue on this repository.

## License

MIT. See [LICENSE](LICENSE).

Built by Sravan Branwal.
