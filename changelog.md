# Changelog

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
