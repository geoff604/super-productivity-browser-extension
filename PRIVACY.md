# Privacy Policy: Add Task to Super Productivity

Last updated: 2026-11-16

Short version: this extension sends your data only to the Super Productivity app on your own computer. Nothing goes to the developer or to any third party.

## What it stores

The extension stores exactly one key in `chrome.storage.local`:

- **`accessToken`** — the Super Productivity access token you paste on the Options page.

`chrome.storage.local` is this browser profile's local extension storage. It is not synced to other devices. The extension does not encrypt the token; it is stored as you entered it.

There are no other saved keys. The extension keeps no history, no settings, and no statistics.

You can remove the token at any time by clearing the field on the Options page and clicking **Save**, or by removing the extension.

## What it reads

- **The active tab's title and URL**, when you open the popup.
- **The text you have selected on the page**, when you open the popup. This only works on pages where Chrome allows it.
- **The page URL, page title, and selected text**, when you use the right-click menu item.
- **Project and tag lists**, read from the local API so you can pick them.

## What goes into a task

- **Popup:** the title is the page title, or the selected text if you choose **Selected text** as the title source; you can edit it before saving. The notes are the page URL. If **Page title** is the title source and the **Selected text** box has text, that text is appended to the notes, quoted line by line with `>`.
- **Right-click:** the title is the selected text if there is any, otherwise the page title. The notes are the page URL, or the link URL if you right-clicked a link. A right-clicked selection is not repeated in the notes.

## Where your data goes

Only to `http://127.0.0.1:3876`, the local REST API of the Super Productivity app on your own computer. `127.0.0.1` means "this computer"; it is not a public server.

The extension sends:

- `POST /tasks` with the task title, the notes described above, the project ID, and the tag IDs.
- `GET /projects` and `GET /tags` when the popup opens.
- `GET /health` when you click **Test connection**.
- Your token in an `Authorization: Bearer` header to that same address.

It does not send anything to the developer, to an analytics service, or to any other server. If your token happens to appear in a page URL or in the selected text, the extension removes it before saving the task.

## Analytics and tracking

None. The extension contains no analytics, no telemetry, no advertising identifiers, and no cookies.

## Remote code

None. All code is included in the extension package. It does not download or run code from the internet and does not use `eval`.

## What this policy does not cover

What Super Productivity does with a task after it is saved, including any sync you have configured inside the app. That is governed by the app's own privacy documentation.

## Permissions and why they are needed

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's title and URL after you open the popup or use the menu. |
| `scripting` | Read the text you have selected on the page. |
| `contextMenus` | Add the **Add to Super Productivity** right-click item, which appears for pages, links, and selections. |
| `storage` | Save your access token locally. |
| `declarativeNetRequestWithHostAccess` | Remove the `Origin` header from this extension's own requests to the local API. |
| Host: `http://127.0.0.1:3876/*` | Talk to the local API and nothing else. |

## Changes to this policy

If this policy changes, the update will appear in this file in the project repository.

## Contact

Please open an issue on this repository.
