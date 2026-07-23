# Changelog

## 1.0.4 (2026-07-23)

### Fixes
- Removed vis-network CDN dependency (blocked by MeshCentral CSP)
- Replaced vis.js network graph with inline relationship matrix (HTML/CSS/JS puro, zero dependências externas)

### Notes
- All content now served from `'self'` — fully CSP-compliant

## 1.0.3 (2026-07-23)

### Fixes
- All views converted to `.handlebars`; `res.render()` works natively with MeshCentral's Express renderWrapper
- Communication migrated from `pnetMsg` to standard `parent.meshserver.send({ action: 'plugin', ... })`
- Device tab and admin panel now load without "Failed to lookup view" errors

### Notes
- Compatible with all MeshCentral versions >=1.0.0
- Remove old plugin before reinstalling to clear cached `.ejs` files

## 1.0.2 (2026-07-23)

### Fixes
- Converted templates from `.ejs` to `.handlebars` — MeshCentral's Express `renderWrapper` resolves Handlebars correctly, fixing "Failed to lookup view" error
- Reverted `handleAdminReq` to standard `res.render('admin', {})` and `res.render('device', {})` per EventLog pattern
- Frontend communication now uses `parent.meshserver.send()` (MeshCentral native) instead of `pnetMsg`
- Views use `{{var}}` Handlebars syntax for server-injected variables (`nodeid`, `nodeName`)

### Notes
- Upgrade by reinstalling from the same `configUrl`; remove old plugin first to clear cached `.ejs` files

## 1.0.1 (2026-07-23)

### Fixes
- `res.render()` now uses relative view names instead of absolute paths, fixing "Failed to lookup view" error on plugin install
- Removed unused `obj.VIEWS` variable

### Notes
- No breaking changes; upgrade by reinstalling from the same `configUrl`

## 1.0.0 (2026-07-23)

### Features
- Agent-side Windows user session detection via `query user` polling (30s interval)
- Session delta engine — detects login, logout, RDP disconnect, and RDP reconnect events without false positives
- Multi-session support: tracks all console + RDP/TS sessions simultaneously
- NeDB persistent storage for events and snapshots (`plugin-usertracer-events.db`)
- Server hooks: `hook_agentCoreIsStable` auto-starts polling on agent connect
- Permission registration: `view_audit` (default allowed), `view_admin` (default denied)
- WebSocket communication with `action: plugin` format and session-targeted responses

### Admin Panel
- **Lista** — tab with filterable event table (by type, user, device)
- **Por Usuário** — card grid showing all devices each user has accessed, with counts and timestamps
- **Por Dispositivo** — card grid showing all users on each device
- **Timeline** — chronological visual flow of all events
- **Grafo** — interactive vis.js network graph of user-device relationships

### Device Tab
- Summary counters (logins, logouts, distinct users, disconnections)
- Per-device event table with type/state filters
- "User Tracer" tab registered on Windows devices only

### Fixes
- RDP disconnect/reconnect no longer fires false login/logout (Disc sessions kept in state)
- `parseQueryUserOutput` returns parsed sessions instead of empty array
- Device tab `render()` writes to `tbody.innerHTML` instead of hanging on "Carregando..."
- View names use relative form (`'admin'` not absolute path) per MeshCentral plugin convention
- Repository URLs corrected from `misael.filho` to `jukmisael`

### Notes
- MeshCentral compat: `>=1.0.0`
- Agent-side runs on Windows only; silently no-ops on other platforms
- Default poll interval: 30 seconds
