> ⚠️ **Escopo**: perguntas sobre APIs nativas do **MeshCentral upstream** referenciadas pelo plugin User-Device Tracer. As referências a `core/*.md` e `plugins/<name>/*.md` apontam para arquivos de análise que **não fazem parte** deste repositório. O snippet "Mais nativo" é a API real do MeshCentral, validada contra o source em `C:\tmp\MeshCentral\`.

# ❓ Pergunta → Resposta Nativa

> **40+ perguntas reais** de desenvolvimento de plugin MeshCentral, cada uma com **caminho mais nativo + fallback + localização `arquivo:linha` + suporte por backend**.

Convenções:
- **Mais nativo** = a API pública documentada que NÃO requer reinvenção.
- **Fallback** = o que fazer se a nativa não estiver disponível (ex: arquivo não está no repo).
- **Backend** = quais DBs suportam o método (`NeDB`/`MongoDB`/`SQL`/`AceBase`/`SQLite`).

---

## 1. Agentes conectados

### "Como eu pego todos os agentes online?"
**Mais nativo:**
```js
// core/02-webserver-routes.md:120 — wsagents é indexado por nodeId (dbMeshKey+dbNodeKey)
const onlineNodeIds = Object.keys(parent.webserver.wsagents);
// ou com objects completos:
const agents = Object.values(parent.webserver.wsagents);
```
**Fallback:** se o agente acabou de conectar mas ainda não está em `wsagents`, escute `hook_agentCoreIsStable(myparent, gp)` ([`HOOKS-CATALOG.md`](HOOKS-CATALOG.md)) — chamado quando meshcore terminou de carregar.
**Localização no código:** [`core/02-webserver-routes.md`](core/02-webserver-routes.md), [`plugins/scripttask/02-scripttask-server.md:54`](plugins/scripttask/02-scripttask-server.md)
**Backend support:** N/A (in-memory).

### "Como verifico se um nodeid específico está online?"
**Mais nativo:**
```js
// core/02-webserver-routes.md:120 — lookup direto
const isOnline = !!parent.webserver.wsagents[dbNodeKey];
// ou via cache oficial:
const state = parent.GetConnectivityState(dbNodeKey); // vide core/08-meshcentral-server.md:55
```
**Fallback:** verifique `parent.webserver.GetConnectivityState(nodeid)` (cache `connectivityByNode`).
**Localização no código:** [`plugins/printercontrol/02-server.md:159`](plugins/printercontrol/02-server.md) (helper `agentIsOnline`), [`core/08-meshcentral-server.md:55`](core/08-meshcentral-server.md)
**Backend support:** N/A (in-memory).

### "Como pego o agentInfo (versão do agent, plataforma)?"
**Mais nativo:**
```js
// MeshAgent.agentInfo é populado após authentication. core/12-meshagent.md:31
const ws = parent.webserver.wsagents[dbNodeKey];
const info = ws?.agentInfo; // {version, platform, computerName, ...}
```
**Fallback:** se o agente está off-line, leia do `nodedoc` (campo `agent` é setado no `SetNode` quando conecta).
**Localização no código:** [`core/12-meshagent.md`](core/12-meshagent.md), [`plugins/agentname2servername/02-server.md`](plugins/agentname2servername/02-server.md)
**Backend support:** N/A.

### "Como pego o IP/hostname de um agente?"
**Mais nativo (em runtime):**
```js
// agentInfo é populado pelo MeshAgent na primeira msg; ws._socket tem o IP TCP:
const ip = ws._socket?.remoteAddress; // IPv4/IPv6 mapped
const hostname = ws.agentInfo?.computerName || ws.agentInfo?.hostname;
```
**Fallback:** `mesh.nodes[meshid][nodeid].host` (campo persistente do node doc — vide `db.js:GetNode`).
**Localização no código:** [`core/12-meshagent.md:31`](core/12-meshagent.md), `meshagent.js:agentInfo` (não no repo)
**Backend support:** N/A.

### "Como pego os usuários logados em um agente (Windows)?"
**Mais nativo:** chame PowerShell via `modules_meshcore/<plugin>.js`:
```js
// agent-side pattern (de printercontrol/eventlog)
const ps = 'Get-CimInstance Win32_LoggedOnUser | Select User,LogonType | ConvertTo-Json -Compress';
const {execFile} = require('child_process');
execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    {cwd: process.env.TEMP}, (err, stdout) => {
        myparent.send(JSON.stringify({action:'plugin', plugin:'<name>', pluginaction:'loggedOnUsersResult', data: stdout}));
    });
