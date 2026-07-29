# 🔄 Fluxos End-to-End do MeshCentral

> 9 diagramas ASCII mostrando os fluxos completos de dados entre **Browser**, **MeshCentral Server**, **Plugin** e **MeshAgent**. Cada diagrama referencia o arquivo `.md` com a implementação detalhada.

---

## 1. Browser → Plugin → Response (frontend-only, no agent)

Caso de uso: user abre admin panel, faz uma ação que o plugin resolve server-side sem tocar em agente (ex: `devtools` adiciona plugin config).

```
┌────────────────────────────────┐                    ┌─────────────────────────────────┐
│ BROWSER (admin user)            │                    │ MESHCENTRAL SERVER              │
│                                 │                    │                                 │
│ 1. user clicks "Add Plugin"     │                    │   ┌─────────────────────────┐   │
│    in devtools admin panel      │                    │   │ webserver.js            │   │
│                                 │                    │   │  POST /meshlogin        │   │
│ 2. handleAdminReq iframe        │  HTTP GET          │   │  GET /pluginadmin.ashx  │   │
│    loaded /pluginadmin.ashx     │ ─────────────────► │   │  ws /ws/user            │   │
│    ?pin=devtools                │                    │   └──────────┬──────────────┘   │
│                                 │                    │              │                  │
│ 3. user pastes JSON config      │                    │   ┌──────────▼──────────────┐   │
│    and clicks Save              │  WebSocket msg     │   │ meshuser.js handler     │   │
│                                 │ ─────────────────► │   │  {action:'plugin',      │   │
│                                 │  {action:'plugin', │   │   plugin:'devtools',    │   │
│                                 │   plugin:'devtools',│  │   pluginaction:         │   │
│                                 │   pluginaction:    │   │    'addPluginConfig',   │   │
│                                 │    'addPluginConfig',│ │   cfg:{...}}            │   │
│                                 │   cfg:{...}}       │   └──────────┬──────────────┘   │
│                                 │                    │              │                  │
│                                 │                    │   ┌──────────▼──────────────┐   │
│                                 │                    │   │ PLUGIN: devtools        │   │
│                                 │                    │   │  serveraction()         │   │
│                                 │                    │   │  case 'addPluginConfig':│   │
│                                 │                    │   │   db.addPlugin(cfg)     │   │
│                                 │                    │   └──────────┬──────────────┘   │
│                                 │                    │              │                  │
│                                 │                    │   ┌──────────▼──────────────┐   │
│                                 │  WebSocket reply   │   │ db.js (core)            │   │
│                                 │ ◄───────────────── │   │  addPlugin(doc, cb)     │   │
│                                 │  {action:           │   │  → NeDB / MongoDB / SQL │   │
│                                 │   'updatePluginList'│  └──────────┬──────────────┘   │
│                                 │   list:[...] }     │              │                  │
│ 4. UI re-renders with new       │                    │   ┌──────────▼──────────────┐   │
│    plugin list                  │                    │   │ PLUGIN: devtools        │   │
│                                 │                    │   │  db.getPlugins(...)     │   │
│                                 │                    │   │  → ws.send(updateList)  │   │
│                                 │                    │   └─────────────────────────┘   │
│                                 │                    │                                 │
│                                 │ ◄──── Broadcast ─────── (optional)                    │
│                                 │  DispatchEvent(['*','server-users'],                 │
│                                 │    {action:'pluginStateChange'})                    │
│                                 │    triggers refreshJS on all clients                 │
└────────────────────────────────┘                    └─────────────────────────────────┘
```

**Detalhes:**
- Frontend iframe carrega via `GET /pluginadmin.ashx?pin=devtools&user=1` ([`core/04-webserver-views-render.md:35`](core/04-webserver-views-render.md)).
- Server-side `handleAdminReq(req, res, user)` renderiza `views/admin.handlebars`.
- Frontend chama `parent.meshserver.send({action:'plugin', ...})` ([`core/04-webserver-views-render.md:139`](core/04-webserver-views-render.md)).
- `meshuser.js` roteia para `plugin.serveraction`.
- Resposta direta via `myparent.ws.send(JSON.stringify({...}))`.
- **Não toca em agente.** Dados ficam no DB core (collection `plugins`).

**Fonte:** [`plugins/devtools/02-server.md`](plugins/devtools/02-server.md).

---

## 2. Browser → Plugin → Agent → Plugin → Browser (round-trip com agent)

Caso de uso: user no browser clica "List Printers" em um agente remoto (printercontrol).

