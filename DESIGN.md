# Todo CRDT design

This repository contains a standalone, local-first todo.txt task manager. The
browser stores the task document in IndexedDB through Yjs; a Yjs WebSocket
server is optional and is contacted only when the user chooses to connect.
There is no account, backend requirement, or automatic network sync.

## Architecture

* `index.html` is the Vite entry point and mounts the application at `#app`.
* `src/main.js` implements the Preact UI and interactions. It owns one
  Yjs document, renders the task list from that document, and observes document
  changes to refresh the UI.
* `src/todoModel.js` handles todo.txt line parsing and task
  representation in Yjs shared types.
* `src/style.css` contains the app's styles. Keep the static UI styling
  here rather than embedding it in the HTML entry point.
* `y-indexeddb` persists the Yjs document in the browser database named
  `todo-crdt-storage`. The local document loads automatically at startup.
* `y-websocket` provides optional synchronization. The user supplies a
  `ws://` or `wss://` URL and shared room name in **Sync settings**. Connections
  are not created until the user selects **Connect**. Peers connected to the
  same server and room exchange Yjs updates; disconnecting leaves local data
  intact.

## Document model

The shared Yjs document contains a `todoItems` array. Every entry is a `Y.Map`
with these fields:

| Field | Yjs type | Purpose |
| --- | --- | --- |
| `id` | string | Stable task identifier |
| `completed` | boolean | Completion state |
| `priority` | string or `null` | Optional A–Z priority |
| `completionDate` | string or `null` | Completion date in `YYYY-MM-DD` form |
| `creationDate` | string or `null` | Creation date in `YYYY-MM-DD` form |
| `text` | `Y.Text` | Collaborative task text |
| `projects` | `Y.Array` | Unique project tags |
| `contexts` | `Y.Array` | Unique context tags |

Text and tag collections use Yjs shared types so concurrent edits can merge.
Map properties hold completion, priority, and date metadata.

## Task behavior

The app supports adding, editing, completing, prioritizing, deleting, searching,
and filtering tasks by project or context. It imports todo.txt files by appending
non-empty lines (ignoring blank and `#` comment lines) to the current document;
it does not replace or deduplicate tasks. Export downloads every task regardless
of active filters.

A newly added task receives today's local date when its input does not specify
a creation date. New task input accepts todo.txt markers: `x` for completion,
`(A)`–`(Z)` for priority, `YYYY-MM-DD` dates, `+project` tags, and `@context`
tags.

Editing updates the shared text and re-extracts project and context tags. Tags
are displayed separately from the task's plain text.

## Development and deployment

Use the commands in the [README](README.md) to install dependencies, start the
Vite development server, run unit tests, and build or preview the static site.
`vite.config.js` sets the base URL to `/todo-crdt/` for the GitHub Pages project
site. The Pages workflow builds the regular multi-file `dist/` output and
deploys it with GitHub's Pages actions.

Keep the README focused on operating the project; update this document when
changing the app's data model, persistence, sync behavior, or interaction
design.