```
**Fallback:** use o agentInfo que vem com `users` array no Windows (se o MeshAgent version suporta) — vide `core/12-meshagent.md:31`.
**Localização no código:** [`plugins/eventlog/03-eventlog-agent.md`](plugins/eventlog/03-eventlog-agent.md) (PowerShell pattern), [`plugins/regedit/02-server.md`](plugins/regedit/02-server.md) (`userSidsToProfiles`).
**Backend support:** N/A (agent-side).

---

## 2. Usuários

### "Como pego o usuário logado no browser?"
**Mais nativo:** o `MeshUser` é o primeiro argumento de `serveraction`, ou acessível em qualquer hook:
```js
// serveraction é chamado com (command, myparent=MeshUser, grandparent=meshserver)
obj.serveraction = function(command, myparent, grandparent) {
    const user = myparent.user; // {_id, domain, name, email, siteadmin, ...}
    const domain = myparent.domain;
    // ...
};
```
**Fallback:** decodifique o cookie `meshcentral_<digest>`:
```js
const decoded = parent.decodeCookie(req.cookies['meshcentral_<digest>'], parent.loginCookieEncryptionKey);
// decoded = {userid, domainid, ...}
```
**Localização no código:** [`core/11-meshuser.md`](core/11-meshuser.md), [`core/03-webserver-auth-acl.md:39`](core/03-webserver-auth-acl.md), [`plugins/eventlog/02-eventlog-server.md:131`](plugins/eventlog/02-eventlog-server.md)
**Backend support:** N/A.

### "Como pego todos os usuários de um mesh?"
**Mais nativo:**
```js
// core/05-db-api.md:50 — GetAllUsers(domainid)
parent.db.GetAllUsers(domainId, function(err, users) {
    // users = [{_id, name, email, rights, ...}]
});
```
**Fallback:** itere `parent.webserver.meshes[meshid].users` (objeto indexado por userId).
**Localização no código:** [`core/05-db-api.md`](core/05-db-api.md), `db.js:GetAllUsers` (linhas upstream ~1900)
**Backend support:** Todos (NeDB/MongoDB/MariaDB/MySQL/PG/AceBase/SQLite).

### "Como pego o nome real/email/telefone de um usuário?"
**Mais nativo:**
```js
// db.js:GetUser(domainId, userId, cb) — vide core/05-db-api.md:50
parent.db.GetUser(domainId, userId, function(err, user) {
    const name = user.name;       // display name (não o userid)
    const email = user.email;
    const phone = user.phone;     // opcional
    const siteadmin = user.siteadmin; // 0xFFFFFFFF = admin
});
```
**Fallback:** os campos estão no `MeshUser.user` (passado em `serveraction`).
**Localização no código:** [`core/05-db-api.md:50`](core/05-db-api.md)
**Backend support:** Todos. **Nota:** email/phone são campos opcionais — podem ser `null`.

### "Como descubro o ID do próprio MeshCentral usuário (a partir do serveraction)?"
**Mais nativo:**
```js
obj.serveraction = function(command, myparent, grandparent) {
    const userId = myparent.user._id; // 'user/<domainId>/<userName>'
    const domainId = myparent.user.domain;
};
```
**Fallback:** `myparent.sessionId.split('/')[2]` (o userid é o 3º componente).
**Localização no código:** [`core/11-meshuser.md`](core/11-meshuser.md)
**Backend support:** N/A.

### "Como listo todos os usuários admin?"
**Mais nativo:**
```js
parent.db.GetAllUsers(domainId, function(err, users) {
    const admins = users.filter(u => u.siteadmin === 0xFFFFFFFF);
});
```
**Fallback:** durante o request, `myparent.user.siteadmin === 0xFFFFFFFF` checa se o requester é admin.
**Localização no código:** [`plugins/eventlog/04-eventlog-admin.md:17`](plugins/eventlog/04-eventlog-admin.md), [`plugins/devtools/02-server.md:44`](plugins/devtools/02-server.md)
**Backend support:** Todos.

---

## 3. Dispositivos/Nós

### "Como pego o node pelo nodeid?"
**Mais nativo:**
```js
// core/05-db-api.md:53 — GetNode(meshid, nodeid, cb)
parent.db.GetNode(meshid, nodeid, function(err, node) {
    // node = {_id, name, mesh, host, agent, ...}
});
```
**Fallback:** `parent.webserver.meshes[meshid].nodes[nodeid]` (in-memory, só nodes conectados).
**Localização no código:** [`core/05-db-api.md:53`](core/05-db-api.md)
**Backend support:** Todos.

### "Como listo todos os nodes de um mesh?"
**Mais nativo:**
```js
// db.js:GetAllMeshes + per-mesh nodes (upstream)
parent.db.GetMesh(meshid, function(err, mesh) {
    // mesh.nodes = {} indexado por nodeid (não array)
    const nodeIds = Object.keys(mesh.nodes);
});
```
**Fallback:** `Object.keys(parent.webserver.meshes[meshid].nodes)` (in-memory).
**Localização no código:** [`core/05-db-api.md:53`](core/05-db-api.md)
**Backend support:** Todos.

### "Como pego o nodedoc inteiro (com users, lusers, etc.)?"
**Mais nativo:**
```js
// nodedoc é o doc completo do nodedb — vide core/05-db-api.md:53
parent.db.GetNode(meshid, nodeid, function(err, nodedoc) {
    // nodedoc.users = {} (allowed users)
    // nodedoc.lusers = {} (linked users — adicionados automaticamente)
    // nodedoc.host, nodedoc.agent, nodedoc.tags, nodedoc.flags
});
```
**Fallback:** `parent.webserver.GetNodeWithRights(domain, user, nodeid, cb)` retorna `(node, rights)` com rights = bitmask.
**Localização no código:** [`core/05-db-api.md`](core/05-db-api.md), [`core/03-webserver-auth-acl.md:33`](core/03-webserver-auth-acl.md)
**Backend support:** Todos.

### "Como descubro se dispositivo está online (power state)?"
**Mais nativo:**
```js
// agentInfo tem powerState via sysinfo do agente
const ws = parent.webserver.wsagents[dbNodeKey];
const powerState = ws?.agentInfo?.powerState; // 0=AC, 1=Battery
const online = !!ws;
```
**Fallback:** `parent.GetConnectivityState(nodeid)` → 0=offline, 1+=online (vide [`core/08-meshcentral-server.md:55`](core/08-meshcentral-server.md)).
**Localização no código:** [`plugins/printercontrol/02-server.md:159`](plugins/printercontrol/02-server.md), [`core/08-meshcentral-server.md`](core/08-meshcentral-server.md)
**Backend support:** N/A (runtime).

### "Como pego a versão do MeshAgent rodando?"
**Mais nativo:**
```js
const ws = parent.webserver.wsagents[dbNodeKey];
const version = ws?.agentInfo?.version; // e.g., "1.1.0-s"
```
**Fallback:** o binário `/meshagents/meshagent.msh` tem versão; o agente faz `GET /meshagents/meshagent.msh?v=<version>` para update.
**Localização no código:** [`core/12-meshagent.md:31`](core/12-meshagent.md), `meshagent.js:agentInfo` (não no repo).
**Backend support:** N/A.

### "Como pego o OS/descrição?"
**Mais nativo:**
```js
// OS é enviado em agentInfo no connect
const ws = parent.webserver.wsagents[dbNodeKey];
const osdesc = ws?.agentInfo?.osdesc; // "Windows 10 Enterprise 22H2", "Ubuntu 22.04"
const platform = ws?.agentInfo?.platform; // "win32", "linux"
```
**Fallback:** `nodedoc.host` no DB (campo persistente, atualizado em connect).
**Localização no código:** [`plugins/eventlog/02-eventlog-server.md:65`](plugins/eventlog/02-eventlog-server.md) (Windows check via `osdesc.toLowerCase().indexOf('windows')`), [`plugins/regedit/02-server.md:129`](plugins/regedit/02-server.md)
**Backend support:** N/A.

### "Como pego a última conexão?"
**Mais nativo:**
```js
parent.db.GetNode(meshid, nodeid, function(err, node) {
    const lastConnect = node.lastConnect;  // timestamp (seconds since epoch)
    const lastDisconnect = node.lastDisconnect;
});
```
**Fallback:** `parent.GetConnectivityState(nodeid)` (cache in-memory).
**Localização no código:** [`core/05-db-api.md:53`](core/05-db-api.md)
**Backend support:** Todos.

### "Como pego IP+geo-location?"
**Mais nativo (server-side):**
```js
const ws = parent.webserver.wsagents[dbNodeKey];
const ip = ws?._socket?.remoteAddress; // TCP-level, pode ser proxy/CDN
```
**Mais nativo (agent-side, em modules_meshcore/<plugin>.js):**
```js
// no agent-side, mesh.info pode ter public IP se o agente fez STUN-like detection
// senão: ip está disponível via process.env ou via Get-NetIPAddress no PowerShell
```
**Fallback:** use um serviço externo de geo-IP (não existe integração nativa no MeshCentral).
**Localização no código:** [`core/12-meshagent.md`](core/12-meshagent.md), `meshagent.js` (não no repo).
**Backend support:** N/A.

---

## 4. Meshes/Device Groups

### "Como listo meshes?"
**Mais nativo:**
```js
// db.js:GetAllMeshes(domainid, cb)
parent.db.GetAllMeshes(domainId, function(err, meshes) {
    // meshes = [{_id, name, domain, type, ...}]
});
```
**Fallback:** `Object.keys(parent.webserver.meshes)` (in-memory).
**Localização no código:** [`core/05-db-api.md:53`](core/05-db-api.md)
**Backend support:** Todos.

### "Como pego um mesh específico?"
**Mais nativo:**
```js
parent.db.GetMesh(meshid, function(err, mesh) {
    // mesh._id, mesh.name, mesh.users, mesh.nodes
});
```
**Fallback:** `parent.webserver.meshes[meshid]` (in-memory).
**Localização no código:** [`core/05-db-api.md`](core/05-db-api.md)
**Backend support:** Todos.

### "Como pego os nodes de um mesh?"
**Mais nativo:**
```js
parent.db.GetMesh(meshid, function(err, mesh) {
    const nodes = mesh.nodes; // {} indexado por nodeid
});
```
**Fallback:** `Object.keys(parent.webserver.meshes[meshid].nodes)`.
**Localização no código:** [`core/05-db-api.md`](core/05-db-api.md)
**Backend support:** Todos.

### "Como pego os direitos (rights) de um user em um mesh?"
**Mais nativo:**
```js
// vide pluginhookexample + webserver GetNodeWithRights (core/03-webserver-auth-acl.md:33)
parent.webserver.GetNodeWithRights(domainId, userObj, nodeId, function(node, rights) {
    // rights = bitmask: 0xFFFFFFFF = fulladmin
    // bits: 1=desktop, 2=files, 4=terminal, 8=console, 16=power, ...
    // vide common.js:meshServerRightsArrayToNumber (core/14-common-utils.md:111)
});
```
**Fallback:** `mesh.users[userid].rights` direto.
**Localização no código:** [`core/03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md), [`plugins/printercontrol/02-server.md:148`](plugins/printercontrol/02-server.md)
**Backend support:** N/A (in-memory cache do mesh).