```
┌──────────┐                  ┌─────────────────┐                  ┌──────────┐                  ┌──────────┐
│ BROWSER  │                  │ MESHCENTRAL     │                  │ PLUGIN   │                  │ AGENT    │
│          │                  │ SERVER          │                  │ SERVER   │                  │ (remoto) │
│ 1. user  │                  │                 │                  │          │                  │          │
│  clicks  │  WebSocket msg   │                 │                  │          │                  │          │
│  "Inv..."│ ────────────────►│  meshuser.js    │                  │          │                  │          │
│         │  {action:'plugin',│   handleUserMsg │                  │          │                  │          │
│         │   plugin:        │   → routes to   │                  │          │                  │          │
│         │    'printer...', │   plugin.server  │                  │          │                  │          │
│         │   pluginaction:  │   action        │                  │          │                  │          │
│         │    'inventory',  │                  │                  │          │                  │          │
│         │   nodeid, params}│                  │                  │          │                  │          │
│         │                  │                  │                  │          │                  │          │
│         │                  │  ────────────────►──────────────────►│          │                  │          │
│         │                  │                  │  serveraction(   │          │                  │          │
│         │                  │                  │   cmd, myparent, │          │                  │          │
│         │                  │                  │   gp)            │          │                  │          │
│         │                  │                  │                  │          │                  │          │
│         │                  │                  │                  │ 2. CHECK │                  │          │
│         │                  │                  │                  │ ACL:     │                  │          │
│         │                  │                  │                  │ GetNode  │                  │          │
│         │                  │                  │                  │ WithRts  │                  │          │
│         │                  │                  │                  │ + perm:  │                  │          │
│         │                  │                  │                  │ hasPerm  │                  │          │
│         │                  │                  │                  │ ('can_v')│                  │          │
│         │                  │                  │                  │          │                  │          │
│         │                  │                  │                  │ 3. GENERATE              │          │
│         │                  │                  │                  │ requestId=               │          │
│         │                  │                  │                  │ randBytes                │          │
│         │                  │                  │                  │ (18).toStr               │          │
│         │                  │                  │                  │ ('hex')                  │          │
│         │                  │                  │                  │          │                  │          │
│         │                  │                  │                  │ 4. STORE │                  │          │
│         │                  │                  │                  │ pending[ │                  │          │
│         │                  │                  │                  │ reqId]=… │                  │          │
│         │                  │                  │                  │ +180s    │                  │          │
│         │                  │                  │                  │ timeout  │                  │          │
│         │                  │                  │                  │          │                  │          │
│         │                  │                  │                  │ 5. SEND via wsagents[ ]  │          │
│         │                  │                  │                  │ ────────────────────────►│          │
│         │                  │                  │                  │  {action:'plugin',      │          │
│         │                  │                  │                  │   plugin:'print..',     │          │
│         │                  │                  │                  │   pluginaction:         │          │
│         │                  │                  │                  │    'inventory',         │          │
│         │                  │                  │                  │   requestId,            │          │
│         │                  │                  │                  │   params}              │          │
│         │                  │                  │                  │                          │ 6. EXEC   │
│         │                  │                  │                  │                          │ PowerShell│
│         │                  │                  │                  │                          │ Get-Printer│
│         │                  │                  │                  │                          │          │
│         │                  │                  │                  │                          │ 7. RESULT │
│         │                  │                  │                  │                          │ mesh.Send │
│         │                  │                  │                  │                          │ Command({ │
│         │                  │                  │                  │ ◄────────────────────────│  pluginct │
│         │                  │                  │                  │  {action:'plugin',      │  'operat..│
│         │                  │                  │                  │   pluginaction:'operat..│  Result', │
│         │                  │                  │                  │    Result',requestId,   │  requestId│
│         │                  │                  │                  │   success,data}        │  ,success,│
│         │                  │                  │                  │                          │  data})   │
│         │                  │                  │                  │ 8. MATCH                │          │
│         │                  │                  │                  │ pending[requestId]      │          │
│         │                  │                  │                  │ → clearTimeout          │          │
│         │                  │                  │                  │ → sendToSession(        │          │
│         │                  │                  │                  │    pending.session,     │          │
│         │                  │                  │                  │    {action:'plugin',    │          │
│         │                  │                  │                  │     method:'handlePr…', │          │
│         │                  │                  │                  │     type:'result',      │          │
│         │                  │                  │                  │     requestId,…})       │          │
│         │                  │                  │                  │                          │          │
│         │ ◄─────────────────────── WebSocket ────────────────────────────────────────────│          │
│         │  msg goes via wssessions2[sessionId].send                                    │          │
│         │  → user sees printer list                                                    │          │
└──────────┘                  └─────────────────┘                  └──────────┘                  └──────────┘
```

**Detalhes:**
- requestId é 36-char hex (18 bytes), regex `^[a-f0-9]{36}$` validado no agent.
- 180s timeout por operação.
- ACL check via `webserver.GetNodeWithRights` ([`plugins/printercontrol/02-server.md:148`](plugins/printercontrol/02-server.md)).
- 5 permissions granulares (`can_view`, `manage_jobs`, etc.) via `registerPermissions` + `getAccessPermissions`.
- Frontend callback é `pluginHandler.printercontrol.handlePrinterMessage`.

**Fonte:** [`plugins/printercontrol/02-server.md`](plugins/printercontrol/02-server.md).

---

## 3. Plugin → Agent (one-way command)

Caso de uso: scheduled job dispara em scripttask; agente recebe script para executar.

```
┌─────────────────┐                  ┌──────────┐                  ┌──────────┐
│ PLUGIN SERVER   │                  │SERVER    │                  │ AGENT    │
│                 │                  │          │                  │          │
│ setInterval(    │                  │          │                  │          │
│   queueRun,     │                  │          │                  │          │
│   60000)        │                  │          │                  │          │
│   fires every   │                  │          │                  │          │
│   1 min         │                  │          │                  │          │
│       │         │                  │          │                  │          │
│       ▼         │                  │          │                  │          │
│ db.getPending   │                  │          │                  │          │
│  Jobs(online    │                  │          │                  │          │
│  Agents)        │                  │          │                  │          │
│       │         │                  │          │                  │          │
│       ▼         │                  │          │                  │          │
│ For each job:   │                  │          │                  │          │
│  - get script   │                  │          │                  │          │
│  - find #vars#  │                  │          │                  │          │
│  - resolve from │                  │          │                  │          │
│    vars db      │                  │          │                  │          │
│    (global<     │                  │          │                  │          │
│     script<     │                  │          │                  │          │
│     mesh<node)  │                  │          │                  │          │
│  - replace vars │                  │          │                  │          │
│  - dispatch:    │                  │          │                  │          │
│    wsagents[    │                  │          │                  │          │
│    job.node].   │  ──────────────► │          │  ──────────────► │          │
│    send({       │   obj.action:    │  pass    │  raw ws msg      │ mesh.Send│
│     action:     │    'plugin'      │  through │  JSON parsed     │ Command  │
│     'plugin',   │                  │          │                  │ received │
│     plugin:     │                  │          │                  │          │
│     'script-    │                  │          │                  │ trigger- │
│     task',      │                  │          │                  │ Job(...) │
│     pluginct:   │                  │          │                  │          │
│     'trigger-   │                  │          │                  │          │
│     Job',       │                  │          │                  │          │
│     jobId,      │                  │          │                  │          │
│     scriptId,   │                  │          │                  │          │
│     replaceV,   │                  │          │                  │          │
│     scriptHash})│                  │          │                  │          │
│       │         │                  │          │                  │   │      │
│       ▼         │                  │          │                  │   ▼      │
│ db.update(      │                  │          │                  │ Execute  │
│  jobId,         │                  │          │                  │ script   │
│  {dispatchTime})│                  │          │                  │ PowerSh. │
│                 │                  │          │                  │ bash     │
│                 │                  │          │                  │          │
│ (NO response    │                  │          │                  │ agent    │
│  expected;      │                  │          │                  │ sends    │
│  agent may or   │                  │          │                  │ jobComp- │
│  may not send   │                  │          │                  │ lete     │
│  jobComplete    │                  │          │                  │ later)   │
│  back via       │                  │          │                  │          │
│  serveraction)  │                  │          │                  │          │
└─────────────────┘                  └──────────┘                  └──────────┘
```

