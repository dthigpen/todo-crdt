# Todo

A local-first todo.txt app built with Preact and Yjs. Tasks are persisted in
this browser with IndexedDB; optional Yjs WebSocket sync can be enabled in the
app's **Sync settings**.

**[Open the Todo app](https://dthigpen.github.io/todo-crdt/)**

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Vite listens on port `8000` on all laptop network interfaces. Open the local
URL it prints on the laptop, or from another device on the same trusted network
open `http://<laptop-LAN-IP>:8000/` (find the laptop's LAN IP in its network
settings). If the page cannot be reached, allow inbound TCP port 8000 through
the laptop firewall for the private network. Do not expose the dev server to
the public internet.

This only serves the app. To sync data between devices, also run a
`y-websocket` server and connect each device to its address in **Settings →
Sync settings**. For same-LAN testing, the WebSocket server must bind to a LAN
interface (for example `HOST=0.0.0.0 PORT=1234 npx --yes y-websocket`), and
inbound TCP port 1234 must be allowed on the trusted network. Use the laptop's
LAN IP in the app, such as `ws://<laptop-LAN-IP>:1234`. The stock server is
unauthenticated; use it only on a trusted network and stop it when finished.

Run the unit tests with `npm test`.

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

The app's **Settings → Todo.txt files** section imports and exports todo.txt
files. **Import and add** appends non-empty task lines without deduplicating;
**Replace current tasks** prompts for confirmation before replacing the shared
list (an empty file can clear the list after confirmation). Export downloads
the full list, not only tasks visible under current filters. Imported blank and
`#` comment lines are ignored. Deleting a task also requires confirmation.

## Build locally

```sh
npm run build
npm run preview
```

See [DESIGN.md](DESIGN.md) for the app architecture, data model, and behavior.