### "Como verifico se user pode acessar um node?"
**Mais nativo:**
```js
// Padrão em printercontrol.js:148 — use com try/catch
parent.webserver.GetNodeWithRights(domainId, userObj, nodeId, function(err, node, rights) {
    if (!node || rights === 0) return callback(new Error('Access denied'));
    // ...
});
```
**Fallback:** `parent.parent.checkPluginPermission(user, '<pluginName>', '<permission>', nodeId, meshId)` — vide [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md) (mais granular).
**Localização no código:** [`core/03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md), [`plugins/printercontrol/02-server.md`](plugins/printercontrol/02-server.md)
**Backend support:** N/A.

---

## 5. Comunicação

### "Como envio um comando/plugin para um agente?"
**Mais nativo:**
```js
// core/02-webserver-routes.md:124, plugins/scripttask.js:114
parent.webserver.wsagents[dbNodeKey].send(JSON.stringify({
    action: 'plugin',
    plugin: '<yourShortName>',
    pluginaction: '<verb>',
    /* payload */
}));
```
**Fallback:** via DispatchEvent? NÃO — DispatchEvent vai para browsers/users, não agentes. Use direto.
**Localização no código:** [`core/02-webserver-routes.md`](core/02-webserver-routes.md), [`plugins/scripttask/02-scripttask-server.md:79`](plugins/scripttask/02-scripttask-server.md), [`plugins/regedit/02-server.md:115`](plugins/regedit/02-server.md)
**Backend support:** N/A.

### "Como recebo resposta do agente?"
**Mais nativo:** o agente responde via `mesh.SendCommand({...action:'plugin', pluginaction:'<verb>Result', ...})`. O server-side `serveraction` recebe:
```js
// plugins/regedit/02-server.md:90-111 — match por sessionid
obj.serveraction = function(command, myparent, grandparent) {
    if (command.pluginaction.endsWith('Result')) {
        const targetSessionId = command.sessionid;
        grandparent.wssessions2[targetSessionId]?.send(JSON.stringify({...}));
    }
};
```
**Fallback:** request/response correlation via `requestId` (printercontrol pattern) ou `sessionid` (regedit pattern).
**Localização no código:** [`plugins/printercontrol/02-server.md:148`](plugins/printercontrol/02-server.md) (requestId), [`plugins/regedit/02-server.md:90`](plugins/regedit/02-server.md) (sessionid).
**Backend support:** N/A.

### "Como faço broadcast para todos os browsers?"
**Mais nativo:**
```js
// core/09-meshcentral-event-dispatch.md
parent.DispatchEvent(
    ['*', 'server-users'], // targets
    obj,                    // source (plugin instance)
    {
        action: 'plugin',
        plugin: '<shortName>',
        pluginaction: '<methodName>',
        // ...payload
    }
);
```
**Fallback:** itere `parent.webserver.wssessions2` e chame `.send()` em cada um (mas perde de-dup).
**Localização no código:** [`core/09-meshcentral-event-dispatch.md`](core/09-meshcentral-event-dispatch.md), [`plugins/scripttask/02-scripttask-server.md:158`](plugins/scripttask/02-scripttask-server.md), [`plugins/filedist/02-server.md:194`](plugins/filedist/02-server.md)
**Backend support:** N/A.

### "Como envio para uma sessão específica (a que originou a request)?"
**Mais nativo:**
```js
// core/02-webserver-routes.md:125, plugins/regedit/02-server.md:105
obj.serveraction = function(command, myparent, grandparent) {
    // myparent é a MeshUser session; grandparent é meshserver
    myparent.send(JSON.stringify({action:'plugin', plugin:'<name>', method:'<callback>', ...payload}));
    // ou via wssessions2 lookup:
    grandparent.wssessions2[myparent.sessionId]?.send(JSON.stringify({...}));
};
```
**Fallback:** `parent.webserver.wssessions2[sessionId]` direto.
**Localização no código:** [`core/11-meshuser.md`](core/11-meshuser.md), [`plugins/regedit/02-server.md`](plugins/regedit/02-server.md), [`plugins/printercontrol/02-server.md:111`](plugins/printercontrol/02-server.md)
**Backend support:** N/A.

### "Como correlaciono request e resposta?"
**Mais nativo (pattern 1 — `requestId` 36-char hex, printercontrol):**
```js
// server (printercontrol/02-server.md:122)
const requestId = require('crypto').randomBytes(18).toString('hex'); // 36 chars
obj.pending[requestId] = {session, operation, timer};
sendToAgent(nodeId, {action:'plugin', pluginaction:operation, requestId, ...params});
// agent responde: {pluginaction:'operationResult', requestId, success, error, data}
// server matches: obj.pending[requestId] → sendToSession + clearTimeout
```
**Mais nativo (pattern 2 — `sessionid` lookup, regedit):**
```js
// server (regedit/02-server.md:90)
const sessionid = myparent.sessionId; // 'user/<domain>/<userName>/<random>'
sendToAgent(nodeId, {action:'plugin', pluginaction:'enumKey', sessionid, ...});
// agent responde: {pluginaction:'enumKeyResult', sessionid, data}
// server: wssessions2[sessionid].send(...)
```
**Localização no código:** [`plugins/printercontrol/02-server.md`](plugins/printercontrol/02-server.md), [`plugins/regedit/02-server.md`](plugins/regedit/02-server.md).
**Backend support:** N/A.

### "Como faço streaming de dados grandes (file content)?"
**Mais nativo (hex chunks via WebSocket, filedist pattern):**
```js
// plugins/filedist/02-server.md:163 — server envia chunks
const command = {action:'plugin', plugin:'filedist', pluginaction:'sendFile', clientpath};
const stream = require('fs').createReadStream(path, {encoding:'hex'});
stream.on('data', chunk => {
    command.data = chunk;
    wsagents[comp].send(JSON.stringify(command));
});
stream.on('end', () => {
    command.data = 'END';
    wsagents[comp].send(JSON.stringify(command));
});
```
**Fallback:** base64 + base64 decode (overhead ~33%). Ou use `binary` encoding no body parser.
**Localização no código:** [`plugins/filedist/02-server.md:163`](plugins/filedist/02-server.md).
**Backend support:** N/A.

### "Como vejo se um agente mandou um agentmsg?"
**Mais nativo:** agentes mandam `mesh.SendCommand({action:'plugin', plugin:'<name>', pluginaction:'agentmsg', data})`. O server-side recebe em `serveraction`:
```js
obj.serveraction = function(command, myparent, grandparent) {
    if (command.pluginaction === 'agentmsg') {
        // myparent é o MeshAgent (não MeshUser!)
        const nodeId = myparent.dbNodeKey;
        // ...
    }
};
```
**Fallback:** `hook_agentCoreIsStable(myparent, gp)` para ser notificado de novos connects.
**Localização no código:** [`plugins/eventlog/03-eventlog-agent.md:46`](plugins/eventlog/03-eventlog-agent.md) (agent-side `parent.SendCommand`), [`core/12-meshagent.md`](core/12-meshagent.md).
**Backend support:** N/A.

### "Como abro um terminal remoto (WebRTC)?"
**Mais nativo (eventlog Live pattern):**
```js
// plugins/eventlog/02-eventlog-server.md:80 — CreateAgentRedirect para streams
pluginHandler.eventlog.livelog = CreateAgentRedirect(
    meshserver,
    pluginHandler.eventlog.createRemoteEventLog(pluginHandler.eventlog.fe_on_message),
    serverPublicNamePort,  // 'host:port'
    authCookie,
    authRelayCookie,
    domainUrl
);
pluginHandler.eventlog.livelog.Start(currentNode._id);
```
**Fallback:** para desktop/terminal remoto, o MeshCentral core tem o flow nativo via `meshAgentHandler` (consulte docs upstream de `meshCmdHandler`).
**Localização no código:** [`plugins/eventlog/02-eventlog-server.md:80`](plugins/eventlog/02-eventlog-server.md), [`core/02-webserver-routes.md:56`](core/02-webserver-routes.md).
**Backend support:** N/A.

---

## 6. Permissões

### "Como registro permissões de plugin?"
**Mais nativo:**
```js
// plugins/printercontrol/02-server.md:108 — em server_startup
parent.registerPermissions('<shortName>', {
    can_view: {title: 'View X', desc: '...', default: 'denied'},
    manage_X: {title: 'Manage X', desc: '...', default: 'denied'}
});
// default pode ser: 'allowed', 'denied', 'inherited'
```
**Fallback:** use apenas ACL nativo (mesh rights), sem perm granulares.
**Localização no código:** [`plugins/printercontrol/02-server.md:108`](plugins/printercontrol/02-server.md), [`core/01-pluginhandler.md:28`](core/01-pluginhandler.md), [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md).
**Backend support:** N/A (definições in-memory; valores persistidos em `pluginpermissions_<shortName>`).

### "Como checo se user tem permissão X?"
**Mais nativo:**
```js
// plugins/printercontrol/02-server.md:155 — getAccessPermissions
const hasPermission = await parent.getAccessPermissions('<shortName>', user, {nodeId, meshId});
if (!hasPermission('can_view')) return fail('permission denied');
```
**Fallback:** `parent.checkPluginPermission(user, '<shortName>', 'can_view', nodeId, meshId)` — sync, retorna bool.
**Localização no código:** [`plugins/printercontrol/02-server.md`](plugins/printercontrol/02-server.md), [`core/01-pluginhandler.md:28`](core/01-pluginhandler.md), [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md).
**Backend support:** N/A.

### "Como peço permissão no escopo de um node vs mesh vs global?"
**Mais nativo:** o escopo é passado como argumento em `getAccessPermissions`:
```js
// node-scope:
parent.getAccessPermissions(pluginName, user, {nodeId});
// mesh-scope:
parent.getAccessPermissions(pluginName, user, {meshId});
// global (sem contexto):
parent.getAccessPermissions(pluginName, user, null);
```
**Fallback:** admin configura via `/pluginadmin.ashx?pin=<shortName>` (UI auto-gerada pelo core).
**Localização no código:** [`core/01-pluginhandler.md:28`](core/01-pluginhandler.md), [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md).
**Backend support:** schema em `pluginpermissions_<shortName>`: `{nodeOverrides: {nodeId: {...}}, meshOverrides: {meshId: {...}}, ...}` (vide [`core/07-db-pluginsystem.md:60`](core/07-db-pluginsystem.md)).

### "Como acesso o user do MeshCentral que originou uma request?"
**Mais nativo:**
```js
obj.serveraction = function(command, myparent, grandparent) {
    const user = myparent.user;     // {_id, domain, name, email, siteadmin, ...}
    const domain = myparent.domain; // {_id, name}
    // myparent.sessionId = 'user/<domainId>/<userId>/<random>'
};
```
**Fallback:** decodifique `req.cookies['meshcentral_<digest>']` via `parent.decodeCookie`.
**Localização no código:** [`core/11-meshuser.md`](core/11-meshuser.md), [`plugins/eventlog/02-eventlog-server.md:131`](plugins/eventlog/02-eventlog-server.md).
**Backend support:** N/A.

---

## 7. DB próprio

### "Como crio um DB próprio para o plugin?"
**Mais nativo:** copie o padrão de [`plugins/eventlog/db.js`](plugins/eventlog/db.js) ou [`plugins/scripttask/db.js`](plugins/scripttask/db.js):
```js
// plugins/scripttask/db.js pattern
const {CreateDB} = require('./db.js'); // seu plugin
// Em server_startup:
obj.db = require(__dirname + '/db.js').CreateDB(parent);
```
**Fallback:** use `parent.db` (core db) com `type: 'plugin_<shortName>'` no doc — mas isso requer privilégios.
**Localização no código:** [`plugins/scripttask/02-scripttask-server.md:37`](plugins/scripttask/02-scripttask-server.md), [`plugins/eventlog/05-db.md`](plugins/eventlog/05-db.md), [`plugins/filedist/02-server.md`](plugins/filedist/02-server.md).
**Backend support:** escolha NeDB (default, sem setup) ou MongoDB (mesmo cluster).

### "Como suporto múltiplos backends (NeDB+MongoDB)?"
**Mais nativo:** `nemongo.js` shim (vide [`core/15-package-deps.md:81`](core/15-package-deps.md)) — single API abstrai:
```js
// nemongo detecta mongo via process.env ou args.mongodb
const collection = obj.db.collection('myCollection');
collection.insertOne(doc);
collection.find({...}).sort({...}).toArray(cb);
```
**Fallback:** branching manual `if (parent.args.mongodb) { /* MongoDB */ } else { /* NeDB */ }` (vide [`plugins/eventlog/db.js`](plugins/eventlog/db.js)).
**Localização no código:** [`plugins/scripttask/db.js:14`](plugins/scripttask/db.js), [`plugins/eventlog/05-db.md`](plugins/eventlog/05-db.md).
**Backend support:** depende do shim; nemongo geralmente cobre NeDB + MongoDB.

### "Como faço query com data range?"
**Mais nativo:**
```js
// nemongo pattern
collection.find({time: {$gte: startEpoch, $lte: endEpoch}}).sort({time:-1}).toArray(cb);
```
**Fallback (NeDB nativo):**
```js
collection.find({time: {$gte: startEpoch, $lte: endEpoch}}).sort({time:-1}).exec(cb);
```
**Localização no código:** [`plugins/eventlog/05-db.md:69`](plugins/eventlog/05-db.md).
**Backend support:** ambos via nemongo. MongoDB nativo usa `new Date(epoch*1000)`.

### "Como faço TTL/expire?"
**Mais nativo:**
```js
// MongoDB (vide plugins/eventlog/05-db.md:46)
collection.createIndex({time: 1}, {expireAfterSeconds: 30 * 24 * 60 * 60});
// NeDB: cleanup manual via setInterval
setInterval(() => {
    const cutoff = Date.now() - 30*86400*1000;
    collection.remove({time: {$lt: cutoff}}, {multi: true});
}, 3600 * 1000);
```
**Fallback:** cleanup job no `server_startup`.
**Localização no código:** [`plugins/eventlog/05-db.md:36`](plugins/eventlog/05-db.md).
**Backend support:** MongoDB (nativo), NeDB/AceBase (manual via `maintenance()`), SQL (DELETE WHERE + cron).

### "Como faço full-text search (se houver)?"
**Mais nativo:** **NÃO existe helper nativo**. Implemente:
```js
// MongoDB
collection.find({$text: {$search: 'query'}}).toArray(cb);
// NeDB (sem index full-text): use regex
collection.find({Message: new RegExp(query, 'i')}).exec(cb);
```
**Localização no código:** [`plugins/regedit/02-server.md`](plugins/regedit/02-server.md) (search plugin via PowerShell, não DB).
**Backend support:** MongoDB tem `$text` (requer text index). NeDB/AceBase/SQL dependem de LIKE/regex.

---

## 8. HTTP/Web

### "Como registro uma rota HTTP no plugin?"
**Mais nativo:** adicione ao `obj.app` em `server_startup`:
```js
// pattern típico
obj.server_startup = function() {
    parent.app.get('/myplugin/api/:id', (req, res) => {
        // req.query, req.params, req.cookies
        // authenticate via req.cookies['meshcentral_<digest>']
        // ...
    });
};
```
**Fallback:** use `/pluginadmin.ashx?pin=<shortName>` com query params (o que `devtools`, `eventlog` fazem).
**Localização no código:** [`core/02-webserver-routes.md:30`](core/02-webserver-routes.md), [`plugins/eventlog/04-eventlog-admin.md`](plugins/eventlog/04-eventlog-admin.md).
**Backend support:** N/A (Express nativo).

### "Como lido com upload de arquivo?"
**Mais nativo:** body parser `multipart/form-data`:
```js
const multer = require('multer')({dest: '/tmp/uploads'});
parent.app.post('/myplugin/upload', multer.single('file'), (req, res) => {
    const uploadedPath = req.file.path;
    const originalName = req.file.originalname;
    // process...
});
```
**Fallback:** Express tem body parser JSON/urlencoded built-in. Para uploads raw use `bodyParser.raw({type: '*/*', limit: '100mb'})`.
**Localização no código:** [`core/02-webserver-routes.md:43`](core/02-webserver-routes.md) (`/uploads/...` route existe nativamente).
**Backend support:** N/A.

### "Como sirvo arquivos estáticos?"
**Mais nativo:**
```js
parent.app.use('/myplugin/static', parent.express.static(__dirname + '/public'));
```
**Fallback:** rota manual com `res.sendFile` ou streaming.
**Localização no código:** [`core/04-webserver-views-render.md`](core/04-webserver-views-render.md).
**Backend support:** N/A.

### "Como autentico uma request HTTP?"
**Mais nativo:**
```js
parent.app.get('/myplugin/api', (req, res) => {
    const cookieJar = req.cookies;
    // iterate até achar 'meshcentral_<digest>'
    for (const k of Object.keys(cookieJar)) {
        if (k.startsWith('meshcentral_')) {
            const decoded = parent.decodeCookie(cookieJar[k], parent.loginCookieEncryptionKey);
            if (decoded) {
                const userid = decoded.userid;  // 'user/<domain>/<name>'
                const domainid = decoded.domainid;
                // ...
            }
        }
    }
});
```
**Fallback:** force login redirect (302 → `/login.ashx?redirecturl=...`).
**Localização no código:** [`core/03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md), [`core/14-common-utils.md`](core/14-common-utils.md).
**Backend support:** N/A.