**Detalhes:**
- `setInterval(queueRun, 60000)` em `server_startup` ([`plugins/scripttask/02-scripttask-server.md:60`](plugins/scripttask/02-scripttask-server.md)).
- `getPendingJobs(onlineAgents)` filtra por agentes conectados.
- `#var#` substitution é feita ANTES do dispatch (server-side).
- `scriptHash` (SHA-384) é enviado para o agente decidir se precisa re-baixar.
- One-way: o server não espera response. O agente pode ou não mandar `jobComplete` depois.

**Fonte:** [`plugins/scripttask/02-scripttask-server.md`](plugins/scripttask/02-scripttask-server.md).

---

## 4. Plugin → All browsers (broadcast)

Caso de uso: scripttask atualiza UI quando novo job é completado; todos os browsers vendo o device devem refresh.

```
┌─────────────────┐
│ PLUGIN SERVER   │
│                 │
│ Some operation  │
│ completes       │
│ (e.g. jobComp-  │
│  lete received  │
│  from agent)    │
│       │         │
│       ▼         │
│ updateFrontEnd( │
│   {scriptId,    │
│    nodeId, …})  │
│       │         │
│       ▼         │
│ DispatchEvent(  │
│   ['*',         │
│    'server-     │
│     users'],    │
│   obj,          │           ┌────────────────────────────────────────┐
│   {             │           │ MESHCENTRAL SERVER                      │
│    action:      │           │  obj.eventsDispatch[id] → array of ws  │
│    'plugin',    │           │                                        │
│    plugin:      │           │ 1. ids='*': loop wssessions2[]         │
│    'scripttask',│ ────────► │    add all ws sessions                  │
│    pluginct:    │           │                                        │
│    'history-    │           │ 2. ids='server-users':                 │
│    Data', …     │           │    loop wssessions[userId]            │
│   })            │           │    add wssessions2[sessionId]         │
│                 │           │                                        │
│                 │           │ 3. de-dup by sessionId                │
│                 │           │                                        │
│                 │           │ 4. for each unique target:            │
│                 │           │    try { ws.send(JSON.stringify(ev)) }│
│                 │           └─────────────┬──────────────────────────┘
│                 │                     │
│                 │                     │ WebSocket fan-out
│                 │                     │
│                 │       ┌─────────────┼─────────────────┐
│                 ▼       ▼             ▼                 ▼
│         ┌─────────┐ ┌─────────┐  ┌─────────┐    ┌─────────┐
│         │Browser 1│ │Browser 2│  │Browser 3│ ...│Browser N│
│         │(admin)  │ │(user A) │  │(user B) │    │         │
│         │         │ │         │  │         │    │         │
│         │ Receives│ │ Receives│  │ Receives│    │ Receives│
│         │ history-│ │ history-│  │ history-│    │ history-│
│         │ Data    │ │ Data    │  │ Data    │    │ Data    │
│         │ event   │ │ event   │  │ event   │    │ event   │
│         │         │ │         │  │         │    │         │
│         │ meshserve│pluginH. │  │pluginH. │    │pluginH. │
│         │ r.on    │ script- │  │ script- │    │ script- │
│         │ ('msg', │ task.   │  │ task.   │    │ task.   │
│         │  ...)   │ loadHist│  │ loadHist│    │ loadHist│
│         │ → route │ (...)}  │  │ (...)}  │    │ (...)}  │
│         │ to      │         │  │         │    │         │
│         │ pluginH │         │  │         │    │         │
│         └─────────┘ └─────────┘  └─────────┘    └─────────┘
```

**Detalhes:**
- `DispatchEvent` ([`core/09-meshcentral-event-dispatch.md`](core/09-meshcentral-event-dispatch.md)) targets: `*`, `server-users`, `server-agents`, `mesh/<domain>/<name>`, `node/<domain>/<agentName>`, `user/<domain>/<userid>`, `agent/<meshid>/<nodeid>`.
- De-dup é feito por `sessionId` (users) ou `dbNodeKey` (agents).
- `nolog: true` no evento evita overhead de `authLog`.
- Frontend `meshcentral.js` roteia para `pluginHandler.<plugin>.<method>` matching `pluginaction`.
- **NÃO vai para agentes** — só browsers.

**Fonte:** [`plugins/scripttask/02-scripttask-server.md:158`](plugins/scripttask/02-scripttask-server.md), [`core/09-meshcentral-event-dispatch.md`](core/09-meshcentral-event-dispatch.md).

---

## 5. Login flow

