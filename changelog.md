# Changelog

## 3.0.0 (2026-07-23)

### Mudança fundamental de abordagem
- **Removido** `query user` polling no agente (lento, complexo, falho)
- **Agora** usa dados de usuário que o próprio MeshCentral já coleta dos agentes (`device.users`, `device.lusers`)
- Server-side periodic scan (30s) detecta login/logout comparando estados anteriores
- `hook_agentCoreIsStable` + `hook_processAgentData` disparam verificação imediata quando agente conecta ou envia dados
- Agent-side module reduzido a placeholder mínimo
- Dados históricos armazenados em NeDB com nodeid, username, domain, displayUser, eventType

### Por que essa mudança
O MeshCentral já exibe o usuário atual de cada máquina na lista de dispositivos (ex: `BKSSERVICES\Fabiana.Gomes`).
Esse dado é enviado pelo agente e armazenado em `device.users`/`device.lusers` automaticamente.
Não precisamos rodar `query user` no agente — o MeshCentral já faz isso por nós.

### Benefits
- Imediato: dados disponíveis assim que o agente conecta
- Confiável: usa a mesma fonte de dados que a própria UI do MeshCentral
- Zero overhead no agente
- Histórico preciso de login/logout por comparação de estados

## 2.0.3 (2026-07-23)

### Fixes
- `db.js`: `setAutocompactionInterval` agora chamado diretamente no Datastore (não em `persistence.`) — elimina deprecation warning do `@seald-io/nedb`

### Notes
- Servidor inicia sem erros, agentes conectam, plugin funcional

## 2.0.2 (2026-07-23)

### Fixes
- `db.js`: removed duplicate function block (30 linhas) que causava `SyntaxError: Unexpected token '}'` no carregamento
- Lint em todos os arquivos: trailing whitespace removido, sintaxe validada

### Notes
- Delete a pasta manualmente como Administrador e reinstale pela URL do `config.json`

## 2.0.1 (2026-07-23)

### Fixes
- `db.js`: cadeia de fallback NeDB (`@seald-io/nedb` → `@yetzt/nedb` → `nedb`) seguindo padrão ScriptTask — resolve `Cannot find module 'nedb'` no MeshCentral v1.2.4
- Adicionado `module.paths.push()` com `meshserver.parentpath` para resolução de módulos NeDB
- Adicionado debug server-side com `obj.debug()` em todos os pontos críticos (EventLog/RegEdit pattern)
- Adicionado debug agent-side com `dbg()` + `debug_flag` + `setDebug` (EventLog/ScriptTask pattern)
- Removido `.gitignore` do repositório para evitar `EPERM` na extração do ZIP

### Agora é necessário deletar manualmente a pasta do plugin
O `.gitignore` e `changelog.md` antigos estão com permissão travada no disco. Rode como **Administrador**:
```powershell
takeown /f "C:\Program Files\Open Source\MeshCentral\meshcentral-data\plugins\usertracer" /r /d y 2>$null; icacls "C:\Program Files\Open Source\MeshCentral\meshcentral-data\plugins\usertracer" /grant Administradores:F /t /q 2>$null; rmdir -recurse -force "C:\Program Files\Open Source\MeshCentral\meshcentral-data\plugins\usertracer"
```
Depois reinstale pela URL do `config.json`.

## 2.0.0 (2026-07-23)

### Rewrite completo
- Código reescrito do zero seguindo padrões validados dos 12 plugins analisados (ScriptTask, EventLog, RegEdit, RoutePlus, FileDistribution, WorkFromHome, DevTools, Sample, PluginHookScheduler, Agentname2Servername, PrinterControl, PluginHookExample)
- Database module (db.js) isolado seguindo padrão EventLog/ScriptTask com suporte NeDB + MongoDB
- Server-side simplificado: sem `registerPermissions`, sem debug file, sem try-catch aninhados
- Agent-side seguindo padrão ScriptTask: `consoleaction()` + `mesh.SendCommand()` com `nodeid` incluso
- Views sem CDN, sem vis.js, sem dependências externas — CSP-compliant
- Frontend usa `parent.meshserver.send()` (padrão DevTools/PrinterControl/EventLog)
- Handlers registrados em `pluginHandler.usertracer[method]` (padrão MeshCentral)

### Remoções
- `registerPermissions()` removido — compatível com versões antigas do MeshCentral (como DevTools e EventLog)
- Todo código de debug (`dbgLog`, `console.log('PLUGIN:')`, arquivo `C:\usertracer-debug.log`) removido
- Vis.js e CDN removidos
- `pnetMsg` removido (só `meshserver.send()`)

### Compatibilidade
- `>=1.0.0` — testado nos mesmos padrões dos plugins da comunidade

## 1.0.8 (2026-07-23)

### Debug
- Added file-based logging to `C:\usertracer-debug.log` (writes at every step: `require()`, constructor, `server_startup`, `handleAdminReq`, errors)
- All `console.log('PLUGIN:')` replaced with `dbgLog()` that writes to file AND console
- Added user/siteadmin detail logging in `handleAdminReq` to diagnose 401
- Fixed duplicate `var obj = {}` in constructor

### Notes
- Delete and reinstall; check `C:\usertracer-debug.log` after reinstalling

## 1.0.7 (2026-07-23)

### Debug
- Added `console.log('PLUGIN: ...')` at module load, constructor, `server_startup`, DB init, and permission registration
- Wrapped `initDB()` and `registerPermissions()` in try-catch with error logging
- Logs appear in **MeshCentral server terminal** (not browser DevTools) — needed because the plugin JS `require()` failure is server-side

### Notes
- Delete and reinstall; logs will show exactly where plugin loading stops

## 1.0.6 (2026-07-23)

### Fixes
- Changed `view_admin` permission default from `denied` to `allowed` — MeshCentral plugin handler was blocking admin panel access with 401 before reaching our handler
- Restored proper `handleAdminReq` implementation after debug cycle

### Notes
- **Must delete and reinstall the plugin** — "Reload" does not refresh cached plugin JS on disk. Remove via dropdown, then re-download from the same `configUrl`

## 1.0.5 (2026-07-23)

### Fixes
- Agent `SendCommand` now includes `nodeid` (from `mesh.info._id`) so server can identify the source device
- `serveraction` derives `nodeid` from agent WebSocket connection (`myparent.nodeid`) as fallback
- Events no longer discarded — "sessionEvents missing nodeid" fixed

### Notes
- Server restart required; agents must reconnect to receive updated `modules_meshcore`

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