---

## 9. Hooks

> Veja [`HOOKS-CATALOG.md`](HOOKS-CATALOG.md) para a lista exaustiva. Resumo aqui:

### "O que são hooks e como registro?"
**Mais nativo:** hooks são **funções no plugin instance** chamadas pelo `pluginHandler.callHook('hookName', ...args)`:
```js
// plugin handler chama em loop:
for (const p of Object.values(parent.plugins)) {
    if (typeof p['hookName'] === 'function') p['hookName'](...args);
}
```
Seu plugin os expõe automaticamente:
```js
obj.hookName = function(arg1, arg2) { /* ... */ };
```
**Localização no código:** [`core/01-pluginhandler.md:22`](core/01-pluginhandler.md) (`callHook`).

### "Como intercepto eventos de agent connect?"
**Mais nativo:** `hook_afterCreateMeshAgent(meshagent, parent, db, ws, req, args, domain)` (requer `PluginHookScheduler` para orquestração) — vide [`plugins/pluginhookscheduler/01-overview.md`](plugins/pluginhookscheduler/01-overview.md) e [`plugins/pluginhookexample/01-overview.md`](plugins/pluginhookexample/01-overview.md).
**Fallback:** monitore `wsagents` em `server_startup` via polling ou escute `ws.on('connection')`.
**Localização no código:** [`plugins/pluginhookexample/01-overview.md:51`](plugins/pluginhookexample/01-overview.md), [`plugins/agentname2servername/02-server.md:30`](plugins/agentname2servername/02-server.md).