```
┌──────────┐                  ┌─────────────────┐                  ┌──────────┐
│ BROWSER  │                  │ SERVER          │                  │ DATABASE │
│          │                  │                 │                  │          │
│ 1. POST  │                  │                 │                  │          │
│  /mesh   │                  │                 │                  │          │
│  login   │  ──────────────► │                 │                  │          │
│          │  user=, pass=,   │ webserver.js    │                  │          │
│          │  domainid=       │ POST /meshlogin │                  │          │
│          │                  │                 │                  │          │
│          │                  │ getUserWith     │                  │          │
│          │                  │ Password(       │  ──────────────► │          │
│          │                  │   userid,       │  query users     │          │
│          │                  │   password)     │                  │          │
│          │                  │                 │ ◄────────────────│          │
│          │                  │                 │  user doc        │          │
│          │                  │                 │  (hash, salt)    │          │
│          │                  │                 │                  │          │
│          │                  │ verifyPassword( │                  │          │
│          │                  │   pass, hash,   │                  │          │
│          │                  │   salt,         │                  │          │
│          │                  │   iterations)   │                  │          │
│          │                  │   via pass.js   │                  │          │
│          │                  │                 │                  │          │
│          │                  │ if match:       │                  │          │
│          │                  │  encodeCookie(  │                  │          │
│          │                  │   {userid,      │                  │          │
│          │                  │    domainid},   │                  │          │
│          │                  │   loginCookie-  │                  │          │
│          │                  │   EncryptionKey)│                  │          │
│          │                  │                 │                  │          │
│          │  Set-Cookie      │                 │                  │          │
│          │ ◄─────────────── │                 │                  │          │
│          │  meshcentral_<   │                 │                  │          │
│          │   digest>=       │                 │                  │          │
│          │  HttpOnly;       │                 │                  │          │
│          │  Secure          │                 │                  │          │
│          │                  │                 │                  │          │
│ 2. GET   │                  │                 │                  │          │
│  /mesh-  │                  │                 │                  │          │
│  central │  ──────────────► │ webserver.js    │                  │          │
│  .ashx?u=│  Cookie + querystring             │                  │          │
│          │                  │ decodeCookie →   │                  │          │
│          │                  │   {userid,      │                  │          │
│          │                  │    domainid}    │                  │          │
│          │                  │                 │                  │          │
│          │                  │ GetUser(        │  ──────────────► │          │
│          │                  │   domainid,     │                  │          │
│          │                  │   userid)       │                  │          │
│          │                  │                 │ ◄────────────────│          │
│          │                  │                 │  user doc        │          │
│          │                  │                 │                  │          │
│          │                  │ build JSON:     │                  │          │
│          │                  │  user, domain,  │                  │          │
│          │                  │  meshes, nodes, │                  │          │
│          │                  │  events, ...    │                  │          │
│          │                  │                 │                  │          │
│          │  JSON state      │                 │                  │          │
│          │ ◄─────────────── │                 │                  │          │
│          │                  │                 │                  │          │
│ 3. Open  │                  │                 │                  │          │
│  WebSock │                  │                 │                  │          │
│  /ws/    │  ──────────────► │                 │                  │          │
│  user    │  upgrade + cookie│ webserver.js    │                  │          │
│          │                  │ ws.on('conn')   │                  │          │
│          │                  │ → meshUser-     │                  │          │
│          │                  │   Handler.      │                  │          │
│          │                  │   CreateMesh-   │                  │          │
│          │                  │   User          │                  │          │
│          │                  │                 │                  │          │
│          │                  │ HOOKS FIRE:     │                  │          │
│          │                  │  hook_before-   │                  │          │
│          │                  │   CreateMeshUser│                  │          │
│          │                  │  hook_after-    │                  │          │
│          │                  │   CreateMeshUser│                  │          │
│          │                  │                 │                  │          │
│          │                  │ AddEvent-       │                  │          │
│          │                  │ Dispatch(...)   │                  │          │
│          │                  │                 │                  │          │
│          │                  │ hook_userLoggedIn fires            │          │
│          │                  │ (called in meshuser.js)            │          │
│          │                  │  → plugins reagem (routeplus, etc) │          │
│          │                  │                 │                  │          │
│          │  WS open         │                 │                  │          │
│          │ ◄─────────────── │                 │                  │          │
│          │  → ready for     │                 │                  │          │
│          │    plugin msg    │                 │                  │          │
└──────────┘                  └─────────────────┘                  └──────────┘
```

**Detalhes:**
- PBKDF2-SHA-512 + AES-256-GCM para hash + encryption (vide [`core/16-pass-password.md`](core/16-pass-password.md)).
- `loginCookieEncryptionKey` é gerado no boot e persistido em `meshcentral-data/config.json`.
- Cookie `meshcentral_<digest>` onde `<digest>` é SHA-256 do key (servidor sabe qual key usar).
- `hook_afterCreateMeshUser(meshuser, parent, db, ws, req, args, domain, user)` é wrappable via PluginHookScheduler.
- `hook_userLoggedIn(user)` é chamado após CreateMeshUser completar.

