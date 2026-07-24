# MeshCentral Plugin Development Guide

> **Documento técnico completo** — baseado na análise de 12 plugins da comunidade
> e no desenvolvimento do plugin User-Device Tracer v3.x para MeshCentral v1.2.4.

---

## Sumário

1. [Arquitetura e Cadeia de Objetos](#1-arquitetura-e-cadeia-de-objetos)
2. [Estrutura do Plugin](#2-estrutura-do-plugin)
3. [config.json](#3-configjson)
4. [Server-Side: hooks e funções](#4-server-side-hooks-e-funções)
5. [Banco de Dados: db.Get / db.Set](#5-banco-de-dados)
6. [WebSocket: comunicação frontend ↔ server](#6-websocket-comunicação-frontend--server)
7. [Frontend: templates e handlers](#7-frontend-templates-e-handlers)
8. [Agent-Side: modules_meshcore](#8-agent-side-modules_meshcore)
9. [Obtendo Dados Específicos](#9-obtendo-dados-específicos)
10. [Debug e Diagnóstico](#10-debug-e-diagnóstico)
11. [Erros Comuns e Soluções](#11-erros-comuns-e-soluções)
12. [Exemplo Completo: User-Device Tracer](#12-exemplo-completo-user-device-tracer)

---

## 1. Arquitetura e Cadeia de Objetos

### Hierarquia de Objetos

```
plugin (this)                   = module.exports.nome(parent)
  .parent                       = pluginHandler (pluginHandler.js)
  .parent.parent                = meshServer (meshserver.js / meshcentral.js)
  .parent.parent.webserver      = webserver.js (Express + WebSocket)
  .parent.parent.db             = banco de dados (NeDB / MongoDB)
  .parent.parent.pluginHandler  = pluginHandler (referência circular)
  .parent.parent.args           = argumentos de linha de comando
  .parent.parent.config         = configuração do MeshCentral
```

### ⚠️ O que NÃO existe (erro comum)

| Código | Resultado |
|--------|-----------|
| `meshServer.parent` | **undefined** — não existe no contexto do plugin |
| `meshServer.parent.agents` | **TypeError** — `meshServer.parent` é undefined |
| `meshServer.parent.parent` | **TypeError** — `meshServer.parent` é undefined |
| `parent.parent.parent` | **undefined** — não existe |

### Propriedades do meshServer

Acessíveis via `obj.meshServer.*`:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `webserver` | object | Servidor HTTP/WebSocket (Express) |
| `webserver.wsagents` | object | `{ nodeId → WebSocket }` — agentes conectados |
| `webserver.wssessions2` | object | `{ sessionId → WebSocket }` — sessões frontend |
| `db` | object | Banco de dados (NeDB/MongoDB) |
| `db.Get(key, callback)` | function | Busca documento por ID |
| `db.Set(doc)` | function | Salva documento |
| `parent` | object | Aplicação principal |
| `parentpath` | string | Path do node_modules (ex: `require('path').join(meshserver.parentpath, 'node_modules')`) |
| `args` | object | Argumentos do servidor |
| `config` | object | Configuração do MeshCentral |
| `debug(module, msg)` | function | Log de debug |
| `DispatchEvent(targets, src, msg)` | function | Broadcast para frontends |
| `encodeCookie(data, key)` | function | Codificar cookie |
| `decodeCookie(data, key, expire)` | function | Decodificar cookie |

---

## 2. Estrutura do Plugin

```
plugin_name/
├── config.json                        # Metadados (OBRIGATÓRIO)
├── plugin_name.js                     # Server-side (OBRIGATÓRIO)
├── modules_meshcore/                  # Opcional — código que roda no agente
│   └── plugin_name.js                 #   → incluído no meshcore
├── views/                             # Opcional — templates Handlebars
│   ├── admin.handlebars               #   Painel admin (hasAdminPanel: true)
│   └── device.handlebars              #   Aba do dispositivo
├── db.js                              # Opcional — módulo de banco de dados
├── admin.js                           # Opcional — lógica do admin separada
└── changelog.md                       # Recomendado
```

### Arquivo JS principal

Deve ter o **mesmo nome** do `shortName` no config.json.

```javascript
// plugin_name.js
"use strict";
module.exports.shortName = function (parent) {
    var obj = {};
    obj.parent = parent;                              // pluginHandler
    obj.meshServer = parent.parent;                   // meshServer
    obj.debug = obj.meshServer.debug;                 // função de debug
    obj.db = obj.meshServer.db;                       // banco de dados

    obj.exports = ['onDeviceRefreshEnd'];              // funções exportadas ao frontend

    // --- Hooks e handlers ---

    obj.server_startup = function () { /* init */ };
    obj.serveraction = function (command, myparent, gp) { /* msgs */ };
    obj.handleAdminReq = function (req, res, user) { /* HTTP */ };

    return obj;
};
```

---

## 3. config.json

### Campos Obrigatórios

| Campo | Tipo | Exemplo |
|-------|------|---------|
| `name` | string | `"User-Device Tracer"` |
| `shortName` | string | `"usertracer"` (nome do arquivo .js) |
| `version` | string | `"3.0.0"` (semver) |
| `description` | string | Descrição do plugin |
| `hasAdminPanel` | boolean | `true` se tem painel admin |
| `homepage` | string | URL do repositório |
| `changelogUrl` | string | URL raw do changelog |
| `configUrl` | string | URL raw deste config.json |
| `downloadUrl` | string | URL do ZIP (`archive/master.zip`) |
| `repository` | object | `{ type: "git", url: "..." }` |
| `meshCentralCompat` | string | `">=1.0.0"` |

### Validação (pluginHandler.js:isValidConfig)

O MeshCentral valida o JSON ao baixar o plugin. Se falhar, retorna:
```
"Error getting plugin config. Check that you have valid JSON."
```

---

## 4. Server-Side: hooks e funções

### server_startup()

```javascript
obj.server_startup = function () {
    // Chamado quando o servidor inicia OU plugin é recarregado
    // Uso: inicializar DB, timers, registrar callbacks periódicos
    obj.intervalTimer = setInterval(obj.tick, 60000);
};
```

### hook_agentCoreIsStable(myparent, gp)

```javascript
obj.hook_agentCoreIsStable = function (myparent, gp) {
    // myparent = wsagents[nodeid] (conexão WebSocket do agente)
    // gp = meshServer
    // Chamado quando um agente estabelece conexão estável
    
    var nodeid = myparent ? myparent.nodeid : null;
    // NÃO existe myparent.parent, myparent.parent.parent
};
```

### hook_processAgentData(data, nodeid)

```javascript
obj.hook_processAgentData = function (data, nodeid) {
    // data: mensagem completa enviada pelo agente
    // nodeid: ID do nó (string)
    // Chamado a cada dado que o agente envia ao servidor
};
```

### serveraction(command, myparent, grandparent)

**Ponto de entrada único para mensagens via WebSocket**, tanto do frontend quanto do agente.

```javascript
obj.serveraction = function (command, myparent, gp) {
    if (command.plugin !== 'shortName') return;

    // Extrair sessionId (apenas para msgs do frontend)
    var sessionid = null;
    try { sessionid = myparent.ws.sessionId; } catch (e) {
        // se falhar, a msg veio do agente (não tem sessão web)
    }

    // Extrair nodeid (apenas para msgs do agente)
    var nodeid = command.nodeid || (myparent ? myparent.nodeid : null);

    switch (command.pluginaction) {
        case 'acaoFrontend':
            obj.handleFrontend(command, sessionid);
            break;
        case 'acaoAgente':
            obj.handleAgent(command, nodeid);
            break;
    }
};
```

#### Input (command) via frontend:
```json
{
  "action": "plugin",
  "plugin": "shortName",
  "pluginaction": "getCurrentUsers"
}
```

#### Input (command) via agente:
```json
{
  "action": "plugin",
  "plugin": "shortName",
  "pluginaction": "sessionEvents",
  "nodeid": "node//xxx",
  "events": "[...]"
}
```

#### Output (resposta ao frontend):
```javascript
// Enviar resposta para uma sessão específica
obj.meshServer.webserver.wssessions2[sessionid].send(JSON.stringify({
    action: 'plugin',
    plugin: 'shortName',
    method: 'callbackName',       // ← nome da função no frontend
    data: result                  // ← qualquer dado serializável
}));
```

### handleAdminReq(req, res, user)

```javascript
obj.handleAdminReq = function (req, res, user) {
    // req: Express Request
    //   req.query.pin     = "shortName"
    //   req.query.user    = "1" (se for aba do dispositivo)
    //   req.query.nodeid  = ID do nó (se for aba do dispositivo)
    // res: Express Response
    // user: objeto do usuário logado
    //   user._id         = "user//domain/id"
    //   user.name        = "nome.usuario"
    //   user.siteadmin   = 4294967295 (admin) | 0 (comum) | undefined

    // Aba do dispositivo (iframe):
    if (req.query.user == 1) {
        res.render('device', { nodeid: req.query.nodeid, nodeName: '...' });
        return;
    }

    // Painel admin:
    if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
    res.render('admin', {});
};
```

### onDeviceRefreshEnd(nodeid, panel, refresh, event)

Executado no **frontend** (navegador). Exportado via `exports[]`.

```javascript
// No server-side:
obj.exports = ['onDeviceRefreshEnd'];

// Esta função é SERIALIZADA e enviada ao frontend.
// No frontend ela roda como:
//   pluginHandler.shortName.onDeviceRefreshEnd(nodeid, panel, refresh, event)
obj.onDeviceRefreshEnd = function (nodeid, panel, refresh, event) {
    if (typeof currentNode === 'undefined' || !currentNode) return;
    pluginHandler.registerPluginTab({
        tabTitle: 'Minha Aba',
        tabId: 'pluginMinhaAba'
    });
    QA('pluginMinhaAba', '<iframe src="/pluginadmin.ashx?pin=shortName&nodeid=' +
        encodeURIComponent(currentNode._id) + '&user=1" />');
};
```

---

## 5. Banco de Dados

### db.Get(key, callback)

```javascript
// Entrada:
//   key: string — ID do documento (ex: "node//domain/id")
//   callback: function(err, docs) — docs é array

// Exemplo:
obj.meshServer.db.Get('node//' + domainId + '/' + nodeId, function(err, docs) {
    if (err || !docs || docs.length === 0) return;
    var doc = docs[0];
    // doc = { _id, name, users, lusers, upnusers, domain, meshid, ... }
});
```

### Estrutura do Documento de Nó (node)

```javascript
{
    _id: "node//BKSSERVICES/7pnmr09mJ88uYaX5G5...",  // ID completo no DB
    name: "BR-25005",                                  // Nome do dispositivo
    domain: "",                                        // Domínio (vazio = default)
    meshid: "mesh//gYpSssggj4WflygNHtv7KDH...",       // ID do grupo
    mtype: 2,                                          // Tipo (2 = windows)
    host: "BR-25005",                                  // Hostname
    icon: 1,                                           // Ícone
    osdesc: "Windows 10 Pro",                           // Descrição do SO
    ip: "26.74.237.68",                                // Último IP
    users: ["BKSSERVICES\\misael.filho"],              // ← USUÁRIOS ATIVOS
    lusers: [],                                        // Usuários com status (bloqueado)
    upnusers: ["misael.filho@BKSSERVICES.com"],        // Formato UPN
    firstconnect: 1721149200,                          // Timestamp
    lastbootuptime: 1721149200,                        // Último boot
    idletime: 300,                                     // Tempo ocioso (segundos)
    wsc: 1,                                            // Windows Security Center
    av: "Windows Defender",                            // Antivírus
    defender: true,                                    // Defender ativo
    agent: "1.2.4",                                    // Versão do agente
    type: "node"
}
```

### db.Set(doc)

```javascript
// Salvar/atualizar documento
obj.meshServer.db.Set({
    _id: 'node//domain/id',
    name: 'NovoNome',
    users: ['DOMAIN\\user']
    // ...outros campos
});
```

### NeDB vs MongoDB

Plugins devem suportar ambos. O padrão é verificar `meshServer.args.mongodb`:

```javascript
if (meshServer.args.mongodb) {
    // Usa MongoDB
    var mongodb = require('mongodb');
    // ...
} else {
    // Usa NeDB (padrão)
    var Datastore = require('nedb'); // ou @seald-io/nedb, @yetzt/nedb
    var db = new Datastore({ filename: 'plugin.db', autoload: true });
}
```

---

## 6. WebSocket: comunicação frontend ↔ server

### Fluxo Completo

```
┌─ Frontend (iframe/página) ──────────────────────┐
│                                                   │
│  const ms = parent.meshserver || window.meshserver │
│  ms.send({                                       │
│    action: 'plugin',                             │
│    plugin: 'shortName',                          │
│    pluginaction: 'getUsers'                      │
│  })                                              │
│         │                                        │
│         ▼ (WebSocket)                            │
│  ┌─────────────────────────────────┐            │
│  │ MeshCentral server              │            │
│  │  serveraction(command, myparent)│            │
│  │    myparent.ws.sessionId → sid  │            │
│  │    processa comando             │            │
│  │    wssessions2[sid].send({      │            │
│  │      action: 'plugin',          │            │
│  │      plugin: 'shortName',       │            │
│  │      method: 'callbackName',    │            │
│  │      data: [...]                │            │
│  │    })                          │            │
│  └─────────────────────────────────┘            │
│         │                                        │
│         ▼ (WebSocket resposta)                   │
│  RAW socket recebe:                              │
│    {"action":"plugin","plugin":"shortName",      │
│     "method":"callbackName","data":[...]}        │
│                                                  │
│  ⚠️ O MeshCentral framework processa esta        │
│  mensagem antes do pluginHandler. O método       │
│  CORRETO de capturar é hook no socket.onmessage: │
│                                                  │
│  ms.socket.onmessage = function(event) {         │
│    var d = JSON.parse(event.data);               │
│    if (d.action === 'plugin' &&                  │
│        d.plugin === 'shortName') {               │
│      // processar d.data                         │
│    }                                              │
│  }                                               │
└───────────────────────────────────────────────────┘
```

### ⚠️ Problema Conhecido: pluginHandler NÃO funciona para respostas

O MeshCentral chama handlers do `pluginHandler[plugin][method]()` com o **próprio objeto `meshserver`** durante a inicialização, não com a resposta do servidor. Portanto:

```javascript
// ❌ NÃO CONFIE NISSO:
parent.pluginHandler.shortName.callbackName = function(msg) {
    // msg pode ser o objeto meshserver, não a resposta!
};

// ✅ USE O SOCKET DIRETO:
ms.socket.onmessage = function(event) {
    var msg = JSON.parse(event.data);
    if (msg.action === 'plugin' && msg.plugin === 'shortName') {
        // msg.data é a resposta real
    }
};
```

### Formato das Mensagens

#### Frontend → Server (request):
```json
{
  "action": "plugin",
  "plugin": "shortName",
  "pluginaction": "commandName",
  "nodeid": "node//xxx",
  "limit": 200,
  "outrosParametros": "..."
}
```

#### Server → Frontend (response):
```json
{
  "action": "plugin",
  "plugin": "shortName",
  "method": "callbackName",
  "data": [{ ... }, { ... }]
}
```

### sendToSession — Helper

```javascript
obj.send = function (sessionid, data) {
    try {
        if (obj.meshServer.webserver.wssessions2 &&
            obj.meshServer.webserver.wssessions2[sessionid]) {
            obj.meshServer.webserver.wssessions2[sessionid]
                .send(JSON.stringify(data));
        }
    } catch (e) {}
};
```

### Broadcast para TODOS os frontends (DispatchEvent)

```javascript
obj.meshServer.DispatchEvent(
    ['*', 'server-users'],   // targets
    obj,                      // source
    {                         // mensagem
        nolog: true,
        action: 'plugin',
        plugin: 'shortName',
        pluginaction: 'broadcastData',
        data: { ... }
    }
);
```

### Comando para Agente

```javascript
// Server → Agent
if (obj.meshServer.webserver.wsagents[nodeid]) {
    obj.meshServer.webserver.wsagents[nodeid].send(JSON.stringify({
        action: 'plugin',
        plugin: 'shortName',
        pluginaction: 'commandName',
        data: { ... }
    }));
}
```

---

## 7. Frontend: templates e handlers

### Template Engine: Handlebars

MeshCentral usa **Handlebars** (`.handlebars`), **não EJS**.

```
res.render('admin', {})      →  views/admin.handlebars
res.render('device', vars)   →  views/device.handlebars
```

### Injeção de Variáveis

```handlebars
// device.handlebars — servidor injeta:
// res.render('device', { nodeid: '...', nodeName: '...' })

<h2>{{nodeName}}</h2>
<script>
var nodeid = '{{nodeid}}';   // ← escapado por segurança
</script>
```

### meshserver: disponível via parent

```javascript
// No iframe (admin panel, device tab):
var ms = (typeof parent !== 'undefined' && parent.meshserver)
       ? parent.meshserver
       : (window.meshserver || null);

// Propriedades do meshserver frontend:
//   ms.State          — estado da conexão (2 = conectado)
//   ms.connectstate   — estado (1 = conectado)
//   ms.send(pkt)      — enviar comando ao servidor
//   ms.socket         — WebSocket REAL (RAW)
//   ms.onMessage      — callback do framework (NÃO USE para action:'plugin')
```

### Capturando Resposta do Servidor (funcional)

```javascript
// ✅ MÉTODO CORRETO: hook no WebSocket real
if (ms && ms.socket) {
    var origOnMsg = ms.socket.onmessage;
    ms.socket.onmessage = function(event) {
        try {
            var d = JSON.parse(event.data);
            // d = { action, plugin, method, data, ... }
            // O framework MeshCentral NÃO altera o dado cru do socket
            // action = "plugin" | "event" | "serverstats" | etc
            if (d.action === 'plugin' && d.plugin === 'shortName' && d.method === 'callbackName') {
                renderTable(d.data || []);
                return; // consumimos a msg, não encaminha
            }
        } catch(e) {}
        if (typeof origOnMsg === 'function') origOnMsg.call(ms.socket, event);
    };
}

// ❌ NÃO FUNCIONA: pluginHandler é chamado com meshserver object
pluginHandler.shortName.callbackName = function(msg) {
    // msg === meshserver object (╯°□°)╯︵ ┻━┻
};
```

### Handler via pluginHandler (funciona com filtro)

```javascript
// Funciona se filtrar o meshserver object:
t.callbackName = function(msg) {
    // MeshCentral chama este handler com o meshserver object durante init
    if (msg && msg.State !== undefined) {
        return; // IGNORAR — é o meshserver object
    }
    var data = (msg && msg.data) ? msg.data : (Array.isArray(msg) ? msg : []);
    processar(data);
};
```

---

## 8. Agent-Side: modules_meshcore

### Estrutura

```javascript
// modules_meshcore/plugin_name.js
"use strict";
var mesh = null;
var debug_flag = false;

// Debug function (EventLog/ScriptTask pattern)
var dbg = function(str) {
    if (debug_flag !== true) return;
    try {
        var fs = require('fs');
        var logStream = fs.createWriteStream('plugin_name.txt', { flags: 'a' });
        logStream.write('\n' + new Date().toLocaleString() + ': ' + str);
        logStream.end('\n');
    } catch (e) {}
};

// Entry point — chamado quando servidor envia comando
function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;  // MeshAgent com SendCommand()
    switch (args.pluginaction) {
        case 'start': start(); break;
        case 'setDebug': debug_flag = (args.value === 'true'); break;
    }
    return 'OK';
}

// Auto-start na inicialização do agente
if (typeof setInterval !== 'undefined') {
    setTimeout(function () {
        if (process.platform === 'win32') {
            try { mesh = require('MeshAgent'); start(); } catch (e) {}
        }
    }, 5000);
}
```

### Classificação por Plataforma

| Prefixo | Plataforma |
|---------|-----------|
| `win-` | Windows (com e sem AMT) |
| `linux-` | Linux (com e sem AMT) |
| `amt-` | Intel AMT |
| (sem prefixo) | Todas |

### Enviar dados ao servidor

```javascript
mesh.SendCommand({
    action: 'plugin',
    plugin: 'shortName',
    pluginaction: 'eventData',
    nodeid: (mesh.info && mesh.info._id) ? mesh.info._id : null,  // IMPORTANTE!
    events: JSON.stringify(events)
});
```

---

## 9. Obtendo Dados Específicos

### Agentes Conectados

```javascript
// Server-side:
var ws = obj.meshServer.webserver.wsagents || {};
// ws = { "node//xxx": WebSocket, "node//yyy": WebSocket, ... }

for (var nodeid in ws) {
    var agent = ws[nodeid];
    agent.nodeid;                          // ID do nó
    agent.name;                            // Nome do dispositivo
    agent.agentInfo.computerName;           // Nome do computador
    agent.agentInfo.agentVersion;           // Versão do agente
    agent.agentInfo.platformType;           // 2 = Windows
    agent.remoteaddr;                       // IP
    agent.connectTime;                      // Timestamp de conexão
    agent.domain;                           // Domínio
    agent.meshid;                           // ID do grupo
    agent.authenticated;                    // 1 = autenticado
    agent.dbNodeKey;                        // "node/domain/nodeid"
    agent.dbMeshKey;                        // "mesh/domain/meshid"
    agent.send(JSON.stringify(msg));        // Enviar comando
}
```

### Usuários Ativos de Cada Dispositivo

```javascript
// ESTES DADOS ESTÃO NO BANCO, não no WebSocket do agente!
obj.meshServer.db.Get(nodeid, function(err, docs) {
    if (!err && docs && docs.length > 0) {
        var doc = docs[0];
        doc.users;      // ["DOMAIN\username"] — usuários ativos
        doc.lusers;     // mesma lista com status de bloqueio
        doc.upnusers;   // formato user@domain
    }
});
```

### Nome do Dispositivo

```javascript
// Fonte 1: WebSocket do agente
obj.meshServer.webserver.wsagents[nodeid].name;
obj.meshServer.webserver.wsagents[nodeid].agentInfo.computerName;

// Fonte 2: Banco de dados
obj.meshServer.db.Get(nodeid, function(err, docs) {
    if (docs) docs[0].name;
});
```

### Session ID do Frontend

```javascript
// Dentro do serveraction:
obj.serveraction = function(command, myparent, gp) {
    var sessionid = null;
    try { sessionid = myparent.ws.sessionId; } catch (e) {}
    // sessionid = "user//domain/userid/randomhash"
};
```

### Sessões de Frontend Conectadas

```javascript
var sessions = obj.meshServer.webserver.wssessions2 || {};
// sessions = { "user//domain/id/hash": WebSocket, ... }
// Para enviar resposta:
if (sessions[sessionid]) {
    sessions[sessionid].send(JSON.stringify({ action: 'plugin', ... }));
}
```

### Propriedades do Documento de Nó (DB)

```javascript
obj.meshServer.db.Get(nodeid, function(err, docs) {
    if (!docs || !docs.length) return;
    var d = docs[0];
    // d._id             = "node//domain/nodeid"     ← chave primária
    // d.name            = "BR-25005"                ← nome do dispositivo
    // d.domain          = ""                        ← domínio
    // d.meshid          = "mesh//domain/meshid"     ← grupo
    // d.host            = "BR-25005"                ← hostname
    // d.ip              = "192.168.0.100"           ← último IP
    // d.osdesc          = "Windows 10 Pro"          ← sistema operacional
    // d.mtype           = 2                         ← 2=Windows, 1=Linux
    // d.users           = ["DOMAIN\\user"]          ← USUÁRIOS ATIVOS
    // d.lusers          = [...]                     ← com status
    // d.upnusers        = [...]                     ← formato UPN
    // d.agent           = "1.2.4"                   ← versão do agente
    // d.av              = "Windows Defender"        ← antivírus
    // d.icon            = 1                         ← tipo de ícone
    // d.firstconnect    = 1721149200                ← timestamp
    // d.lastbootuptime  = 1721149200                ← último boot
    // d.wsc             = 1                         ← Windows Security Center
    // d.idletime        = 300                       ← segundos ocioso
});
```

### Informações do Usuário MeshCentral

```javascript
// hook_userLoggedIn:
obj.hook_userLoggedIn = function(user) {
    user._id;       // "user//domain/username"
    user.name;      // "nome.usuario"
    user.siteadmin; // 0xFFFFFFFF = admin, 0 = comum
    user.email;     // email do usuário
    user.domain;    // domínio
    user.realname;  // nome real
    user.links;     // permissões { meshId: { rights } }
};
```

---

## 10. Debug e Diagnóstico

### Server-Side (console.log)

```javascript
// Adicione NO TOPO das funções:
console.log('[PLUGIN] serveraction: action=' + command.pluginaction + ' sid=' + sessionid);
console.log('[PLUGIN] db.Get callback: err=' + (err ? err.message : 'null') + ' docs=' + (docs ? docs.length : 0));
console.log('[PLUGIN] send: ' + data.method + ' data.length=' + (data.data ? data.data.length : 0));
console.log('[PLUGIN] handleAdminReq: user=' + (user ? user.name : 'null') + ' query=' + JSON.stringify(req.query));
```

### Frontend (collapsible debug panel)

```html
<div id="dbgToggle" onclick="toggleDebug()">🔽 Debug</div>
<div id="debug" style="display:none;font-size:10px;font-family:monospace;max-height:200px;overflow:auto"></div>
<script>
var D = [];
function dlog() {
    var args = Array.prototype.slice.call(arguments);
    D.push(new Date().toLocaleTimeString() + ' ' + args.join(' '));
    document.getElementById('debug').innerHTML = D.join('\n');
    console.log('[PLUGIN]', args.join(' '));
}
function toggleDebug() {
    var el = document.getElementById('debug');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
</script>
```

### Full WebSocket Trace (frontend)

```javascript
// Hook no WebSocket REAL para ver TODAS as mensagens
if (ms && ms.socket) {
    var orig = ms.socket.onmessage;
    ms.socket.onmessage = function(event) {
        try {
            var raw = event.data;
            dlog('WS RAW: len=' + raw.length + ' data=' + raw.substring(0, 500));
            var parsed = JSON.parse(raw);
            dlog('WS PARSE: action=' + parsed.action + ' plugin=' + parsed.plugin + ' method=' + parsed.method);
        } catch(e) {}
        if (typeof orig === 'function') orig.call(ms.socket, event);
    };
}
```

### Agent-Side (arquivo)

```javascript
var debug_flag = false; // ativar via comando 'setDebug'
var dbg = function(str) {
    if (debug_flag !== true) return;
    try {
        var fs = require('fs');
        var logStream = fs.createWriteStream('plugin.txt', { flags: 'a' });
        logStream.write('\n' + new Date().toLocaleString() + ': ' + str);
        logStream.end('\n');
    } catch (e) {}
};
```

---

## 11. Erros Comuns e Soluções

| Erro | Causa | Solução |
|------|-------|---------|
| **401 no admin panel** | Plugin não carregou em `obj.plugins` | Verificar console do servidor: "Error loading plugin" |
| `Cannot read properties of undefined (reading 'agents')` | `meshServer.parent` não existe | Use `meshServer.webserver.wsagents` |
| `module 'nedb' not found` | NeDB não está disponível no MeshCentral v1.2.4 | Use cadeia de fallback: `@seald-io/nedb` → `@yetzt/nedb` → `nedb` |
| `Failed to lookup view` | Template não encontrado OU extensão errada | Use `.handlebars`, NÃO `.ejs`. `res.render('nome')` sem path |
| `pluginHandler.handler é chamado com meshserver object` | MeshCentral chama handlers do plugin com o meshserver | Hook direto no `ms.socket.onmessage` |
| Resposta WebSocket nunca chega ao handler | `ms.onMessage` recebe msgs já processadas (sem action/plugin) | Use `ms.socket.onmessage` (RAW) |
| Contagem `pending` nunca zera | Um callback `db.Get` nunca retorna | Use timeout ou verifique se todos os agentes estão no DB |
| Admin panel mostra "Nenhum usuário ativo" | DB query retornou vazio OU handler não processou | Verificar serveraction e socket.onmessage |
| Plugin carrega mas serveraction não é chamado | Comando não chega via WebSocket | Verificar `ms.send` e `ms.socket.readyState` |
| `SyntaxError: Unexpected token '}'` | Bloco duplicado no JS | Lint com `node -e "new Function(require('fs').readFileSync('file.js','utf8'))"` |
| `EPERM: operation not permitted` | Arquivo do plugin com permissão travada | Deletar manualmente como Administrador |

---

## 12. Exemplo Completo: User-Device Tracer

### O que faz

Lê os usuários ativos de cada dispositivo conectado ao MeshCentral
e exibe em uma tabela no admin panel e na aba do dispositivo.

### Arquitetura

```
Usuário abre admin panel → HTML/JS envia comando via WebSocket
  → serveraction(getCurrentUsers) → db.Get(nodeId) para cada agente
  → extrai doc.users → envia resposta via WebSocket
  → socket.onmessage captura → renderTable() atualiza DOM
```

### Server-Side (usertracer.js)

```javascript
"use strict";
module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.db = obj.meshServer.db;

    obj.handleAdminReq = function (req, res, user) {
        if (req.query.user == 1) {
            return res.render('device', {
                nodeid: req.query.nodeid || '',
                nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown'
            });
        }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    obj.serveraction = function (command, myparent, gp) {
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        if (!sid || !obj.db || typeof obj.db.Get !== 'function') return;

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            var ws = obj.meshServer.webserver.wsagents || {};
            var ids = Object.keys(ws);
            if (ids.length === 0) { obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result }); return; }

            var pending = ids.length;
            ids.forEach(function (nid) {
                obj.db.Get(nid, function (err, docs) {
                    if (!err && docs && docs.length > 0) {
                        var d = docs[0];
                        if (Array.isArray(d.users) && d.users.length > 0) {
                            result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                        }
                    }
                    pending--;
                    if (pending <= 0) {
                        obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result });
                    }
                });
            });
        }
    };

    obj.getNodeName = function (nid) {
        try { return obj.meshServer.webserver.wsagents[nid].name || nid; } catch (e) { return nid; }
    };

    obj.send = function (sid, data) {
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid])
                obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data));
        } catch (e) {}
    };

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;
        pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
        QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
    };

    return obj;
};
```

### Frontend (admin.handlebars) — Esqueleto

```html
<div id="dbgToggle" onclick="toggleDebug()">🔽 Debug</div>
<div id="debug"></div>
<table><thead><tr><th>Dispositivo</th><th>Usuário</th><th>Domínio</th></tr></thead>
<tbody id="tbody"><tr><td colspan="3">Carregando...</td></tr></tbody></table>

<script>
var ms = parent.meshserver || window.meshserver;

// Hook no socket real para capturar resposta
if (ms && ms.socket) {
    var orig = ms.socket.onmessage;
    ms.socket.onmessage = function(event) {
        var d = JSON.parse(event.data);
        if (d.action === 'plugin' && d.plugin === 'usertracer' && d.method === 'currentUsers') {
            renderTable(d.data || []);
            return;
        }
        if (typeof orig === 'function') orig.call(ms.socket, event);
    };
}

function renderTable(data) {
    var h = '';
    for (var i = 0; i < data.length; i++) {
        (data[i].users || []).forEach(function(u) {
            var parts = u.split('\\');
            var dom = parts.length > 1 ? parts[0] : '';
            var usr = parts.length > 1 ? parts[1] : u;
            h += '<tr><td>' + data[i].nodeName + '</td><td>' + usr + '</td><td>' + dom + '</td></tr>';
        });
    }
    document.getElementById('tbody').innerHTML = h;
}

ms.send({ action: 'plugin', plugin: 'usertracer', pluginaction: 'getCurrentUsers' });
</script>
```

---

> **Documento gerado em 23/07/2026** baseado na análise de 12 plugins reais
> (ScriptTask, EventLog, RegEdit, RoutePlus, FileDistribution, WorkFromHome,
> DevTools, Sample, PluginHookScheduler, Agentname2Servername, PrinterControl,
> PluginHookExample) + código-fonte do `pluginHandler.js` + desenvolvimento
> do plugin User-Device Tracer v3.x para MeshCentral v1.2.4.