### "Como intercepto mudanças de estado de node (online/offline)?"
**Mais nativo:** `hook_agentWebSocketDisconnected(meshagent)` (vide pluginhookexample) + `hook_beforeNotifyUserOfDeviceStateChange(...)` / `hook_afterNotifyUserOfDeviceStateChange(...)` (vide [`core/08-meshcentral-server.md:59`](core/08-meshcentral-server.md)).
**Fallback:** observe `obj.parent.NotifyUserOfDeviceStateChange` via polling.
**Localização no código:** [`plugins/pluginhookexample/01-overview.md`](plugins/pluginhookexample/01-overview.md), [`HOOKS-CATALOG.md`](HOOKS-CATALOG.md).

### "Como hook em mudanças de usuário?"
**Mais nativo (login):**
```js
obj.hook_userLoggedIn = function(user) {
    // chamado quando user loga no browser (vide plugins/routeplus/02-server.md:99)
};
```
**Mais nativo (logout):** `hook_userLoggedOut` (vide [`HOOKS-CATALOG.md`](HOOKS-CATALOG.md)).
**Localização no código:** [`plugins/routeplus/02-server.md:99`](plugins/routeplus/02-server.md).

### "Como hook em MESHCENTRAL core functions (wrapFunctionCall pattern)?"
**Mais nativo:** `PluginHookScheduler` adiciona `pluginHandler.wrapFunctionCall(target, fnName, alias?)`:
```js
// plugins/pluginhookscheduler/02-server.md:157
pluginHandler.wrapFunctionCall(webserver.meshAgentHandler, 'CreateMeshAgent');
// cria before/after hooks:
obj.hook_beforeCreateMeshAgent = function(...args) { /* before */ };
obj.hook_afterCreateMeshAgent = function(meshagent, ...args) { return meshagent; };
```
**Localização no código:** [`plugins/pluginhookscheduler/02-server.md`](plugins/pluginhookscheduler/02-server.md), [`plugins/pluginhookexample/02-server.md`](plugins/pluginhookexample/02-server.md).

