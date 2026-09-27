# Todo CRDT

A local-first todo.txt app built with Preact and Yjs. Tasks are persisted in
this browser with IndexedDB; optional Yjs WebSocket sync can be enabled in the
app's **Sync settings**.

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Run the app at the local URL printed by Vite. Run the unit tests with
`npm test`.

## Optional WebSocket sync server

The app needs no server for local use. Sync is opt-in and the basic
`y-websocket` server is an unauthenticated relay: anyone who can reach its
address can read and modify documents, and room names are not access controls.
Do not expose the stock server directly to the public internet or put sensitive
tasks in it.

For a quick test on the same computer, install Node.js and run this in a
terminal:

```sh
npx --yes y-websocket
```

The server listens on `localhost:1234` by default. In the app's **Settings →
Sync settings**, use `ws://localhost:1234` and the same room name on each tab.
This is an in-memory server for local testing; its document data is lost when
the process exits.

For persistent personal sync, run `y-websocket` on a machine you control,
store its documents on durable storage, and maintain backups. On Linux or
macOS, the package's built-in LevelDB persistence can be enabled with:

```sh
mkdir -p ./yjs-data
HOST=127.0.0.1 PORT=1234 YPERSISTENCE=./yjs-data npx --yes y-websocket
```

Keep the listener private. For remote personal use, the recommended simple
setup is a machine in your Tailscale tailnet: run the command above, then use
Tailscale Serve to publish its localhost port as a tailnet-only HTTPS service
(with WebSocket upgrades enabled). In the app, connect to that machine's
Tailscale HTTPS name with `wss://` on the same port/path. This keeps the server
off the public internet while providing TLS. Check the Tailscale Serve
documentation for the command syntax for your installed version. Do not use
Tailscale Funnel or a public reverse proxy for the unmodified server.
WireGuard users can follow the same pattern by binding the service to loopback
and allowing only VPN peers through a TLS reverse proxy and firewall.

For public multi-user hosting, the stock server is only a starting point:
deploy a maintained/custom server that enforces authentication and room-level
authorization, terminates TLS (`wss://`), limits resource use, and has a
document persistence and backup strategy. A random room name or browser-side
token alone is not access control. Verify the selected server's auth and
storage behavior before placing data on it.

The app also has **Import** and **Export** actions for todo.txt files.
Import appends non-empty task lines to the current list; it does not replace or
deduplicate existing tasks. Export downloads the full list, not only the tasks
visible under current filters. Imported blank and `#` comment lines are
ignored.

## Build and deploy

```sh
npm run build
npm run preview
```

Vite writes a regular multi-file static site to `dist/`, with asset URLs
configured for `https://<owner>.github.io/todo-crdt/`. The
[Pages workflow](.github/workflows/pages.yml) deploys `dist/` on pushes to
`main`. In the repository settings, set **Pages → Build and deployment → Source**
to **GitHub Actions**.

See [DESIGN.md](DESIGN.md) for the app architecture, data model, and behavior.
