# ⚙️ Catálogo de Hooks do MeshCentral

> Lista exaustiva de **todos** os hooks que o MeshCentral chama via `pluginHandler.callHook`, que plugins expõem via `obj.exports` (frontend), e que `PluginHookScheduler.wrapFunctionCall` injeta. Compilado de [`core/`](core/), [`plugins/pluginhookexample/`](plugins/pluginhookexample/), [`plugins/pluginhookscheduler/`](plugins/pluginhookscheduler/), [`plugins/agentname2servername/`](plugins/agentname2servername/) e call-sites em [`plugins/eventlog/`](plugins/eventlog/), [`plugins/scripttask/`](plugins/scripttask/), [`plugins/routeplus/`](plugins/routeplus/), [`plugins/workfromhome/`](plugins/workfromhome/), [`plugins/filedist/`](plugins/filedist/).

---

## Server-side hooks (chamados pelo core MeshCentral via `pluginHandler.callHook`)

Estes hooks são funções no objeto do plugin (`obj.hookName = function(...)`) chamadas em loop pelo `pluginHandler.callHook`. Se o PluginHookScheduler está instalado, ele **substitui** `callHook` por uma versão ordenada (vide [`plugins/pluginhookscheduler/02-server.md:147`](plugins/pluginhookscheduler/02-server.md)).

| Hook | Quando é chamado | Argumentos | Quem chama |
|------|------------------|------------|------------|
| `server_startup` | Uma vez, quando MeshCentral termina de carregar todos os plugins | `()` (sem args) | `pluginHandler.loadList` após `require()` do plugin |
| `hook_setupHttpHandlers` | Uma vez, durante boot — usado para registrar rotas Express | `(webserver, parent, db, ...)` | `webserver.js` (linhas ~1500 upstream) |
| `onServerStart` | Após `meshserver.Start()` completar | `(meshserver)` | `meshcentral.Start` (final do método) |
| `onServerStop` | Antes de `meshserver.Stop()` finalizar | `(meshserver)` | `meshcentral.Stop` |
| `onDeviceRefreshEnd` | Quando a página de device é refresh no front-end | `(nodeid, panel, refresh, event)` | Frontend bundle (`pluginHandler.<plugin>.onDeviceRefreshEnd(...)`) |
| `onWebUIStartupEnd` | Quando o bundle JS do front termina de carregar | `()` | Frontend bundle (chamado uma vez por user) |
| `hook_userLoggedIn` | Quando user loga no browser | `(user)` — user object | `meshuser.js` após auth |
| `hook_userLoggedOut` | Quando user desloga | `(user)` | `meshuser.js` em `ws.on('close')` |
| `onDeviceStateChange` | Quando um node muda de online/offline | `(meshid, nodeid, state, info)` | `meshcentral.NotifyUserOfDeviceStateChange` |
| `hook_beforeNotifyUserOfDeviceStateChange` | Antes de broadcast de state change | `(_, nodeid, connectTime, connectType, powerState, serverid, stateSet, extraInfo)` | `meshserver.NotifyUserOfDeviceStateChange` ([`core/08-meshcentral-server.md:59`](core/08-meshcentral-server.md)) |
| `hook_afterNotifyUserOfDeviceStateChange` | Depois | `(_, meshid, nodeid, ...)` retorna `stateSet` (pode modificar) | idem |
| `hook_userCreated` | User criado no admin panel | `(user)` | `db.js:addUser` |
| `hook_userDeleted` | User deletado | `(user)` | `db.js:removeUser` |
| `hook_meshCreated` | Mesh criado | `(mesh)` | `db.js:addMesh` |
| `hook_meshDeleted` | Mesh deletado | `(mesh)` | `db.js:removeMesh` |
| `hook_nodeAdded` | Node adicionado a um mesh | `(node, mesh)` | `db.js:addNode` |
| `hook_nodeRemoved` | Node removido | `(nodeid, meshid)` | `db.js:removeNode` |
| `hook_beforeCreateMeshAgent` | Antes de criar `MeshAgent` instance | `(parent, db, ws, req, args, domain)` | `webserver.meshAgentHandler.CreateMeshAgent` (via wrapFunctionCall) — requer PluginHookScheduler |
| `hook_afterCreateMeshAgent` | Depois — pode modificar `meshagent` | `(meshagent, parent, db, ws, req, args, domain) → meshagent` | idem |
| `hook_agentCoreIsStable` | Quando o meshcore terminou de carregar no agente | `(meshagent, grandparent)` | `meshagent.js` após agent enviar `agentInfo` + `caps` completos |
| `hook_agentWebSocketDisconnected` | Quando agente desconecta | `(meshagent)` | `meshagent.js` em `ws.on('close')` |
| `hook_beforeCreateMeshUser` | Antes de criar `MeshUser` | `(parent, db, ws, req, args, domain, user)` | `webserver.meshUserHandler.CreateMeshUser` (via wrapFunctionCall) |
| `hook_afterCreateMeshUser` | Depois | `(meshuser, parent, db, ws, req, args, domain, user) → meshuser` | idem |
| `hook_beforeCreateMeshRelay` | Antes de criar relay entre servers | `(parent, ws, req, domain, user, cookie)` | `webserver.meshRelayHandler.CreateMeshRelay` (via wrapFunctionCall) |
| `hook_afterCreateMeshRelay` | Depois | `(meshrelay, parent, ws, req, domain, user, cookie) → meshrelay` | idem |
| `hook_beforeCreateLocalRelay` | Antes de criar LocalRelay | `(parent, ws, req, domain, user, cookie)` | `webserver.meshRelayHandler.CreateLocalRelay` (via wrapFunctionCall) |
| `hook_afterCreateLocalRelay` | Depois | `(localrelay, parent, ws, req, domain, user, cookie) → localrelay` | idem |
| `hook_afterCreateAgentRedirect` | Quando um WebRTC redirect é criado (eventlog Live pattern) | `(redirect, nodeid, serverPublicNamePort, authCookie, authRelayCookie, domainUrl)` | `meshserver.CreateAgentRedirect` |
| `hook_beforeDeviceRefresh` | Antes do device page refresh (pode modificar panel) | `(nodeid, panel)` | Frontend bundle |
| `hook_deviceEvent` | Log de evento de device (writeDeviceEvent) | `(eventObj, nodeid)` | Frontend helper |

