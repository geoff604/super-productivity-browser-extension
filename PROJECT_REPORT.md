# Project report: Super Productivity page clipper

## 1. Project summary

This is a plain-JavaScript Chrome Manifest V3 extension for clipping the current
web page into a task in the Super Productivity desktop app. It can be opened from
the toolbar popup or a keyboard shortcut, and it can create a task directly from
a page, link, or selection context menu.

The extension talks to the desktop app's Local REST API at
`http://127.0.0.1:3876`. It does not use a Super Productivity plugin, a build
step, a framework, or a content script for network requests.

## 2. Project files

```text
first-extension/
├── manifest.json
├── background.js
├── popup.html
├── popup.js
├── options.html
├── options.js
└── PROJECT_REPORT.md
```

Chrome looks for `manifest.json` at the root of the folder selected with **Load
unpacked**. The project keeps the small extension flat; folders such as `popup/`
or `scripts/` are optional organizational choices, not prerequisites.

## 3. How a clip becomes a task

1. The popup reads the active tab's title and URL. It uses the `scripting`
   permission to read selected text when the page permits it. On restricted
   pages, title and URL are still used, while selected text is unavailable.
2. The user can edit the title and selected text, and can choose selected text
   as the title. The right-click menu creates a task directly; if a selection
   was right-clicked, that text becomes the task title.
3. The popup or context-menu handler sends a message to the background service
   worker. The service worker is the only place that makes API requests.
4. The worker sends `POST /tasks` with the title, notes containing the page URL
   and quoted selection, and `isIgnoreShortSyntax: true`. It includes
   `projectId` only when a project ID was selected.
5. The worker shows success or an actionable error. Context-menu feedback uses
   the extension action badge because no popup is open.

The Options page stores the access token and optional default project ID using
`chrome.storage.local`, not sync storage. Its connection test calls
unauthenticated `GET /health` first, then authenticated `GET /projects`.
Requests use a 10-second `AbortController` timeout.

## 4. Important implementation and security decisions

| Decision | Reason |
|---|---|
| Use the Local REST API | It is the documented desktop-app interface for this task; no plugin is needed. |
| Store the token locally | The access token should not sync to another device. |
| Send the token in `Authorization: Bearer ...` | This is the documented authentication method; the token is not put in a URL or logged. |
| Always send `isIgnoreShortSyntax: true` | Web-page text is untrusted. Strings such as `#test`, `+Inbox`, or `30m` should remain literal task text. |
| Put the URL in task notes | The documented create-task fields do not provide a separate attachment/link field for this use. |
| Keep host access to `127.0.0.1:3876` | The extension only needs to contact the local API. |
| Use a narrowly scoped DNR rule | The app rejects requests with an `Origin` header. The dynamic rule removes that header only for requests initiated by this extension to the fixed API URL. It does not use the broader rule that would match other browser origins. |

The DNR rule adds a permission beyond the original minimum permission set. It is
an intentional compatibility/security trade-off: the app's origin check is
being bypassed for this extension's API calls, while the API's bearer-token
authentication remains in use.

## 5. Work completed and current status

- Implemented the Manifest V3 manifest, service worker, popup, and Options page.
- Added the page/link/selection context menu and toolbar keyboard shortcut.
- Added timeout handling, API-envelope error handling, token redaction, and local
  token storage.
- Investigated the reported `FORBIDDEN: Requests from web origins are not
  allowed` response and added a dynamic, extension-initiated-only Origin
  removal rule.
- Checked that the manifest is valid JSON and that its host permission and DNR
  rule scope match the intended values.

**Not yet verified:** The extension still needs to be reloaded and exercised in
Chrome after the DNR change. A JavaScript syntax check could not be run in the
development environment because it had no Node.js runtime. Do not describe the
end-to-end connection or task creation as verified until those browser tests
pass.

**Known incomplete requirement:** The supplied API docs name `GET /projects` but
do not document its response shape or project ID/display-name fields. The
extension therefore does not guess how to populate project choices. The popup
can use a default project ID entered in Options, but the API-backed project
dropdown is not complete.

## 6. Suggested manual tests

1. Reload the unpacked extension in `chrome://extensions`. Open its service
   worker console and check for a DNR rule registration error.
2. In Options, enter the access token and run **Test connection**. Confirm that
   `GET /health` and authenticated `GET /projects` succeed.
3. Add a task from the popup and confirm its title, URL notes, and quoted
   selection in Super Productivity.
4. Select `#test +Inbox 30m`, right-click, choose **Add to Super Productivity**,
   and confirm the title is stored literally.
5. Try a restricted page such as `chrome://extensions`; confirm the popup still
   has the page URL and title and gracefully lacks selected text.
6. Try the keyboard shortcut and confirm it opens the popup.

## 7. Beginner concepts to remember

- **Manifest:** The extension's configuration file. It declares the extension
  version, entry points, permissions, and popup.
- **Service worker:** Event-driven background code in Manifest V3. It wakes for
  events such as a context-menu click or a message; it is not a permanent
  background page.
- **Permission:** A browser capability the extension asks to use. `activeTab`
  grants temporary access after a user action; `scripting` reads selection;
  `contextMenus` creates the right-click item; `storage` stores local settings;
  `declarativeNetRequest` applies the scoped request-header rule.
- **Host permission:** The destination the extension may contact. Here it is
  limited to the local API URL.
- **REST API:** An HTTP interface exposed by an application. `GET` reads data,
  while `POST /tasks` creates a task.
- **Localhost / `127.0.0.1`:** The current computer, not a public server.
- **Bearer token:** A secret credential sent in the `Authorization` header. Do
  not put it in a URL, task notes, logs, or error text.
- **`Origin` header:** Browser-supplied information about the request's origin.
  The local API rejects requests containing it; the DNR rule is a targeted
  workaround for this extension's requests.
- **Open question:** A documented behavior that is missing. Listing it is safer
  than guessing the API response shape.

## 8. Interview explanation

**Short version:** “I built a Manifest V3 Chrome extension that clips a page
into Super Productivity through its local REST API. I kept API access in the
service worker, stored the token locally, made web text literal with
`isIgnoreShortSyntax`, and handled the API's Origin rejection with a narrowly
scoped request rule. I also documented the project-list schema gap instead of
guessing. The Chrome end-to-end tests are still pending.”

**Why not a plugin?** The goal is to capture a browser page from Chrome. The
chosen interface is the app's Local REST API, so no in-app plugin is required.

**How is the token protected?** It is saved in `chrome.storage.local` and sent
only as a Bearer header to `127.0.0.1:3876`; it is not synced or put into notes
or URLs.

**What did the Origin fix change?** Chrome sends an Origin header with extension
requests, and the app rejects such requests. A dynamic DNR rule removes Origin
only for this extension's requests to the local API. This is a deliberate
trade-off, so I would explain its scope and verify it in Chrome before claiming
the integration works.

**What would you improve next?** Verify the DNR behavior and full task flow in
Chrome, obtain the documented `/projects` response shape to finish the project
picker, and add focused automated tests for request construction and error
mapping.

When presenting the work, distinguish implemented features from tests that are
still pending, and be ready to explain what each permission is used for.