---

## 10. Frontend

### "Como adiciono uma tab no device page?"
**Mais nativo:**
```js
// em on_device_page() (hook chamado quando device page é renderizada)
obj.exports.push('on_device_page');
obj.on_device_page = function() {
    return '<div id="pluginMyTab"></div>';
};
// OU use pluginHandler.registerPluginTab() em onDeviceRefreshEnd
obj.onDeviceRefreshEnd = function(nodeid, panel, refresh, event) {
    pluginHandler.registerPluginTab({tabTitle: 'My Tab', tabId: 'pluginMyTab'});
    QA('pluginMyTab', '<iframe ... />');
};
```
**Localização no código:** [`plugins/eventlog/02-eventlog-server.md:54`](plugins/eventlog/02-eventlog-server.md), [`plugins/regedit/02-server.md:127`](plugins/regedit/02-server.md), [`plugins/filedist/02-server.md:112`](plugins/filedist/02-server.md).
**Backend support:** N/A.

### "Como adiciono uma opção no menu admin?"
**Mais nativo (DOM injection):**
```js
// plugins/routeplus/02-server.md:71 — onWebUIStartupEnd
obj.onWebUIStartupEnd = function() {
    const menuAnchor = document.querySelectorAll('#p2AccountActions > p.mL')[0];
    menuAnchor.innerHTML += '<span><a onclick="pluginHandler.routeplus.openSettings();">My Plugin</a></span>';
};
```
**Fallback:** admin panel auto-gerado pelo core via `hasAdminPanel: true` no `config.json`.
**Localização no código:** [`plugins/routeplus/02-server.md:71`](plugins/routeplus/02-server.md).
**Backend support:** N/A.