**Localização central:**
- [`core/01-pluginhandler.md:22`](core/01-pluginhandler.md) — `pluginHandler.callHook` (default impl)
- [`plugins/pluginhookscheduler/02-server.md:147`](plugins/pluginhookscheduler/02-server.md) — versão scheduler
- [`plugins/pluginhookexample/01-overview.md:51`](plugins/pluginhookexample/01-overview.md) — assinatura completa dos 11 hooks `Create*`/`NotifyUser*`
- [`plugins/agentname2servername/02-server.md:30`](plugins/agentname2servername/02-server.md) — exemplo real de `hook_afterCreateMeshAgent`

---

## Frontend hooks (exportados via `obj.exports`)

O `pluginHandler.prepExports()` ([`core/01-pluginhandler.md:36`](core/01-pluginhandler.md)) serializa todas as funções listadas em `obj.exports = [...]` para um bundle JS que é entregue ao browser via `/meshcentral.ashx?re...` (vide `refreshJS`). Esses métodos tornam-se `pluginHandler.<shortName>.<methodName>` no front-end.

| Hook (frontend method) | Quando é chamado (no browser) | Argumentos | Quem registra |
|------------------------|-------------------------------|------------|---------------|
| `onWebUIStartupEnd` | Quando `meshcentral.js` front-end terminou de carregar | `()` | `pluginHandler.callHook('onWebUIStartupEnd')` (auto, em `refreshJS`) |
| `onDeviceRefresh` | Quando o user clica em um device | `(nodeid)` | Frontend (chamado antes de render) |
| `onDeviceRefreshEnd` | Após render do device page | `(nodeid, panel, refresh, event)` | Frontend (`p10html3` panel ready) |
| `onDeviceDisconnect` | Quando user desconecta de remote desktop | `()` | Frontend (auto-chamado em session close) — vide [`plugins/sample/01-sample-minimal.md:40`](plugins/sample/01-sample-minimal.md) |
| `on_device_header` | Para construir o header do device page | `() → HTML string` | Frontend |
| `on_device_page` | Para injetar HTML no device page | `() → HTML string` | Frontend |
| `registerPluginTab` | Para registrar uma tab no device page | `() → {tabTitle, tabId}` | Frontend (chamado em `onDeviceRefreshEnd`) — vide [`plugins/eventlog/02-eventlog-server.md:54`](plugins/eventlog/02-eventlog-server.md) |
| `fe_on_message` | Quando o front recebe um evento do server via DispatchEvent | `(server, message)` | Frontend (callback por pluginaction) |
| `loadEventLogMain` / `loadScriptTask` / `loadPrinterControl` | Lazy-loaded UI init (idempotent: checa `if (!Q('elementId'))`) | `()` | Frontend (chamado em `onDeviceRefreshEnd`) |
| `resizeContent` | Quando iframe precisa redimensionar | `()` | Frontend (chamado periodicamente ou on window resize) — vide [`plugins/scripttask/02-scripttask-server.md:51`](plugins/scripttask/02-scriptserver.md) |
| `mapUpdate` | Quando server envia `pluginaction:'mapUpdate'` | `(message)` | Frontend (via `fe_on_message` callback routing) — vide [`plugins/workfromhome/02-server.md:108`](plugins/workfromhome/02-server.md) |
| `dlRDPfile` / `dlRDP` | Quando user clica em "download RDP" | `(port, name)` | Frontend (cria `<a download>` e dispara click) — vide [`plugins/routeplus/02-server.md:76`](plugins/routeplus/02-server.md) |
| `setUserRdpLinks` | Quando server envia `setUserRdpLinks` | `(state, msg)` | Frontend — vide [`plugins/routeplus/02-server.md:164`](plugins/routeplus/02-server.md) |
| `updateUserRdpLinks` / `updateRdpDeviceLinks` | Quando user loga ou device muda | `()` | Frontend — vide [`plugins/routeplus/02-server.md:55`](plugins/routeplus/02-server.md) |
| `historyData` / `variableData` | Quando server envia history/variables update | `(message)` | Frontend — vide [`plugins/scripttask/02-scripttask-server.md:243`](plugins/scripttask/02-scripttask-server.md) |
| `openSettings` / `goPageStart` | UI navigation | `(...args)` | Frontend — vide [`plugins/routeplus/02-server.md:175`](plugins/routeplus/02-server.md) |
| `cantMap` | Quando agente reporta que porta está ocupada | `(message)` | Frontend — vide [`plugins/routeplus/02-server.md`](plugins/routeplus/02-server.md) |
| `loadMaps` / `loadHistory` / `loadConfigSets` | CRUD list loaders | `(message)` | Frontend |
| `showLog` / `filterLog` / `loadLogs` / `loadButtons` / `eventLogTab` / `onLoadHistory` | EventLog UI helpers | `(...args)` | Frontend — vide [`plugins/eventlog/02-eventlog-server.md`](plugins/eventlog/02-eventlog-server.md) |
| `_pluginPermissions` | Auto-chamado para descobrir permissões | `() → {permissionKey: {title, desc}}` | Frontend (gera `data-permission` attrs) |
| `loadPluginTab` / `eventLogTab` | Tab content renderers | `(...args)` | Frontend |
| `serveraction` (no front) | **NÃO existe** — frontend chama `parent.meshserver.send({action:'plugin', ...})` e o server-side `serveraction` recebe | — | N/A (comunicação front→back via WebSocket) |

