# Changelog



## 3.5.21 (2026-07-27)

### Ajustes
- Desbloqueado → Online (mesma cor verde)
- Apenas Bloqueado (laranja) e Offline (cinza) destoam

## 3.5.20 (2026-07-27)

### Ajustes
- Device: label do usuário na barra (como no admin)
- Gantt com scroll vertical: `max-height: calc(100vh - 280px)`

## 3.5.19 (2026-07-27)

### Ajustes
- Admin: barras unificadas por usuário com segmentos coloridos empilhados
- Admin: altura da linha ajustada dinamicamente por número de usuários

## 3.5.18 (2026-07-27)

### Ajustes
- Admin: removido nome de usuário de dentro das barras do Gantt (tooltip substitui)
- Admin: tooltip nas barras individuais (igual ao device)

## 3.5.17 (2026-07-27)

### Ajustes
- Coluna SESSÃO: 90px → 160px para caber nomes completos
- Removido label do usuário sobre a barra do Gantt

## 3.5.16 (2026-07-27)

### Fixes
- `esc is not defined`: função `esc()` acidentalmente removida ao adicionar `segColor()`

## 3.5.15 (2026-07-27)

### Debug
- Log detalhado em cada etapa: RG (renderGantt), GR (_renderGantt), WSE (WS error)
- Error catch com log em vez de silencioso

## 3.5.14 (2026-07-27)

### Features
- Gantt: segmentos unificados em barra contínua com cores por estado
- Tooltip no hover com: usuário, horário, estado, duração

## 3.5.13 (2026-07-27)

### Features
- Gantt com segmentos coloridos por estado: verde (Online), laranja (Bloqueado), âmbar (Desbloqueado), cinza (Offline)
- `buildSessions` agora processa `userLock`/`userUnlock` como segmentos separados

## 3.5.12 (2026-07-27)

### Fixes
- Device tab: `w` e `c` undefined no `_renderGantt` — `ReferenceError` engolia renderização

## 3.5.11 (2026-07-27)

### Fixes
- Handler duplo: pluginHandler + WebSocket addEventListener + onmessage
- Debug raw do objeto recebido

## 3.5.10 (2026-07-27)

### Debug
- Log detalhado no handler timeline

## 3.5.9 (2026-07-27)

### Fixes
- Mensagem consumida pelo MeshCentral: registrar handler em `pluginHandler.usertracer[method]`

## 3.5.8 (2026-07-27)

### Fixes
- WS listener sobrescrito pelo MeshCentral: usar `addEventListener` em vez de `onmessage`

## 3.5.7 (2026-07-27)

### Fixes
- Device tab vazia: `parent.meshserver` não alcançava iframe aninhado → `top.meshserver`

## 3.5.6 (2026-07-27)

### Fixes
- JS syntax: backslashes literais do edit tool quebravam parser do script

## 3.5.5 (2026-07-27)

### Fixes
- `gotonode`: remove prefix `node//` antes de montar URL

## 3.5.4 (2026-07-27)

### Fixes
- Navegação: `top.location.href` em vez de `parent`/`window` — evitava iframe aninhado

## 3.5.3 (2026-07-27)

### Fixes
- Navegação: `?viewmode=10&gotonode=` agora usa path root-relative (`/`)
- device.handlebars: remove query duplicada no iframe

## 3.5.2 (2026-07-24)

### Limpeza e navegação
- Removido "Ao Vivo" (auto-refresh) e zoom do Gantt
- Removido detail-panel (clique na barra agora navega para viewmode=10&gotonode)
- Removida aba "Agora" do device.handlebars (apenas Timeline)
- Clique na barra → `window.location.href='?viewmode=10&gotonode=NODEID'`
- Lock/unlock tracking completo (userLock, userUnlock, userLogout)


## 3.5.1 (2026-07-24)

### Gantt detalhado
- Clique na barra de sessão → detalhes com IP, SO, Agente, Domínio (via getNodeDetails)
- Linha "agora" clicável → heartbeat info do scanner
- Zoom por rolagem do mouse no Gantt
- Auto-refresh ao vivo com botão "Ao Vivo" (30s)
- getNodeDetails: novo serveraction que busca doc do nó no meshServer.db