### "Como envio mensagem do frontend pro plugin?"
**Mais nativo:**
```js
// no browser (iframe ou main window):
parent.meshserver.send({
    action: 'plugin',
    plugin: '<shortName>',
    pluginaction: '<verb>',
    // ...payload
});
```
**Localização no código:** [`core/04-webserver-views-render.md:139`](core/04-webserver-views-render.md), [`plugins/scripttask/01-overview.md:35`](plugins/scripttask/01-overview.md).
**Backend support:** N/A (WebSocket nativo).

### "Como acesso globals (currentNode, meshserver)?"
**Mais nativo (no iframe plugin):**
```js
// parent.* aponta para a window principal do MeshCentral
const node = parent.currentNode;
const ws = parent.meshserver;
const plugin = parent.pluginHandler.<shortName>;
const allNodes = parent.nodes;
const allMeshes = parent.meshes;
```
**Localização no código:** [`core/04-webserver-views-render.md:87`](core/04-webserver-views-render.md).
**Backend support:** N/A.

### "Como abro iframe / popup?"
**Mais nativo (iframe dentro do device page):**
```js
obj.onDeviceRefreshEnd = function() {
    QA('pluginMyTab', '<iframe id="myIframe" src="/pluginadmin.ashx?pin=<shortName>&user=1&node=' + currentNode._id + '" style="width:100%;height:600px"></iframe>');
};
```
**Fallback:** `window.open(url, '_blank')`.
**Localização no código:** [`plugins/filedist/02-server.md:112`](plugins/filedist/02-server.md), [`plugins/eventlog/02-eventlog-server.md`](plugins/eventlog/02-eventlog-server.md).
**Backend support:** N/A.

### "Como injeto CSS no MeshCentral core?"
**Mais nativo:** adicione ao `settings.customCSS[]` em `config.json` (estilos globais).
**Fallback:** injetar `<style>` via DOM no `onWebUIStartupEnd`:
```js
const style = document.createElement('style');
style.textContent = `.myClass { color: red; }`;
document.head.appendChild(style);
```
**Localização no código:** [`core/04-webserver-views-render.md:39`](core/04-webserver-views-render.md), [`plugins/routeplus/02-server.md`](plugins/routeplus/02-server.md).
**Backend support:** N/A.

---

## 11. Agent-side

### "Como injeto código no MeshCore?"
**Mais nativo:** coloque `.js` files em `plugins/<shortName>/modules_meshcore/` com prefixo:
- `win-<name>.js` → Windows agents
- `linux-<name>.js` → Linux agents
- `amt-<name>.js` → Intel AMT agents
- sem prefixo → todas as 3 listas (windows-amt, linux-amt, linux-noamt)

