# MeshCentral Plugin Development Guide

> **Documento técnico completo** — baseado na análise de 12 plugins da comunidade,
> código-fonte do `pluginHandler.js`, e debug ao vivo do plugin User-Device Tracer v3.2
> rodando em MeshCentral v1.2.4 com 10 agentes Windows conectados.

---

## Sumário

1. [Arquitetura e Cadeia de Objetos](#1-arquitetura-e-cadeia-de-objetos)
2. [Estrutura do Plugin](#2-estrutura-do-plugin)
3. [config.json](#3-configjson)
4. [Server-Side: hooks e funções](#4-server-side-hooks-e-funções)
5. [Banco de Dados](#5-banco-de-dados)
6. [WebSocket: comunicação frontend ↔ server](#6-websocket-comunicação-frontend--server)
7. [Frontend: templates e handlers](#7-frontend-templates-e-handlers)
8. [Agent-Side: modules_meshcore](#8-agent-side-modules_meshcore)
9. [Obtendo Dados Específicos](#9-obtendo-dados-específicos)
10. [Debug e Diagnóstico](#10-debug-e-diagnóstico)
11. [Erros Comuns e Soluções](#11-erros-comuns-e-soluções)
12. [Exemplo Completo: User-Device Tracer](#12-exemplo-completo-user-device-tracer)

---

## 1. Arquitetura e Cadeia de Objetos

### Hierarquia

```
plugin (this)                   = module.exports.nome(parent)
  .parent                       = pluginHandler (pluginHandler.js)
  .parent.parent                = meshServer (meshcentral.js / meshserver.js)
  .parent.parent.webserver      = webserver.js (Express + WebSocket)
    .wsagents                   = { nodeId → WebSocket } — agentes (10 keys no debug)
    .wssessions2               = { sessionId → WebSocket } — frontends (1 key no debug)
  .parent.parent.db             = banco de dados (NeDB / MongoDB)
    .Get(key, fn)               = busca documento por ID (~26ms no debug)
  .parent.parent.pluginHandler = pluginHandler (referência circular)
  .parent.parent.args           = argumentos de linha de comando
  .parent.parent.config         = configuração do MeshCentral
```

### ⚠️ O que NÃO existe

| Código | Resultado |
|--------|-----------|
| `meshServer.parent` | **undefined** |
| `meshServer.parent.agents` | **TypeError** |
| `meshServer.parent.parent` | **TypeError** |
| `parent.parent.parent` | **undefined** |

### Propriedades do meshServer (confirmadas via debug)

```javascript
obj.meshServer.webserver.wsagents      // 10 keys (agentes conectados)
obj.meshServer.webserver.wssessions2   // 1 key (sessão admin logada)
obj.meshServer.db.Get                  // function — callback ~26ms
obj.meshServer.getConfigFilePath       // function — path do arquivo DB
obj.meshServer.pluginHandler           // referência ao pluginHandler
obj.meshServer.args                    // argumentos do servidor
obj.meshServer.config                  // config do MeshCentral
obj.meshServer.parentpath              // path do node_modules
```

---

## 2. Estrutura do Plugin

```
plugin_name/
├── config.json                        # Metadados (OBRIGATÓRIO)
├── plugin_name.js                     # Server-side (OBRIGATÓRIO)
├── db.js                              # Módulo de banco (opcional, recomendado)
├── modules_meshcore/                  # Opcional — código do agente
│   └── plugin_name.js                 #   → incluído no meshcore
├── views/                             # Opcional — templates
│   ├── admin.handlebars               #   Painel admin (hasAdminPanel: true)
│   └── device.handlebars              #   Aba do dispositivo
└── changelog.md
```

### Plugin JS principal

```javascript
"use strict";
module.exports.shortName = function (parent) {
    var obj = {};
    obj.parent = parent;                              // pluginHandler
    obj.meshServer = parent.parent;                   // meshServer
    obj.debug = obj.meshServer.debug;
    obj.db = obj.meshServer.db;                       // MeshCentral DB
    obj.exports = ['onDeviceRefreshEnd'];

    obj.server_startup = function () {
        // Init DB próprio do plugin
        obj.meshServer.pluginHandler.shortname_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.shortname_db;
    };

    obj.hook_agentCoreIsStable = function (myparent, gp) { /* agente conectou */ };
    obj.hook_processAgentData = function (data, nodeid) { /* dados do agente */ };
    obj.serveraction = function (command, myparent, gp) { /* msgs WS */ };
    obj.handleAdminReq = function (req, res, user) { /* HTTP */ };
    obj.onDeviceRefreshEnd = function () { /* frontend - aba */ };

    return obj;
};
```

---

## 3. config.json

### Campos e validação

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `name` | string | sim |
| `shortName` | string | sim (nome do .js) |
| `version` | string | sim (semver) |
| `author` | string | não |
| `description` | string | sim |
| `hasAdminPanel` | boolean | sim |
| `homepage` | string | sim |
| `changelogUrl` | string | sim |
| `configUrl` | string | sim (raw config.json) |
| `downloadUrl` | string | sim (git → ZIP) |
| `repository.type` | string | sim ("git") |
| `repository.url` | string | sim |
| `versionHistoryUrl` | string | não |
| `meshCentralCompat` | string | sim (">=1.0.0") |

Erro se inválido: `"Error getting plugin config. Check that you have valid JSON."`

---

## 4. Server-Side: hooks e funções

### server_startup()

```javascript
obj.server_startup = function () {
    // Chamado quando servidor inicia OU plugin recarregado
    // Uso: init DB, timers, scanners periódicos
    obj.meshServer.pluginHandler.shortname_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
    obj.db = obj.meshServer.pluginHandler.shortname_db;
    obj.startScanner();
};
```

### hook_agentCoreIsStable(myparent, gp)

Disparado quando um agente estabelece conexão estável.

```javascript
obj.hook_agentCoreIsStable = function (myparent, gp) {
    // myparent.nodeid          = ID do nó
    // myparent.agentInfo       = { computerName, agentVersion, platformType, ... }
    // myparent.name            = nome do dispositivo
    // myparent.dbNodeKey       = "node/domain/nodeid"
    // myparent.dbMeshKey       = "mesh/domain/meshid"
    // myparent.domain          = domínio
    // myparent.remoteaddr      = IP
    // myparent.connectTime     = timestamp
    // myparent.authenticated   = 1
    // gp = meshServer
};
```

### hook_processAgentData(data, nodeid)

Disparado quando o agente envia dados ao servidor.

```javascript
obj.hook_processAgentData = function (data, nodeid) {
    // data.action    = "plugin" | "event" | etc
    // data.plugin    = "usertracer" (se for do plugin)
    // nodeid         = "node//domain/id"
};
```

### serveraction(command, myparent, grandparent)

**Ponto de entrada único para mensagens via WebSocket.** Recebe comandos do frontend E respostas do agente.

```javascript
obj.serveraction = function (command, myparent, gp) {
    if (command.plugin !== 'shortName') return;

    var sessionid = null;
    try { sessionid = myparent.ws.sessionId; } catch (e) {}

    var nodeid = command.nodeid || (myparent ? myparent.nodeid : null);
    // command.userid    ← ADICIONADO AUTOMATICAMENTE pelo MeshCentral!
    //                     "user//domain/userid" (confirmado via debug)

    switch (command.pluginaction) {
        case 'getData':
            var pending = ids.length;
            ids.forEach(function (nid) {
                obj.mdb.Get(nid, function (err, docs) {
                    // docs[0] = documento do nó
                    // callback ~26ms (medido via debug)
                    pending--;
                    if (pending <= 0) {
                        obj.send(sessionid, { action:'plugin', plugin:'shortName', method:'callback', data: result });
                    }
                });
            });
            break;
    }
};
```

#### Input (command) via frontend:
```json
{
  "action": "plugin",
  "plugin": "shortName",
  "pluginaction": "getCurrentUsers",
  "userid": "user//01050000000000051500000076fdfd57..."  // ← INSERIDO PELO MeshCentral
}
```

#### myparent (conexão do frontend):
```javascript
myparent.keys = SendServerStats,close,deviceLimit,deviceSkip,domain,send,serverStatsTimer,user,visibleDevices,ws
// myparent.ws.sessionId = "user//domain/userid/randomhash"
// myparent.send()       = alternativa para enviar dados (não recomendado)
```

### handleAdminReq(req, res, user)

```javascript
obj.handleAdminReq = function (req, res, user) {
    // req.query.pin     = "shortName"
    // req.query.user    = "1" (aba do dispositivo)
    // req.query.nodeid  = ID do nó
    // user.name         = "misael.filho.admin"
    // user._id          = "user//domain/userid"
    // user.siteadmin    = 4294967295 (0xFFFFFFFF = admin)
    // req.session       = objeto de sessão (present se logado)
    // req.url           = "/pluginadmin.ashx?pin=usertracer"

    if (req.query.user == 1) {
        return res.render('device', { nodeid, nodeName });
    }
    if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
    res.render('admin', {});
};
```

### onDeviceRefreshEnd(nodeid, panel, refresh, event)

Executado no **frontend** (navegador). Exportado via `exports[]`.

```javascript
obj.exports = ['onDeviceRefreshEnd'];

obj.onDeviceRefreshEnd = function (nodeid, panel, refresh, event) {
    // currentNode._id     = "node//xxx"
    // currentNode.name    = "BR-24002"
    // currentNode.osdesc  = "Windows 10 Pro"
    pluginHandler.registerPluginTab({ tabTitle: 'Tab Name', tabId: 'pluginTabId' });
    QA('pluginTabId', '<iframe src="/pluginadmin.ashx?pin=shortName&nodeid=...&user=1" />');
};
```

---

## 5. Banco de Dados

### Estrutura do Documento de Nó (meshServer.db.Get)

**Tempo de resposta:** ~26ms por consulta (medido via debug com 10 agentes).

```javascript
obj.meshServer.db.Get(nodeid, function(err, docs) {
    if (!docs || !docs.length) return;
    var d = docs[0];
    // d._id             = "node//BKSSERVICES/7pnmr09mJ88uYaX5G5..."
    // d.name            = "BR-25005"
    // d.domain          = "" (vazio = default)
    // d.meshid          = "mesh//gYpSssggj4WflygNHtv7KDH..."
    // d.mtype           = 2 (2 = Windows)
    // d.host            = "BR-25005"
    // d.icon            = 1 (tipo de ícone)
    // d.osdesc          = "Windows 10 Pro"
    // d.ip              = "26.74.237.68"
    // d.users           = ["BKSSERVICES\\misael.filho"]    ← USUÁRIOS ATIVOS
    // d.lusers          = ["BKSSERVICES\\misael.filho"]    ← com status de bloqueio
    // d.upnusers        = ["misael.filho@BKSSERVICES.com"] ← formato UPN
    // d.firstconnect    = 1721149200 (timestamp)
    // d.lastbootuptime  = 1721149200
    // d.idletime        = 300 (segundos)
    // d.wsc             = 1 (Windows Security Center)
    // d.av              = "Windows Defender"
    // d.defender        = true
    // d.agent           = "1.2.4" (versão do agente)
    // d.rname           = nome real (opcional)
    // d.type            = "node"
});
```

### Event Store (plugin DB próprio — db.js)

**NeDB com fallback chain:** `@seald-io/nedb` → `@yetzt/nedb` → `nedb`

```javascript
var Datastore = require('@seald-io/nedb'); // tentar primeiro
if (!Datastore) Datastore = require('@yetzt/nedb');
if (!Datastore) Datastore = require('nedb');

// Collection de eventos
obj.events = new Datastore({
    filename: meshserver.getConfigFilePath('plugin-name-events.db'),  // ← path automático
    autoload: true
});
obj.events.setAutocompactionInterval(60000);
obj.events.ensureIndex({ fieldName: 'nodeid' });
obj.events.ensureIndex({ fieldName: 'username' });
obj.events.ensureIndex({ fieldName: 'detectedAt' });
```

**Estrutura do documento de evento (confirmada via debug):**
```json
{
  "_id": "BQbtWXnMpeytUWvW",           // ← auto (NeDB)
  "nodeid": "node//5dRbggK@IjI6N7c...", // ← ID do nó
  "nodeName": "BR-26001",               // ← nome do dispositivo
  "username": "fabiana.almeida",        // ← usuário (sem domínio)
  "domain": "BKSSERVICES",             // ← domínio extraído
  "displayUser": "BKSSERVICES\\fabiana.almeida",  // ← raw do agente
  "eventType": "userLogin",             // ← "userLogin" | "userLogout"
  "detectedAt": "2026-07-24T16:52:12.629Z",  // ← ISO 8601
  "time": "2026-07-24T16:52:12.629Z"   // ← inserido por addEvent()
}
```

### Métodos do DB

```javascript
obj.addEvent(evt)                              // Insert
obj.getEvents(query, opts, callback)            // Query com suporte a date range e device filter
obj.getEventsByNode(nodeid, opts, callback)     // Filtro por nodeid
obj.getEventsByUser(username, opts, callback)   // Filtro por username
obj.getDeviceNames(callback)                    // Lista de dispositivos no histórico
```

---

## 6. WebSocket: comunicação frontend ↔ server

### Fluxo Real (confirmado via debug)

```
FRONTEND                               SERVER
  │                                       │
  │ ms.send({                             │
  │   action: 'plugin',                   │
  │   plugin: 'usertracer',               │
  │   pluginaction: 'getCurrentUsers'     │
  │ })                                    │
  │──────────────────────────────────────>│
  │                                       │
  │                                       │ serveraction(command, myparent, gp)
  │                                       │   command.userid = "user//..." (auto)
  │                                       │   myparent.ws.sessionId → sid
  │                                       │   command.pluginaction = "getCurrentUsers"
  │                                       │
  │                                       │ db.Get(nodeId) para CADA agente (10×)
  │                                       │   cada callback ~26ms
  │                                       │   extrai doc.users
  │                                       │
  │                                       │ wssessions2[sid].send({
  │                                       │   action: 'plugin',
  │                                       │   plugin: 'usertracer',
  │                                       │   method: 'currentUsers',
  │                                       │   data: [{nodeid,name,users}, ...]
  │                                       │ })
  │<──────────────────────────────────────│
  │                                       │
  │ ms.socket.onmessage(event)            │
  │   JSON.parse(event.data)             │
  │   action=plugin plugin=usertracer    │
  │   method=currentUsers                │
  │   data=array[10]                     │
  │   → renderTable(data)                │
```

### Formato das Mensagens

**Request (frontend → server):**
```json
{
  "action": "plugin",
  "plugin": "usertracer",
  "pluginaction": "getCurrentUsers",
  "userid": "user//domain/userid"  // ← INSERIDO AUTOMATICAMENTE PELO MeshCentral
}
```

**Response (server → frontend):**
```json
{
  "action": "plugin",
  "plugin": "usertracer",
  "method": "currentUsers",
  "data": [
    {
      "nodeid": "node//$lw0atiOCWSyf1@G4IKf7bigKyaP65vqcJ8D$natdZ3OckkpWV0e7ZQH7rT$uYIf",
      "nodeName": "BR-24002",
      "users": ["BKSSERVICES\\Fabiana.Gomes"]
    }
  ]
}
```

### ⚠️ Problema Conhecido: pluginHandler vs socket

O MeshCentral chama handlers do `pluginHandler[plugin][method]()` com o **próprio objeto `meshserver`** durante a inicialização. Confirmado via debug:

```
RESPONSE: msg keys=State,connectstate,pingTimer,authCookie,...
            ↑ São as KEYS do objeto meshserver!
```

**Solução comprovada:** hook no WebSocket REAL (`ms.socket.onmessage`).

```javascript
// ✅ FUNCIONAL — hook no socket real
if (ms && ms.socket) {
    var orig = ms.socket.onmessage;
    ms.socket.onmessage = function(event) {
        var d = JSON.parse(event.data);
        if (d.action === 'plugin' && d.plugin === 'shortName' && d.method === 'callback') {
            renderTable(d.data || []);
            return;
        }
        if (typeof orig === 'function') orig.call(ms.socket, event);
    };
}
```

### sendToSession — Helper

```javascript
obj.send = function (sid, data) {
    console.log('SEND: sid=' + sid.substring(0, 30) + ' method=' + data.method + ' data=' + (data.data ? 'array[' + data.data.length + ']' : typeof data.data));
    try {
        if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) {
            obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data));
        } else {
            console.log('SEND: session not found in wssessions2');
        }
    } catch (e) {}
};
```

### Broadcast (DispatchEvent)

```javascript
obj.meshServer.DispatchEvent(['*', 'server-users'], obj, {
    nolog: true, action: 'plugin', plugin: 'shortName',
    pluginaction: 'broadcast', data: { ... }
});
```

---

## 7. Frontend: templates e handlers

### Handlebars

MeshCentral usa **Handlebars** (`.handlebars`), **não EJS**.

```javascript
res.render('admin', {})      →  views/admin.handlebars
res.render('device', vars)   →  views/device.handlebars
```

### Injeção de Variáveis

```handlebars
<h2>{{nodeName}}</h2>
<script>var nodeid = '{{nodeid}}';</script>
```

### meshserver no Frontend

```javascript
var ms = (typeof parent !== 'undefined' && parent.meshserver) || (window.meshserver || null);
// ms.socket         → WebSocket RAW (use este!)
// ms.send(pkt)      → enviar comando
// ms.State          → 2 = conectado
// ms.onMessage      → NÃO USE (framework já processou)
```

### Hook no WebSocket (funcional)

```javascript
if (ms && ms.socket) {
    var orig = ms.socket.onmessage;
    ms.socket.onmessage = function(event) {
        var d = JSON.parse(event.data);
        dlog('WS: action=' + d.action + ' plugin=' + d.plugin + ' method=' + d.method + ' data=' + (Array.isArray(d.data) ? d.data.length : typeof d.data));
        if (d.action === 'plugin' && d.plugin === 'shortName') {
            if (d.method === 'currentUsers') renderUsers(d.data || []);
            else if (d.method === 'timeline') renderTimeline(d.data || []);
            return;
        }
        if (typeof orig === 'function') orig.call(ms.socket, event);
    };
}
```

### Debug Collapsible

```html
<div id="dbgToggle" onclick="var e=document.getElementById('debug');e.style.display=e.style.display==='none'?'block':'none'">🔽 Debug</div>
<div id="debug" style="display:none;font-size:9px;font-family:monospace;max-height:200px;overflow:auto"></div>
<script>
var D = [];
function dlog() {
    var args = Array.prototype.slice.call(arguments);
    D.push(new Date().toLocaleTimeString() + ' ' + args.join(' '));
    document.getElementById('debug').innerHTML = D.join('\n');
    console.log('[PLUGIN]', args.join(' '));
}
</script>
```

---

## 8. Agent-Side: modules_meshcore

### Estrutura

```javascript
"use strict";
var mesh = null;
var debug_flag = false;
var dbg = function(str) {
    if (debug_flag !== true) return;
    var fs = require('fs');
    var logStream = fs.createWriteStream('plugin.txt', { flags: 'a' });
    logStream.write('\n' + new Date().toLocaleString() + ': ' + str);
    logStream.end('\n');
};

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;  // MeshAgent
    switch (args.pluginaction) {
        case 'start': start(); break;
        case 'setDebug': debug_flag = (args.value === 'true'); break;
    }
    return 'OK';
}

// Auto-start
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
| `win-` | Windows |
| `linux-` | Linux |
| `amt-` | Intel AMT |
| (sem prefixo) | Todas |

---

## 9. Obtendo Dados Específicos

### Agentes Conectados

```javascript
var ws = obj.meshServer.webserver.wsagents || {};
// keys = 10 (confirmado via debug com 10 agentes)
for (var nid in ws) {
    var a = ws[nid];
    a.nodeid;               // "node//xxx"
    a.name;                 // "BR-24002"
    a.agentInfo = {         // informações do agente
        computerName,        // "BR-24002"
        agentVersion,        // "1.2.4"
        platformType         // 2 = Windows
    };
    a.remoteaddr;           // IP
    a.connectTime;          // timestamp
    a.domain;               // domínio
    a.meshid;               // ID do grupo
    a.authenticated;        // 1
    a.dbNodeKey;            // "node/domain/nodeid"
    a.dbMeshKey;            // "mesh/domain/meshid"
}
```

### Usuários Ativos

```javascript
// DADOS NO BANCO, NÃO no WebSocket
obj.meshServer.db.Get(nodeid, function(err, docs) {
    var d = docs[0];
    d.users;      // ["DOMAIN\username"] — usuários ativos
    d.lusers;     // mesmo formato com status
    d.upnusers;   // user@domain
});
```

### Scanner de Mudanças (login/logout)

```javascript
// 1. Primeiro scan → popula cache, NÃO gera eventos
// 2. Scan subsequente → compara doc.users com cache
//    - Se usuário novo → eventType: 'userLogin'
//    - Se usuário sumiu → eventType: 'userLogout'
//    - Se igual → nada

obj.userCache = {}; // { nodeid: JSON.stringify(users) }

obj.checkNode = function(nodeid) {
    obj.mdb.Get(nodeid, function(err, docs) {
        var current = (docs[0].users || []).sort();
        var key = JSON.stringify(current);

        if (!obj.userCache[nodeid]) {
            obj.userCache[nodeid] = key;
            // Verificar DB: se não há eventos → logar como first-ever
            obj.db.getEventsByNode(nodeid, 1, function(events) {
                if (!events || events.length === 0) {
                    current.forEach(function(u) { storeEvent(nodeid, name, u, 'userLogin'); });
                }
            });
            return;
        }

        if (prev === key) return; // sem mudança

        // CHANGE DETECTED → logar diferenças
        obj.userCache[nodeid] = key;
        // usuários em current mas não em prev → LOGIN
        // usuários em prev mas não em current → LOGOUT
    });
};
```

### Session ID do Frontend

```javascript
// Dentro do serveraction:
var sessionid = null;
try { sessionid = myparent.ws.sessionId; } catch (e) {}
// "user//01050000000000051500000076fdfd57/0e090210454b8987b0d547b5709b68ee0e0843fb"
```

### userid Automático

```javascript
// O MeshCentral INJETA automaticamente o userid no comando:
// command.userid = "user//domain/userid"
// Disponível no serveraction:
obj.serveraction = function(command, myparent, gp) {
    console.log(command.userid); // "user//010500000000000515000000..."
};
```

---

## 10. Debug e Diagnóstico

### Server-Side (console.log)

```javascript
// No topo de cada função:
console.log('=== UT FUNCAO ===');
console.log('UT FUNCAO: param1=' + JSON.stringify(param1));
console.log('UT FUNCAO: param2=' + param2);
// Raw data:
console.log('UT RAW: ' + JSON.stringify(data).substring(0, 500));
// Timing:
var tStart = Date.now();
// ... async callback ...
console.log('UT TIMING: ' + (Date.now() - tStart) + 'ms');
```

**Padrão de log dos plugins da comunidade:**
```javascript
console.log('PLUGIN: serveraction called, action=' + command.pluginaction);
console.log('PLUGIN: db.Get callback, docs=' + (docs ? docs.length : 0));
```

### Frontend (collapsible)

```html
<div id="dbgToggle" onclick="toggle()">🔽 Debug <span id="dbgCount">0</span></div>
<div id="debug" style="display:none;font-size:9px;font-family:monospace"></div>
```

### WebSocket Trace

```javascript
if (ms && ms.socket) {
    var orig = ms.socket.onmessage;
    ms.socket.onmessage = function(event) {
        var raw = event.data;
        console.log('WS RAW: len=' + raw.length + ' data=' + raw.substring(0, 300));
        var parsed = JSON.parse(raw);
        console.log('WS PARSED: action=' + parsed.action + ' plugin=' + parsed.plugin + ' method=' + parsed.method);
        if (typeof orig === 'function') orig.call(ms.socket, event);
    };
}
```

---

## 11. Erros Comuns e Soluções

| Erro | Causa | Solução |
|------|-------|---------|
| **401 no admin panel** | Plugin não carregou em `obj.plugins` | Ver console: "Error loading plugin" |
| `Cannot read 'agents' of undefined` | `meshServer.parent` não existe | Use `meshServer.webserver.wsagents` |
| `module 'nedb' not found` | NeDB não disponível | Fallback: `@seald-io/nedb` → `@yetzt/nedb` → `nedb` |
| `Failed to lookup view` | Extensão errada | Use `.handlebars`, `res.render('nome')` sem path |
| Handler chamado com meshserver object | MeshCentral chama `pluginHandler[method]()` com meshserver | Hook em `ms.socket.onmessage` |
| `getTimeline` chamado 4× mesmo carregando uma vez | Aba timeline dispara múltiplos requests | Verificar loop de renderização |
| Resposta chega no `ms.onMessage` sem `action`/`plugin` | Framework já processou a mensagem | Use `ms.socket.onmessage` (RAW) |
| `pending` nunca zera | Callback não retorna | Adicionar timeout |
| `EPERM: operation not permitted` | Permissão de arquivo | Deletar manualmente como Admin |
| `SyntaxError: Unexpected token '}'` | Bloco duplicado | Lint: `new Function(readFile('file.js'))` |

---

## 12. Exemplo Completo: User-Device Tracer v3.2

### Funcionalidade

- Lê `doc.users` do banco MeshCentral para cada agente conectado
- Scanner periódico (30s) detecta login/logout por diff
- Timeline persistente em NeDB (`plugin-usertracer-events.db`)
- Admin panel: Usuários Ativos + Timeline com filtros
- Device tab: Agora + Histórico

### Server-Side (simplificado)

```javascript
"use strict";
module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.mdb = obj.meshServer.db;       // MeshCentral DB
    obj.db = null;                      // Plugin DB (db.js)
    obj.userCache = {};

    obj.server_startup = function () {
        obj.meshServer.pluginHandler.usertracer_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.usertracer_db;
        obj.startScanner();
    };

    // Scanner 30s
    obj.startScanner = function () { obj.scanNow(); setInterval(obj.scanNow, 30000); };

    obj.scanNow = function () {
        var ws = obj.meshServer.webserver.wsagents || {};
        for (var nid in ws) obj.checkNode(nid);
    };

    obj.checkNode = function (nodeid) {
        obj.mdb.Get(nodeid, function (err, docs) {
            if (!docs || !docs.length) return;
            var doc = docs[0];
            var current = (doc.users || []).sort();
            var key = JSON.stringify(current);
            var prev = obj.userCache[nodeid];
            obj.userCache[nodeid] = key;
            if (!prev) return; // first time
            if (prev === key) return; // no change
            // diff → log login/logout
        });
    };

    // HTTP + WS handlers
    obj.handleAdminReq = function (req, res, user) { /* ... */ };
    obj.serveraction = function (command, myparent, gp) { /* getCurrentUsers, getTimeline */ };
    obj.onDeviceRefreshEnd = function () { /* registra aba */ };

    return obj;
};
```

### db.js

```javascript
"use strict";
module.exports.CreateDB = function (meshserver) {
    var obj = {};
    module.paths.push(require('path').join(meshserver.parentpath, 'node_modules'));

    var Datastore;
    try { Datastore = require('@seald-io/nedb'); } catch (ex) {}
    if (!Datastore) try { Datastore = require('@yetzt/nedb'); } catch (ex) {}
    if (!Datastore) Datastore = require('nedb');

    obj.events = new Datastore({ filename: meshserver.getConfigFilePath('plugin-usertracer-events.db'), autoload: true });
    obj.events.setAutocompactionInterval(60000);
    obj.events.ensureIndex({ fieldName: 'nodeid' });
    obj.events.ensureIndex({ fieldName: 'username' });
    obj.events.ensureIndex({ fieldName: 'detectedAt' });

    obj.addEvent = function (evt) { evt.time = new Date(); obj.events.insert(evt); };
    obj.getEvents = function (q, lim, cb) { obj.events.find(q || {}).sort({ detectedAt: -1 }).limit(lim || 500).exec(function(e,d){cb(d||[]);}); };
    obj.getEventsByNode = function (nid, lim, cb) { obj.getEvents({ nodeid: nid }, lim, cb); };

    return obj;
};
```

---

> **Documento gerado em 24/07/2026.** Baseado em:
> - 12 plugins da comunidade (ScriptTask, EventLog, RegEdit, RoutePlus, FileDistribution, WorkFromHome, DevTools, Sample, PluginHookScheduler, Agentname2Servername, PrinterControl, PluginHookExample)
> - Código-fonte do `pluginHandler.js` (MeshCentral v1.2.4)
> - Debug ao vivo do User-Device Tracer v3.2 com 10 agentes Windows
> - Tempos de resposta: db.Get ~26ms, scanner 30s, WS response <100ms