**Fonte:** [`core/03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md), [`core/08-meshcentral-server.md`](core/08-meshcentral-server.md), [`plugins/routeplus/02-server.md:99`](plugins/routeplus/02-server.md).

---

## 6. Install plugin flow

```
┌──────────┐                  ┌─────────────────┐                  ┌──────────┐
│ ADMIN    │                  │ PLUGIN HANDLER  │                  │ REMOTE   │
│ BROWSER  │                  │                 │                  │ (GitHub) │
│          │                  │                 │                  │          │
│ 1. Admin │                  │                 │                  │          │
│  POSTs   │                  │                 │                  │          │
│  config  │                  │                 │                  │          │
│  JSON    │                  │                 │                  │          │
│  to DB   │                  │                 │                  │          │
│  (via    │                  │                 │                  │          │
│  devtools│                  │                 │                  │          │
│  or UI)  │                  │                 │                  │          │
│       │  │                  │                 │                  │          │
│       ▼  │                  │                 │                  │          │
│ db.add   │                  │                 │                  │          │
│ Plugin   │                  │                 │                  │          │
│ ({name,  │                  │                 │                  │          │
│  short-  │                  │                 │                  │          │
│  Name,   │                  │                 │                  │          │
│  down-   │                  │                 │                  │          │
│  loadUrl │                  │                 │                  │          │
│  =gitURL,│                  │                 │                  │          │
│  status:0│                  │                 │                  │          │
│  })      │                  │                 │                  │          │
│          │                  │                 │                  │          │
│ 2. Set   │                  │                 │                  │          │
│  status  │                  │                 │                  │          │
│  = 1     │                  │                 │                  │          │
│          │                  │                 │                  │          │
│ 3. MeshC-│                  │                 │                  │          │
│  entral  │                  │                 │                  │          │
│  restart │                  │                 │                  │          │
│  (via    │                  │                 │                  │          │
│  devtools│                  │                 │                  │          │
│  .restart│                  │                 │                  │          │
│  Server  │                  │                 │                  │          │
│  →       │                  │                 │                  │          │
│  process │                  │                 │                  │          │
│  .exit(  │                  │                 │                  │          │
│  123))   │                  │                 │                  │          │
│          │                  │                 │                  │          │
│ 4. Server│                  │                 │                  │          │
│  restarts│                  │                 │                  │          │
│  via     │                  │                 │                  │          │
│  systemd │                  │                 │                  │          │
│          │                  │                 │                  │          │
│ 5. plug- │                  │                 │                  │          │
│  inHandle│                  │                 │                  │          │
│  r.load- │                  │                 │                  │          │
│  List()  │                  │                 │                  │          │
│          │                  │                 │                  │          │
│          │                  │ db.getPlugins() │                  │          │
│          │                  │ ──────────────► │                  │          │
│          │                  │ plugins with    │                  │          │
│          │                  │ status=1        │                  │          │
│          │                  │                 │                  │          │
│          │                  │ For each:       │                  │          │
│          │                  │  installPlugin( │                  │          │
│          │                  │   id, ...)      │  HTTP GET        │          │
│          │                  │ ─────────────────────────────────────► │          │
│          │                  │  download zip   │  HTTP GET        │          │
│          │                  │   from down-    │                  │          │
│          │                  │   loadUrl       │  bytes           │          │
│          │                  │ ◄─────────────────────────────────────│          │
│          │                  │  zip bytes      │                  │          │
│          │                  │                 │                  │          │
│          │                  │ fs.writeFile(   │                  │          │
│          │                  │  /tmp/...zip)   │                  │          │
│          │                  │                 │                  │          │
│          │                  │ yauzl.open(     │                  │          │
│          │                  │  zip, lazy-     │                  │          │
│          │                  │  Entries:true)  │                  │          │
│          │                  │                 │                  │          │
│          │                  │ for each entry: │                  │          │
│          │                  │  fs.create-     │                  │          │
│          │                  │   WriteStream(  │                  │          │
│          │                  │   pluginPath +  │                  │          │
│          │                  │   shortName/    │                  │          │
│          │                  │   <entry>)      │                  │          │
│          │                  │  zipfile pipe   │                  │          │
│          │                  │                 │                  │          │
│          │                  │ require(plugin- │                  │          │
│          │                  │  Path/<short-   │                  │          │
│          │                  │  Name>.js)      │                  │          │
│          │                  │ → instance      │                  │          │
│          │                  │                 │                  │          │
│          │                  │ obj.plugins[    │                  │          │
│          │                  │  shortName]=    │                  │          │
│          │                  │  instance       │                  │          │
│          │                  │                 │                  │          │
│          │                  │ if server_start-│                  │          │
│          │                  │ up defined:     │                  │          │
│          │                  │  call it        │                  │          │
│          │                  │                 │                  │          │
│          │                  │ updateMeshCore()│                  │          │
│          │                  │ (regenerates    │                  │          │
│          │                  │  meshcore.gz    │                  │          │
│          │                  │  for agents)    │                  │          │
│          │                  │                 │                  │          │
│          │                  │ DispatchEvent(  │                  │          │
│          │                  │  ['*','server-  │                  │          │
│          │                  │   users'],      │                  │          │
│          │                  │  {action:'plug- │                  │          │
│          │                  │   inState-      │                  │          │
│          │                  │   Change'})     │                  │          │
│          │                  │                 │                  │          │
│          │  Frontends       │                 │                  │          │
│          │  reload bundle   │                 │                  │          │
│          │ ◄─────────────── │                 │                  │          │
└──────────┘                  └─────────────────┘                  └──────────┘
```

**Detalhes:**
- `installPlugin(id, version_only, force_url, func)` ([`core/01-pluginhandler.md:57`](core/01-pluginhandler.md)).
- `yauzl` para descompactar (zero-dependency ZIP reader, vide [`core/15-package-deps.md`](core/15-package-deps.md)).
- Após install, `parent.updateMeshCore()` regenera o bundle meshcore com novos módulos.
- `process.exit(123)` é recognized pelo systemd/launchd para restart graceful.

**Fonte:** [`core/01-pluginhandler.md`](core/01-pluginhandler.md), [`plugins/devtools/02-server.md`](plugins/devtools/02-server.md), [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md).

---

## 7. Connect agent flow

```
┌──────────┐                  ┌─────────────────┐                  ┌──────────┐
│ AGENT    │                  │ SERVER          │                  │ DATABASE │
│(remoto)  │                  │                 │                  │          │
│          │                  │                 │                  │          │
│ 1. Agent │                  │                 │                  │          │
│  starts  │                  │                 │                  │          │
│  → conn- │                  │                 │                  │          │
│  ects    │                  │                 │                  │          │
│  to /ws/ │  WebSocket       │                 │                  │          │
│  agent   │ ────────────────►│                 │                  │          │
│          │  upgrade req     │                 │                  │          │
│          │  Cookie: mesh-   │ webserver.js    │                  │          │
│          │  central_agent_  │ ws.on('conn')   │                  │          │
│          │  <digest>        │ → meshAgent-    │                  │          │
│          │                  │   Handler.      │                  │          │
│          │                  │   CreateMesh-   │                  │          │
│          │                  │   Agent         │                  │          │
│          │                  │                 │                  │          │
│          │                  │ decodeCookie →  │                  │          │
│          │                  │  {nodeid,       │                  │          │
│          │                  │   meshid,       │                  │          │
│          │                  │   domainid}     │                  │          │
│          │                  │                 │                  │          │
│          │                  │ db.GetMesh +    │  ──────────────► │          │
│          │                  │  db.GetNode     │                  │          │
│          │                  │                 │ ◄────────────────│          │
│          │                  │                 │  mesh, node      │          │
│          │                  │                 │                  │          │
│          │                  │ HOOKS FIRE:     │                  │          │
│          │                  │  hook_before-   │                  │          │
│          │                  │   CreateMesh-   │                  │          │
│          │                  │   Agent         │                  │          │
│          │                  │  hook_after-    │                  │          │
│          │                  │   CreateMesh-   │                  │          │
│          │                  │   Agent →       │                  │          │
│          │                  │   wsagents[     │                  │          │
│          │                  │    nodeid]=     │                  │          │
│          │                  │   meshagent     │                  │          │
│          │                  │                 │                  │          │
│          │                  │ 2. Agent sends  │                  │          │
│          │  agentInfo msg   │  first frame    │                  │          │
│          │ ────────────────►│  via ws.send()  │                  │          │
│          │  {type:'agent-   │                 │                  │          │
│          │   Info', ver,    │                 │                  │          │
│          │   platform, …}   │ meshagent.      │                  │          │
│          │                  │ agentInfo = …   │                  │          │
│          │                  │                 │                  │          │
│          │                  │ 3. Agent sends  │                  │          │
│          │  systeminfo msg  │  sysinfo        │                  │          │
│          │ ────────────────►│                 │                  │          │
│          │                  │                 │                  │          │
│          │                  │ 4. Agent sends  │                  │          │
│          │  meshcore ready  │  caps +         │                  │          │
│          │ ────────────────►│  ready          │                  │          │
│          │                  │                 │                  │          │
│          │                  │ HOOK FIRES:     │                  │          │
│          │                  │  hook_agent-    │                  │          │
│          │                  │   CoreIsStable  │                  │          │
│          │                  │                 │                  │          │
│          │                  │ NotifyUserOf-   │                  │          │
│          │                  │  DeviceState-   │                  │          │
│          │                  │  Change(        │                  │          │
│          │                  │   meshid,       │                  │          │
│          │                  │   nodeid,       │                  │          │
│          │                  │   stateSet=1)   │                  │          │
│          │                  │                 │                  │          │
│          │                  │ HOOKS FIRE:     │                  │          │
│          │                  │  hook_before-   │                  │          │
│          │                  │   NotifyUserOf- │                  │          │
│          │                  │   DeviceState-  │                  │          │
│          │                  │   Change        │                  │          │
│          │                  │  hook_after-    │                  │          │
│          │                  │   NotifyUserOf- │                  │          │
│          │                  │   DeviceState-  │                  │          │
│          │                  │   Change        │                  │          │
│          │                  │                 │                  │          │
│          │                  │ db.SetEvent({   │  ──────────────► │          │
│          │                  │   etype:1,      │  eventsFile      │          │
│          │                  │   type:'agent-  │  TTL 20d         │          │
│          │                  │   connect', …}) │                  │          │
│          │                  │                 │                  │          │
│          │                  │ 5. Agents may   │                  │          │
│          │  meshcore.gz     │  fetch new      │                  │          │
│          │  download        │  meshcore if    │                  │          │
│          │ ◄────────────────│  hash changed   │                  │          │
│          │  GET /meshcmd/   │                 │                  │          │
│          │   meshcore.js.gz │                 │                  │          │
│          │   ?h=<hash>      │                 │                  │          │
│          │                  │                 │                  │          │
│          │  6. Plugin mods  │                 │                  │          │
│          │  from /modules_  │                 │                  │          │
│          │  meshcore/ run   │                 │                  │          │
│          │  (printercontrol,│                 │                  │          │
│          │   eventlog, …)   │                 │                  │          │
│          │                  │                 │                  │          │
│          │  7. Agent may    │                 │                  │          │
│          │  fetch updates   │                 │                  │          │
│          │  for plugin      │                 │                  │          │
│          │  (scripttask     │                 │                  │          │
│          │   triggerJob,    │                 │                  │          │
│          │   filedist       │                 │                  │          │
│          │   sendFile, …)   │                 │                  │          │
└──────────┘                  └─────────────────┘                  └──────────┘
```

**Detalhes:**
- Auth via cookie `meshcentral_agent_<digest>` (cookie separado do `meshcentral_<digest>` user cookie).
- `hook_agentCoreIsStable` é o ponto de entrada para plugins enviarem config/initial state ao agente ([`plugins/filedist/02-server.md:56`](plugins/filedist/02-server.md), [`plugins/eventlog/03-eventlog-agent.md:46`](plugins/eventlog/03-eventlog-agent.md)).
- `NotifyUserOfDeviceStateChange` dispara broadcast aos users que controlam esse node.
- `etype: 1` em `SetEvent` = node event (vide [`core/06-db-events-power-sysinfo.md`](core/06-db-events-power-sysinfo.md)).

**Fonte:** [`core/02-webserver-routes.md`](core/02-webserver-routes.md), [`core/12-meshagent.md`](core/12-meshagent.md), [`HOOKS-CATALOG.md`](HOOKS-CATALOG.md).

---

## 8. Permission check flow

Caso de uso: user tenta usar printercontrol para listar impressoras em um agente.

```
┌──────────┐         ┌──────────┐         ┌────────────────┐         ┌──────────┐
│ BROWSER  │         │ SERVER   │         │ pluginHandler  │         │ AGENT    │
│          │         │          │         │                │         │          │
│ 1. user  │         │          │         │                │         │          │
│  clicks  │         │          │         │                │         │          │
│  "List"  │         │          │         │                │         │          │
│   ↓      │         │          │         │                │         │          │
│  parent. │         │          │         │                │         │          │
│  mesh-   │         │          │         │                │         │          │
│  server. │         │          │         │                │         │          │
│  send({  │ ──────► │          │         │                │         │          │
│  plugin: │         │          │         │                │         │          │
│  'print- │         │          │         │                │         │          │
│  ercon-  │         │          │         │                │         │          │
│  trol',  │         │          │         │                │         │          │
│  plugin- │         │          │         │                │         │          │
│  action: │         │          │         │                │         │          │
│  'inven- │         │          │         │                │         │          │
│  tory',  │         │          │         │                │         │          │
│  nodeid, │         │          │         │                │         │          │
│  params})│         │          │         │                │         │          │
│          │         │          │         │                │         │          │
│          │         │ 2. mesh- │         │                │         │          │
│          │         │ user.js  │         │                │         │          │
│          │         │ routes   │         │                │         │          │
│          │         │ to       │         │                │         │          │
│          │         │ plugin.  │ ──────► │                │         │          │
│          │         │ server-  │         │ printercontrol │         │          │
│          │         │ action   │         │ .serveraction( │         │          │
│          │         │          │         │ cmd, session,  │         │          │
│          │         │          │         │ webserver)     │         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ 3. CHECK ACL   │         │          │
│          │         │          │         │ webserver.     │         │          │
│          │         │          │         │ GetNodeWith-   │         │          │
│          │         │          │         │ Rights(        │         │          │
│          │         │          │         │  domain, user, │         │          │
│          │         │          │         │  nodeid,       │         │          │
│          │         │          │         │  cb)           │         │          │
│          │         │          │         │   → mesh.      │         │          │
│          │         │          │         │     users[user-│         │          │
│          │         │          │         │     id].rights │         │          │
│          │         │          │         │   → rights==0  │         │          │
│          │         │          │         │     = DENIED   │         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ 4. CHECK PERM  │         │          │
│          │         │          │         │ getAccess-     │         │          │
│          │         │          │         │ Permissions(   │         │          │
│          │         │          │         │  'printer-     │         │          │
│          │         │          │         │   control',    │         │          │
│          │         │          │         │  user,         │         │          │
│          │         │          │         │  {nodeId})     │         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ lookup cascade:│         │          │
│          │         │          │         │  nodeOverrides │         │          │
│          │         │          │         │   > meshOver-  │         │          │
│          │         │          │         │     rides      │         │          │
│          │         │          │         │   > global     │         │          │
│          │         │          │         │   > default    │         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ returns async  │         │          │
│          │         │          │         │ (hasPermission)│         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ 5. CHECK ONLINE│         │          │
│          │         │          │         │ wsagents[      │         │          │
│          │         │          │         │  nodeId]       │         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ 6. GENERATE    │         │          │
│          │         │          │         │ requestId=     │         │          │
│          │         │          │         │ randBytes(18)  │         │          │
│          │         │          │         │ .toString(     │         │          │
│          │         │          │         │  'hex')        │         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ 7. STORE       │         │          │
│          │         │          │         │ pending[       │         │          │
│          │         │          │         │  requestId]=   │         │          │
│          │         │          │         │  {session, op, │         │          │
│          │         │          │         │   timer (180s)}│         │          │
│          │         │          │         │                │         │          │
│          │         │          │         │ 8. SEND TO     │         │          │
│          │         │          │         │ AGENT          │         │          │
│          │         │          │         │ wsagents[      │         │          │
│          │         │          │         │  nodeId].send({│ ──────► │          │
│          │         │          │         │  action:'plugin│         │ PowerShell│
│          │         │          │         │  ', pluginct: │         │ Get-     │
│          │         │          │         │  'inventory', │         │ Printer  │
│          │         │          │         │  requestId,   │         │          │
│          │         │          │         │  params})      │         │          │
│          │         │          │         │                │ ◄─────  │ mesh.Send│
│          │         │          │         │ 9. RESULT      │  Comma- │ Command  │
│          │         │          │         │ pending[       │  nd({   │ ({       │
│          │         │          │         │  requestId]    │  plugi- │  plugin- │
│          │         │          │         │ → sendTo-      │  nacti- │  action: │
│          │         │          │         │   Session(     │  on:'op-│  'oper..'│
│          │         │          │         │    pending.    │  erati- │  Result',│
│          │         │          │         │    session,    │  onResu-│  request-│
│          │         │          │         │    {method:    │  lt',   │  Id,     │
│          │         │          │         │     'handle-   │  reques-│  success,│
│          │         │          │         │     Printer-   │  tId,   │  data})  │
│          │         │          │         │     Message',  │  succes-│          │
│          │         │          │         │     type:'re-  │  s,data-│          │
│          │         │          │         │     sult',     │  })     │          │
│          │         │          │         │     requestId, │         │          │
│          │         │          │         │     …})        │         │          │
│          │         │          │         │                │         │          │
│          │ 10. WebSocket    │         │                │         │          │
│          │  reply via       │         │                │         │          │
│          │  wssessions2[    │         │                │         │          │
│          │   sessionId].    │         │                │         │          │
│          │   send()         │         │                │         │          │
│          │ ◄───────────────────────────────────────────────────────────────│          │
│          │  → meshcentral   │         │                │         │          │
│          │    routes to     │         │                │         │          │
│          │    pluginHan-    │         │                │         │          │
│          │    dler.printer- │         │                │         │          │
│          │    control.      │         │                │         │          │
│          │    handlePr-     │         │                │         │          │
│          │    interMessage  │         │                │         │          │
└──────────┘         └──────────┘         └────────────────┘         └──────────┘
```

**Detalhes:**
- 3 níveis de check: ACL (mesh rights) → Permission (printercontrol specific) → Online (agent connected).
- `registerPermissions` em `server_startup` define 5 permissions com `default: 'denied'` (fail-closed).
- `getAccessPermissions` é async (Promise-based) — checa cascade `nodeOverrides > meshOverrides > global > default`.
- 180s timeout por operação; se agente demora, fail com "timed out".
- Falha em QUALQUER check = `fail()` → `browserMessage('result', {success:false, error: '...'})`.

**Fonte:** [`plugins/printercontrol/02-server.md`](plugins/printercontrol/02-server.md), [`core/01-pluginhandler.md:28`](core/01-pluginhandler.md), [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md).

---

## 9. Update meshcore (module injection)

Caso de uso: plugin nova (ex: `filedist`) é instalado; agentes precisam baixar o novo meshcore com módulos do plugin.

```
┌──────────┐          ┌─────────────────┐          ┌──────────┐
│ ADMIN    │          │ pluginHandler   │          │ AGENT    │
│ (install │          │ + meshcentral   │          │          │
│  plugin) │          │                 │          │          │
│          │          │                 │          │          │
│ 1. POST  │          │                 │          │          │
│  to db   │          │                 │          │          │
│  + set   │          │                 │          │          │
│  status=1│          │                 │          │          │
│   OR     │          │                 │          │          │
│ install- │          │                 │          │          │
│ Plugin() │          │                 │          │          │
│          │          │                 │          │          │
│          │          │ 2. updateMesh-  │          │          │
│          │          │  Core(func)     │          │          │
│          │          │                 │          │          │
│          │          │ 3. pluginH.     │          │          │
│          │          │  addMeshCore-   │          │          │
│          │          │  Modules(       │          │          │
│          │          │   modulesAdd)   │          │          │
│          │          │                 │          │          │
│          │          │ For each plugin │          │          │
│          │          │  in obj.plugins:│          │          │
│          │          │   modulesDir =   │          │          │
│          │          │    fs.readdir-   │          │          │
│          │          │    Sync(plugins/│          │          │
│          │          │    <name>/mod-  │          │          │
│          │          │    ules_mesh-   │          │          │
│          │          │    core)        │          │          │
│          │          │                 │          │          │
│          │          │   For each file:│          │          │
│          │          │    Read content │          │          │
│          │          │    Escape via   │          │          │
│          │          │    escapeCode-  │          │          │
│          │          │    String()     │          │          │
│          │          │                 │          │          │
│          │          │    Categorize:  │          │          │
│          │          │    if starts    │          │          │
│          │          │    with 'amt-'  │          │          │
│          │          │    or 'smbios': │          │          │
│          │          │     push to     │          │          │
│          │          │     windows-amt │          │          │
│          │          │     + linux-amt │          │          │
│          │          │    elif starts  │          │          │
│          │          │    with 'win-': │          │          │
│          │          │     push to     │          │          │
│          │          │     windows-amt │          │          │
│          │          │    elif starts  │          │          │
│          │          │    with 'linux-':│         │          │
│          │          │     push to     │          │          │
│          │          │     linux-amt   │          │          │
│          │          │     + linux-    │          │          │
│          │          │       noamt     │          │          │
│          │          │    else:        │          │          │
│          │          │     push to ALL │          │          │
│          │          │     3 lists     │          │          │
│          │          │                 │          │          │
│          │          │ 4. Generate     │          │          │
│          │          │  bundle:        │          │          │
│          │          │  for each       │          │          │
│          │          │  category:      │          │          │
│          │          │   defaultMesh-  │          │          │
│          │          │   Cores[cat]=   │          │          │
│          │          │    ['addModule( │          │          │
│          │          │     "name",     │          │          │
│          │          │     "<escape>")│          │          │
│          │          │     ', …]       │          │          │
│          │          │   gzip →        │          │          │
│          │          │   defaultMesh-  │          │          │
│          │          │   CoresDeflate  │          │          │
│          │          │   sha256 →      │          │          │
│          │          │   defaultMesh-  │          │          │
│          │          │   CoresHash     │          │          │
│          │          │                 │          │          │
│          │          │ 5. Save to      │          │          │
│          │          │  meshcentral-   │          │          │
│          │          │  data/meshcore. │          │          │
│          │          │  js.gz          │          │          │
│          │          │                 │          │          │
│          │          │ 6. Dispatch-    │          │          │
│          │          │  Event(['*',    │          │          │
│          │          │  'server-users']│          │          │
│          │          │  , obj,         │          │          │
│          │          │  {action:'plug- │          │          │
│          │          │   inState-      │          │          │
│          │          │   Change'})     │          │          │
│          │          │                 │          │          │
│          │          │                 │ 7. Agent    │          │
│          │          │                 │  reconnects │          │
│          │          │                 │  (or next   │          │
│          │          │                 │  check-in)  │          │
│          │          │                 │             │          │
│          │          │                 │  GET /mesh- │          │
│          │          │                 │  cmd/mesh-  │          │
│          │          │                 │  core.js.gz │          │
│          │          │                 │  ?h=<known- │          │
│          │          │                 │  Hash>      │          │
│          │          │                 │             │          │
│          │          │ 8. Server       │ ◄─────────  │          │
│          │          │  returns 304    │             │          │
│          │          │  if hash match, │             │          │
│          │          │  or 200 + gzip  │             │          │
│          │          │  body if differ │             │          │
│          │          │                 │             │          │
│          │          │                 │ 9. Agent    │          │
│          │          │                 │  executes   │          │
│          │          │                 │  all addMod-│          │
│          │          │                 │  ule()      │          │
│          │          │                 │  calls (in- │          │
│          │          │                 │  cluding    │          │
│          │          │                 │  plugin     │          │
│          │          │                 │  modules)   │          │
│          │          │                 │             │          │
│          │          │                 │ 10. Plugin  │          │
│          │          │                 │ module is   │          │
│          │          │                 │ now active  │          │
│          │          │                 │ in agent    │          │
│          │          │                 │ (e.g. file- │          │
│          │          │                 │  dist adds  │          │
│          │          │                 │  periodic   │          │
│          │          │                 │  file       │          │
│          │          │                 │  integrity  │          │
│          │          │                 │  check)     │          │
└──────────┘          └─────────────────┘          └──────────┘
```

**Detalhes:**
- `updateMeshCore` é chamado em TODA mudança de plugin (load, install, disable, remove, reload) — vide [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md).
- 3 listas paralelas: `windows-amt`, `linux-amt`, `linux-noamt`.
- Prefix routing: `amt-`/`smbios` → todas AMT lists, `win-` → só Windows, `linux-` → só Linux, sem prefixo → todas.
- `escapeCodeString(str)` serializa JS source com escape unicode.
- Hash SHA-256 permite agente detectar mudanças sem re-download (`304 Not Modified`).
- Bundle fica em `meshcentral-data/meshcore.js.gz`.

**Fonte:** [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md), [`core/01-pluginhandler.md:23`](core/01-pluginhandler.md), [`plugins/filedist/03-agent.md`](plugins/filedist/03-agent.md).

---

## Cross-references rápidas

- **Mais detalhes sobre hooks:** [`HOOKS-CATALOG.md`](HOOKS-CATALOG.md)
- **40+ perguntas "como pego X":** [`PERGUNTA-RESPOSTA-NATIVA.md`](PERGUNTA-RESPOSTA-NATIVA.md)
- **Detalhes por plugin:** [`plugins/<name>/01-overview.md`](plugins/)
- **Detalhes por core module:** [`core/01-pluginhandler.md`](core/01-pluginhandler.md) ... [`core/16-pass-password.md`](core/16-pass-password.md)
- **Master index:** [`00-README.md`](00-README.md)