**Localização central:**
- [`core/01-pluginhandler.md:36`](core/01-pluginhandler.md) — `prepExports` mostra como os métodos viram código no browser
- [`core/04-webserver-views-render.md`](core/04-webserver-views-render.md) — helpers do front (`Q`, `QH`, `meshserver.send`)
- Cada plugin `01-overview.md` lista os exports específicos

**Convenção:** frontend methods NÃO são "hooks" no sentido estrito — eles são **callbacks injetados** que o `meshcentral.js` front-end chama em pontos específicos. A serialização via `prepExports` significa que **closures e arrow functions com refs externas quebram** (vide nota em [`core/01-pluginhandler.md:119`](core/01-pluginhandler.md)).

---

## PluginHookScheduler-derived hooks (via `wrapFunctionCall`)

Quando o plugin `pluginhookscheduler` está instalado, ele adiciona `pluginHandler.wrapFunctionCall(target, fnName, alias?)` ([`plugins/pluginhookscheduler/02-server.md:157`](plugins/pluginhookscheduler/02-server.md)). Esta API wrappa qualquer função com before/after hooks injetados automaticamente.

A convenção de naming é:
- **Before:** `hook_before<fnName>` (ou `hook_before<alias>` se `alias` foi passado)
- **After:** `hook_after<fnName>` (ou `hook_after<alias>` se `alias` foi passado)

Wraps que o PluginHookScheduler aplica automaticamente em `server_startup` ([`plugins/pluginhookscheduler/02-server.md:178-184`](plugins/pluginhookscheduler/02-server.md)):

| Target | `fnName` | Hooks derivados | Argumentos |
|--------|----------|-----------------|------------|
| `webserver.meshAgentHandler` | `CreateMeshAgent` | `hook_beforeCreateMeshAgent`, `hook_afterCreateMeshAgent` | `(parent, db, ws, req, args, domain)` → `(meshagent, parent, db, ws, req, args, domain)` |
| `webserver.meshRelayHandler` | `CreateMeshRelay` | `hook_beforeCreateMeshRelay`, `hook_afterCreateMeshRelay` | `(parent, ws, req, domain, user, cookie)` → `(meshrelay, ...)` |
| `webserver.meshRelayHandler` | `CreateLocalRelay` | `hook_beforeCreateLocalRelay`, `hook_afterCreateLocalRelay` | `(parent, ws, req, domain, user, cookie)` → `(localrelay, ...)` |
| `webserver.meshUserHandler` | `CreateMeshUser` | `hook_beforeCreateMeshUser`, `hook_afterCreateMeshUser` | `(parent, db, ws, req, args, domain, user)` → `(meshuser, ...)` |
| `meshserver` | `NotifyUserOfDeviceStateChange` | `hook_beforeNotifyUserOfDeviceStateChange`, `hook_afterNotifyUserOfDeviceStateChange` | `(_, nodeid, connectTime, connectType, powerState, serverid, stateSet, extraInfo)` → `(_, meshid, nodeid, ...)` (retorna `stateSet`) |