Os arquivos são bundleados via `pluginHandler.addMeshCoreModules` → `meshcentral.updateMeshCore` → `/meshcmd/meshcore.js.gz`.
**Localização no código:** [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md), [`core/01-pluginhandler.md:23`](core/01-pluginhandler.md).
**Backend support:** N/A.

### "Quando meu código roda (init, periodic, on-demand)?"
**Mais nativo:**
- **Init:** adicione `addModule('<name>', '<escapedCode>')` no bundle (executado quando meshcore carrega).
- **Periodic:** use `setInterval`/`setTimeout` no escopo do módulo.
- **On-demand:** defina `obj.consoleaction = function(args, rights, sessionid, parent) { /* server envia, agente executa */ }` — vide [`plugins/eventlog/03-eventlog-agent.md`](plugins/eventlog/03-eventlog-agent.md).
- **Quando meshcore está pronto:** `obj.hook_agentCoreIsStable = function(myparent, gp) { /* ... */ };` chamado no server-side.
**Localização no código:** [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md), [`plugins/eventlog/03-eventlog-agent.md`](plugins/eventlog/03-eventlog-agent.md), [`plugins/filedist/03-agent.md`](plugins/filedist/03-agent.md).
**Backend support:** N/A (Duktape runtime).

### "Como envio dados pro server?"
**Mais nativo (agent-side, dentro de `modules_meshcore/<plugin>.js`):**
```js
// mesh.SendCommand ou parent.SendCommand (depende do escopo)
parent.send(JSON.stringify({
    action: 'plugin',
    plugin: '<shortName>',
    pluginaction: '<verb>',
    // ...payload
}));
```
**Fallback:** `mesh.SendCommand(...)` se disponível.
**Localização no código:** [`plugins/eventlog/03-eventlog-agent.md:46`](plugins/eventlog/03-eventlog-agent.md), [`plugins/filedist/03-agent.md`](plugins/filedist/03-agent.md).
**Backend support:** N/A.

### "Como detecto plataforma (Windows/Linux/AMT)?"
**Mais nativo (agent-side):**
```js
// Duktape tem process.platform
if (process.platform === 'win32') { /* Windows */ }
else if (process.platform === 'linux') { /* Linux */ }
// AMT detection: verifique caps enviadas em agentInfo
if (mesh.info && mesh.info.amt) { /* AMT */ }
```
**Fallback:** use `os.platform()` se exposto via meshcore, ou `process.arch`.
**Localização no código:** [`plugins/regedit/03-agent.md`](plugins/regedit/03-agent.md) (Windows gate), [`core/12-meshagent.md`](core/12-meshagent.md).
**Backend support:** N/A.

---

## 12. Misc

### "Como acesso args/config?"
**Mais nativo:**
```js
// args = process.argv parseado (vide core/08-meshcentral-server.md:18)
const args = parent.args; // args.mongodb, args.cert, args.settings...
const config = parent.config; // config.json parseado
```
**Localização no código:** [`core/08-meshcentral-server.md:19`](core/08-meshcentral-server.md), [`core/01-pluginhandler.md`](core/01-pluginhandler.md).
**Backend support:** N/A.

### "Como programo timers/setInterval?"
**Mais nativo:**
```js
// em server_startup:
obj.intervalTimer = setInterval(obj.queueRun, 60 * 1000); // 1 min
// cleanup em Stop ou plugin disable:
clearInterval(obj.intervalTimer);
```
**Fallback:** use `.unref()` para não bloquear shutdown:
```js
setInterval(fn, 60000).unref();
```
**Localização no código:** [`plugins/scripttask/02-scripttask-server.md:60`](plugins/scripttask/02-scripttask-server.md) (`queueRun`), [`plugins/workfromhome/02-server.md:24`](plugins/workfromhome/02-server.md) (`resetQueueTimer`), [`plugins/filedist/02-server.md:101`](plugins/filedist/02-server.md).
**Backend support:** N/A.

### "Como deleto arquivos temporários?"
**Mais nativo:**
```js
const fs = require('fs');
const path = require('path');
const tmp = path.join(require('os').tmpdir(), 'myplugin_' + Date.now());
fs.rmSync(tmp, {recursive: true, force: true});
```
**Fallback:** `require('rimraf')` (cross-platform).
**Localização no código:** [`plugins/filedist/02-server.md:154`](plugins/filedist/02-server.md) (`IsFilenameValid`), [`core/14-common-utils.md:42`](core/14-common-utils.md).
**Backend support:** N/A.

### "Como uso crypto no plugin?"
**Mais nativo:** Node.js built-in:
```js
const crypto = require('crypto');
const hash = crypto.createHash('sha384').update(content).digest('hex');
const requestId = crypto.randomBytes(18).toString('hex');
// AES-256-GCM:
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
```
**Fallback:** chame `common.escapeHtml`, `common.format` etc. (vide [`core/14-common-utils.md`](core/14-common-utils.md)).
**Localização no código:** [`plugins/printercontrol/02-server.md:133`](plugins/printercontrol/02-server.md) (requestId), [`plugins/scripttask/db.js:40`](plugins/scripttask/db.js) (sha384).
**Backend support:** N/A.

### "Como acesso o node_modules (NeDB)?"
**Mais nativo:** copie o que MeshCentral tem:
- `@seald-io/nedb` (NeDB)
- `express`
- `ws`
- `yauzl`

Use `require('@seald-io/nedb')` etc. diretamente — eles estão disponíveis porque MeshCentral é a dependência.
**Fallback:** bundle local (como `nemongo.js` em scripttask — vide [`core/15-package-deps.md:81`](core/15-package-deps.md)).
**Localização no código:** [`core/15-package-deps.md`](core/15-package-deps.md), [`plugins/scripttask/db.js:14`](plugins/scripttask/db.js) (nemongo local).
**Backend support:** N/A.