## 3.5.0

### Gantt interativo
- Auto-refresh ao vivo (30s) com botão Ao Vivo
- Linha "agora" no timeline
- Clique na barra de sessão → detalhes (início, duração, eventos)
- Zoom por rolagem do mouse
- Admin: timeline multi-dispositivo + cross-reference
- Device: Gantt ao vivo + user history

## 3.4.0 (2026-07-24)

### Cross-reference tab
- Nova aba "Cruzamento": dois painéis lado a lado
- "Usuário → Dispositivos": seleciona um usuário → mostra timeline de dispositivos que ele usou
- "Dispositivo → Usuários": seleciona um dispositivo → mostra timeline de usuários que logaram nele
- `db.js`: `getUserNames()` — lista usuários únicos do histórico
- `usertracer.js`: `getUserNames` handler + `username` filter no `getTimeline`
- `checkNode`: guard rigoroso para `typeof nodeid !== 'string'`
- Guide atualizado: 12 agentes, Linux (mtype=1), cache timing, novos erros

## 3.3.1 (2026-07-24)

### UI alinhada ao MeshCentral
- Tema claro MeshCentral: fundo `#d3d9d6`, header `#003366`, painéis brancos
- Fonte Trebuchet MS; abas estilo topbar (cinza/selecionado navy)
- Usuários: lista tabela (padrão) + cards; botões nativos MeshCentral
- Timeline Gantt mantida, cores compatíveis com UI clara


## 3.3.0 (2026-07-24)

### UI redesign
- Admin panel dark theme: cards de usuários ativos, stats, busca
- Timeline Gantt profissional: eixo de tempo, sessões login→logout coloridas por usuário
- Filtros: Hoje / 7d / 30d / mês + range custom + chips multi-dispositivo
- Device tab alinhada (Agora + Timeline com range)
- Tooltip de sessão com duração; barra tracejada = sessão aberta

## 3.2.0 (2026-07-23)

### Timeline persistente
- `db.js` — novo módulo de banco NeDB com fallback chain (`@seald-io/nedb` → `@yetzt/nedb` → `nedb`)
- Scanner periódico (30s) varre todos os agentes e detecta login/logout por diff de `doc.users`
- `hook_agentCoreIsStable` + `hook_processAgentData` disparam verificação imediata
- Eventos armazenados em `plugin-usertracer-events.db` (persiste restart)
- Admin panel: abas "Usuários Ativos" + "Timeline"
- Device tab: abas "Agora" + "Histórico"
- Server-side usa `db.js` (plugin DB) + `meshServer.db` (MeshCentral DB)

## 3.1.0 (2026-07-23)

### Melhorias
- Plugin funcional: exibe usuários ativos de cada dispositivo via `db.Get(nodeId)` → `doc.users`
- Debug completo: collapsible panel no frontend + console.log no servidor
- Listener WebSocket no `ms.socket.onmessage` (RAW) — captura resposta antes do framework
- Guia de desenvolvimento expandido (MESHCENTRAL-PLUGIN-GUIDE.md) com estruturas de dados, I/O, fluxos

## 3.0.3 (2026-07-23)

### Debug
- Adicionado dump de chaves das fontes de dados (parent.agents, wsagents) para localizar onde estão os usuários ativos

## 3.0.2 (2026-07-23)

### Ajustes
- Código simplificado e limpo
- Plugin funcional: admin panel com tabela de dispositivos + usuários ativos

## 3.0.1 (2026-07-23)

### Simplificação máxima
- Server-side reduzido de 200+ linhas para **85 linhas** — só lê o usuário atual dos agentes
- `db.js` removido — sem banco, sem NeDB, sem dependências externas
- `modules_meshcore/usertracer.js` removido — sem código no agente
- Admin panel: tabela simples com dispositivo + usuário + domínio
- Device tab: card com usuário ativo da máquina
- Sem `hook_agentCoreIsStable`, sem `hook_processAgentData`, sem `server_startup`
- Basta reinstalar que funciona imediatamente

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