Plugins podem wrappear suas próprias funções via `wrapFunctionCall` ([`plugins/pluginhookexample/02-server.md:101`](plugins/pluginhookexample/02-server.md)):

| Hook | Quando é chamado | Argumentos |
|------|------------------|------------|
| `hook_beforeCreateExample` | Antes de `example.namespace1.handler.CreateExample(value)` | `(value)` |
| `hook_afterCreateExample` | Depois — pode modificar `obj` | `(obj, value) → obj` |
| `hook_beforeCreateAnotherExample` | Antes de `CreateExample` com alias `'CreateAnotherExample'` | `(value)` |
| `hook_afterCreateAnotherExample` | Depois | `(obj, value) → obj` |

**Aliases:** o terceiro arg `alias` permite que `wrapFunctionCall(target, 'fnA', 'fnB')` procure por `hook_beforefnB`/`hook_afterfnA` ([`plugins/pluginhookscheduler/02-server.md:194`](plugins/pluginhookscheduler/02-server.md)).

**Custom hook registration:** para hooks custom, plugins auto-adicionam ao `pluginConfig.backendhooks`:
```js
// plugins/pluginhookexample/02-server.md:83
['hook_beforeCreateExample', 'hook_afterCreateExample', ...].forEach((hookname) => {
    hookSchedulerConfig.backendhooks.hasOwnProperty(hookname) || (hookSchedulerConfig.backendhooks[hookname] = []);
});
```

**Return values críticos:**
- `hook_after*` deve retornar o objeto wrappado (`return meshagent` / `return meshrelay` / `return stateSet`) para que modificações sejam visíveis ao caller ([`plugins/pluginhookexample/02-server.md:151`](plugins/pluginhookexample/02-server.md), [`plugins/agentname2servername/02-server.md:125`](plugins/agentname2servername/02-server.md)).

**Ordering:** o PluginHookScheduler respeita `pluginConfig.backendhooks[hookName]` como uma lista ordenada. Plugins não listados são chamados **depois** (sem ordem entre si). Wildcard `*` significa "todos os não-listados" ([`plugins/pluginhookscheduler/02-server.md:191-193`](plugins/pluginhookscheduler/02-server.md)).

---

## Hooks especiais do frontend bundle (chamados automaticamente pelo `meshcentral.js`)

O `refreshJS` ([`core/01-pluginhandler.md:36`](core/01-pluginhandler.md)) injeta também um helper genérico no bundle:

```js
obj.callHook = function(hookName, ...args) {
    for (const p of Object.keys(obj)) {
        if (typeof obj[p][hookName] == 'function') { obj[p][hookName].apply(this, args); }
    }
};
```

Ou seja, no **frontend**, plugins também podem chamar `pluginHandler.callHook('onSomeEvent', ...)` para invocar métodos de outros plugins. Isso é como plugins frontend-only colaboram (vide [`plugins/sample/01-sample-minimal.md`](plugins/sample/01-sample-minimal.md)).

---

## Resumo rápido: "qual hook uso para..."

| Caso de uso | Hook |
|-------------|------|
| Saber quando um agente conectou | `hook_afterCreateMeshAgent` (precisa PluginHookScheduler) |
| Saber quando um agente terminou de carregar meshcore | `hook_agentCoreIsStable` |
| Saber quando um agente desconectou | `hook_agentWebSocketDisconnected` |
| Reagir a login de user | `hook_userLoggedIn` |
| Adicionar tab ao device page | `onDeviceRefreshEnd` (frontend) + `pluginHandler.registerPluginTab()` |
| Adicionar link no menu account | `onWebUIStartupEnd` (DOM injection) |
| Iniciar routes TCP ao login | `hook_userLoggedIn` + `startRoute` |
| Reagir a mudanças de node online/offline | `hook_before/afterNotifyUserOfDeviceStateChange` |
| Logout de user | `hook_userLoggedOut` |
| Criar/Update UI em admin | `handleAdminReq` (Express route, não hook) |
| Reagir a admin action | `serveraction` (frontend→backend, não hook) |

**Para uma referência completa de QUAL hook chamar para CADA tarefa, vide [`PERGUNTA-RESPOSTA-NATIVA.md § 9`](PERGUNTA-RESPOSTA-NATIVA.md#9-hooks) e [`FLUXOS-E2E.md`](FLUXOS-E2E.md).**