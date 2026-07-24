# MeshCentral Plugin Development Guide

> **Documento técnico oficial — hooks, funções, métodos, padrões server-side e client-side**
> Baseado na análise de 12 plugins reais: ScriptTask, EventLog, RegEdit, RoutePlus, FileDistribution, WorkFromHome, DevTools, Sample, PluginHookScheduler, Agentname2Servername, PrinterControl, PluginHookExample + código-fonte do `pluginHandler.js`

---

## Sumário

1. [Arquitetura Geral](#1-arquitetura-geral)
2. [config.json — Metadados do Plugin](#2-configjson--metadados-do-plugin)
3. [Estrutura de Diretórios](#3-estrutura-de-diretórios)
4. [Server-Side: plugin_name.js](#4-server-side-plugin_namejs)
   - 4.1 [Module Export Pattern](#41-module-export-pattern)
   - 4.2 [Hooks Disponíveis](#42-hooks-disponíveis)
   - 4.3 [serveraction — Roteador de Mensagens](#43-serveraction--roteador-de-mensagens)
   - 4.4 [handleAdminReq — Painel Admin e Aba do Dispositivo](#44-handleadmireq--painel-admin-e-aba-do-dispositivo)
   - 4.5 [Exports — Funções Expostas ao Frontend](#45-exports--funções-expostas-ao-frontend)
   - 4.6 [Comunicação com o Agente](#46-comunicação-com-o-agente)
   - 4.7 [Banco de Dados (NeDB / MongoDB)](#47-banco-de-dados-nedb--mongodb)
   - 4.8 [Sistema de Permissões](#48-sistema-de-permissões)
   - 4.9 [DispatchEvent — Broadcast para Frontends](#49-dispatchevent--broadcast-para-frontends)
5. [Client-Side: Views e Comunicação](#5-client-side-views-e-comunicação)
   - 5.1 [Template Engine: Handlebars](#51-template-engine-handlebars)
   - 5.2 [Comunicação via WebSocket](#52-comunicação-via-websocket)
   - 5.3 [Registro de Aba no Dispositivo](#53-registro-de-aba-no-dispositivo)
   - 5.4 [Admin Panel (iframe vs página cheia)](#54-admin-panel-iframe-vs-página-cheia)
6. [Agent-Side: modules_meshcore](#6-agent-side-modules_meshcore)
   - 6.1 [Estrutura do Módulo do Agente](#61-estrutura-do-módulo-do-agente)
   - 6.2 [consoleaction — Ponto de Entrada](#62-consoleaction--ponto-de-entrada)
   - 6.3 [SendCommand — Enviar dados ao Servidor](#63-sendcommand--enviar-dados-ao-servidor)
   - 6.4 [SimpleDataStore — Persistência Local](#64-simpledatastore--persistência-local)
   - 6.5 [Detecção de Sessões Windows (query user)](#65-detecção-de-sessões-windows-query-user)
7. [Fluxos de Comunicação Completos](#7-fluxos-de-comunicação-completos)
   - 7.1 [Frontend → Server (consulta)](#71-frontend--server-consulta)
   - 7.2 [Server → Frontend (resposta)](#72-server--frontend-resposta)
   - 7.3 [Server → Agent (comando)](#73-server--agent-comando)
   - 7.4 [Agent → Server (dados)](#74-agent--server-dados)
   - 7.5 [Agent → Server (evento autônomo)](#75-agent--server-evento-autônomo)
8. [Padrões por Plugin](#8-padrões-por-plugin)
   - 8.1 [ScriptTask — Runner de Scripts com Filas e Agendamento](#81-scripttask)
   - 8.2 [EventLog — Coleta de Logs do Windows](#82-eventlog)
   - 8.3 [RegEdit — Explorer/Editor de Registro](#83-regedit)
   - 8.4 [RoutePlus — Roteamento de Portas](#84-routeplus)
   - 8.5 [FileDistribution — Distribuição de Arquivos](#85-filedistribution)
   - 8.6 [WorkFromHome — Agendamento de Acesso](#86-workfromhome)
   - 8.7 [PluginHookScheduler — Orquestração de Hooks](#87-pluginhookscheduler)
   - 8.8 [Agentname2Servername — Sincronização de Nome](#88-agentname2servername)
   - 8.9 [PrinterControl — Gerenciamento de Impressoras](#89-printercontrol)
   - 8.10 [DevTools — Ferramentas de Desenvolvimento](#810-devtools)
   - 8.11 [Sample — Plugin de Exemplo](#811-sample)
   - 8.12 [PluginHookExample — Template de Hooks](#812-plughookexample)
9. [Boas Práticas e Gotchas](#9-boas-práticas-e-gotchas)
10. [Referência Rápida de Assinaturas](#10-referência-rápida-de-assinaturas)

---

## 1. Arquitetura Geral

```
┌──────────────────────────────────────────────────────────────┐
│                    MeshCentral Server                         │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              pluginHandler.js                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │    │
│  │  │ plugin A │  │ plugin B │  │ plugin C │  ...       │    │
│  │  │ obj.plugins[shortName]                            │    │
│  │  │   ├─ server_startup()                             │    │
│  │  │   ├─ serveraction(cmd, parent, gp)                │    │
│  │  │   ├─ handleAdminReq(req, res, user)               │    │
│  │  │   └─ hook_*(...)                                  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           WebSocket Connections                       │    │
│  │  wssessions2[sessionId] → Admin UI (browser)          │    │
│  │  wsagents[nodeId]      → Agents (endpoints)           │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

Cada plugin é um módulo Node.js carregado via `require()` pelo `pluginHandler.js`. O plugin recebe uma referência ao `parent` (o próprio pluginHandler) e pode acessar toda a hierarquia:

```
plugin.parent                    → pluginHandler
plugin.parent.parent             → meshServer (meshserver.js)
plugin.parent.parent.parent      → aplicação principal (main app)
plugin.parent.parent.webserver   → webserver.js
plugin.parent.parent.webserver.wsagents     → { nodeId: WebSocket }
plugin.parent.parent.webserver.wssessions2  → { sessionId: WebSocket }
```

---

## 2. config.json — Metadados do Plugin

```json
{
  "name": "User-Device Tracer",
  "shortName": "usertracer",
  "version": "1.0.0",
  "author": "Author Name",
  "description": "Descrição do plugin",
  "hasAdminPanel": true,
  "homepage": "https://github.com/user/repo",
  "changelogUrl": "https://raw.githubusercontent.com/user/repo/master/changelog.md",
  "configUrl": "https://raw.githubusercontent.com/user/repo/master/config.json",
  "downloadUrl": "https://github.com/user/repo/archive/master.zip",
  "repository": {
    "type": "git",
    "url": "https://github.com/user/repo.git"
  },
  "versionHistoryUrl": "https://api.github.com/repos/user/repo/tags",
  "meshCentralCompat": ">=1.0.0"
}
```

### Validação (`pluginHandler.js:isValidConfig`)

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `name` | string | sim | Nome legível |
| `shortName` | string | sim | Identificador alfanumérico único. Usado como chave em `obj.plugins[shortName]` |
| `version` | string | sim | Semver |
| `author` | string | **não** | (campo opcional na validação) |
| `description` | string | sim | Descrição curta |
| `hasAdminPanel` | boolean | sim | Se `true`, plugin tem painel admin acessível via `/pluginadmin.ashx?pin=shortName` |
| `homepage` | string | sim | URL do projeto |
| `changelogUrl` | string | sim | URL raw do changelog |
| `configUrl` | string | sim | URL raw do config.json (usado para download/instalação) |
| `downloadUrl` | string | sim (git) | URL do ZIP do repositório |
| `repository.type` | string | sim | `"git"` (o único suportado atualmente) |
| `repository.url` | string | sim | URL do repositório |
| `versionHistoryUrl` | string | não | URL da API de tags do GitHub |
| `meshCentralCompat` | string | sim | Versão mínima: `">=0.4.3"` |

> **Nota**: `meshCentralCompat` é comparado com `obj.versionCompare()`. Suporta prefixo `>=`. A versão do MeshCentral é obtida de `parent.version`. A comparação é numérica por segmento (major.minor.patch).

---

## 3. Estrutura de Diretórios

```
plugin_name/
├── config.json                        # Metadados (OBRIGATÓRIO)
├── plugin_name.js                     # Server-side (OBRIGATÓRIO)
├── modules_meshcore/                  # Opcional — código que roda no agente
│   └── plugin_name.js                 #   → incluído no meshcore enviado aos endpoints
├── views/                             # Opcional — templates Handlebars
│   ├── admin.handlebars               #   Painel admin (se hasAdminPanel: true)
│   ├── device.handlebars              #   Aba do dispositivo
│   └── user.handlebars                #   Visão do usuário (ex: ScriptTask)
├── admin.js                           # Opcional — lógica do painel admin separada
├── db.js                              # Opcional — módulo de banco de dados
└── changelog.md                       # Recomendado
```

### Regras de Nomenclatura

- O arquivo JS principal DEVE ter o mesmo nome do `shortName` no `config.json`.
- Exemplo: `shortName: "scripttask"` → arquivo `scripttask.js`.
- O `pluginHandler.js` carrega: `require(pluginPath + '/' + shortName + '/' + shortName + '.js')[shortName](obj)`
- O diretório `views/` é registrado automaticamente no Express via `serv.app.set('views', path)` no `handleAdminReq`.

---

## 4. Server-Side: plugin_name.js

### 4.1 Module Export Pattern

```javascript
"use strict";

module.exports.plugin_name = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;           // Acesso ao meshserver
    obj.debug = obj.meshServer.debug;         // Função de debug
    obj.db = null;                             // Referência ao banco
    obj.exports = ['functionName'];            // Funções expostas ao frontend

    // ... hooks e funções ...

    return obj;
};
```

**O que cada referência significa:**

| Variável | Acesso | Exemplo de uso |
|----------|--------|----------------|
| `parent` | pluginHandler | `parent.registerPermissions()`, `parent.db` |
| `obj.meshServer` | meshserver.js | `obj.meshServer.webserver.wsagents`, `obj.meshServer.parent.agents` |
| `obj.meshServer.parent` | Aplicação principal | `obj.meshServer.parent.agents[nodeId].name` |
| `obj.meshServer.webserver` | Express + WebSocket | `obj.meshServer.webserver.wssessions2`, `obj.meshServer.webserver.wsagents` |
| `obj.debug` | Função de log | `obj.debug('plugin:name', 'mensagem')` → prefixada com timestamp. Equivalente a `console.log` com formatação. |

### 4.2 Hooks Disponíveis

Hooks são funções que o `pluginHandler.callHook()` invoca automaticamente. A assinatura varia conforme o hook.

#### server_startup()
```javascript
obj.server_startup = function () {
    // Chamado quando o servidor inicia OU quando o plugin é recarregado
    // Uso: inicializar DB, registrar permissões, iniciar timers
    obj.initDB();
    parent.registerPermissions('shortName', { ... });
    obj.intervalTimer = setInterval(obj.queueRun, 60 * 1000);
};
```

#### hook_agentCoreIsStable(myparent, gp)
```javascript
obj.hook_agentCoreIsStable = function (myparent, gp) {
    // Chamado quando um agente estabelece conexão estável
    // myparent: objeto do agente (tem .nodeid)
    // gp: grandparent (meshServer)
    // Uso: enviar comando inicial para o agente
    
    var nodeid = myparent ? myparent.nodeid : null;
    if (nodeid && obj.meshServer.webserver.wsagents[nodeid]) {
        obj.meshServer.webserver.wsagents[nodeid].send(JSON.stringify({
            action: 'plugin',
            plugin: 'shortName',
            pluginaction: 'startPolling'
        }));
    }
};
```

#### hook_processAgentData(data, nodeid)
```javascript
obj.hook_processAgentData = function (data, nodeid) {
    // Chamado quando o agente envia dados para o servidor
    // data: mensagem completa do agente
    // nodeid: ID do nó agente
    // Uso: processar dados de telemetria enviados pelo agente
    
    if (data.action === 'plugin' && data.plugin === 'shortName') {
        // Processar dados específicos do plugin
    }
};
```

#### hook_userLoggedIn(user)
```javascript
obj.hook_userLoggedIn = function (user) {
    // Chamado quando um usuário faz login na interface web
    // user: objeto do usuário { _id, name, siteadmin, email, ... }
};
```

#### hook_setupHttpHandlers()
```javascript
obj.hook_setupHttpHandlers = function () {
    // Chamado antes de todos os handlers HTTP serem configurados
    // Uso: registrar rotas HTTP personalizadas
    // obj.meshServer.webserver.app.get('/custom/route', handler);
};
```

#### onDeviceRefreshEnd(nodeid, panel, refresh, event), onDesktopDisconnect(), onWebUIStartupEnd(), goPageStart(index, event), goPageEnd(index, event)

Estes hooks rodam no **frontend** (navegador), exportados via `exports[]`. Descritos na seção [4.5](#45-exports--funções-expostas-ao-frontend).

### 4.3 serveraction — Roteador de Mensagens

`serveraction` é o ponto de entrada único para mensagens que chegam via WebSocket, tanto do frontend quanto do agente. É chamado pelo `pluginHandler` quando recebe `action: 'plugin'`.

```javascript
obj.serveraction = function (command, myparent, grandparent) {
    if (command.plugin !== 'plugin_name') return;

    // Extrair sessionId (apenas para mensagens do frontend)
    var sessionid = null;
    try { sessionid = myparent.ws.sessionId; } catch (e) { /* mensagem veio do agente */ }

    // Extrair nodeid (múltiplas fontes)
    var nodeid = command.nodeid 
              || (myparent ? myparent.nodeid : null)
              || null;

    switch (command.pluginaction) {
        case 'actionFromFrontend':
            obj.handleFrontendAction(command, sessionid);
            break;
        case 'actionFromAgent':
            obj.handleAgentData(command, nodeid);
            break;
        default:
            obj.debug('plugin:name', 'Unknown action: ' + command.pluginaction);
            break;
    }
};
```

**Parâmetros:**

| Parâmetro | Origem frontend | Origem agente |
|-----------|----------------|---------------|
| `command` | Objeto enviado pelo `meshserver.send()` | Objeto enviado pelo `mesh.SendCommand()` |
| `myparent` | WebSocket da sessão do admin (`myparent.ws.sessionId`) | Conexão WebSocket do agente (`myparent.nodeid`) |
| `grandparent` | meshServer | meshServer |

**Como enviar para o serveraction:**

- **Do frontend:** `meshserver.send({ action: 'plugin', plugin: 'shortName', pluginaction: '...', ... })`
- **Do agente:** `mesh.SendCommand({ action: 'plugin', plugin: 'shortName', pluginaction: '...', ... })`

### 4.4 handleAdminReq — Painel Admin e Aba do Dispositivo

```javascript
obj.handleAdminReq = function (req, res, user) {
    // Rota: /pluginadmin.ashx?pin=shortName
    
    // A) Aba do dispositivo (carregada em iframe na página do dispositivo)
    if (req.query.user == 1) {
        res.render('device', {
            nodeid: req.query.nodeid || '',
            nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown'
        });
        return;
    }
    
    // B) Painel admin global — requer site admin
    if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
        res.sendStatus(401);
        return;
    }
    
    res.render('admin', {});
};
```

**Importante:**
- O `pluginHandler.handleAdminReq` (linha 934) ANTES de chamar esta função:
  1. Valida se `req.query.pin` é alfanumérico
  2. Seta o `views` directory do Express para `<pluginPath>/<shortName>/views/`
  3. Verifica se `obj.plugins[req.query.pin]` existe E tem `handleAdminReq` como função
  4. Se não → retorna 401

- **NUNCA** use caminho absoluto em `res.render()`. Use apenas o nome do template (`'admin'`, `'device'`, etc.). O pluginHandler já configura o diretório `views/`.
- **Template engine**: O MeshCentral usa **Handlebars** (`.handlebars`), não EJS. Configure `exphbs` no webserver.js.
- Templates usam `{{var}}` (HTML escapado) ou `{{{var}}}` (HTML cru) para variáveis.

### 4.5 Exports — Funções Expostas ao Frontend

O array `obj.exports` lista funções que serão serializadas e enviadas ao frontend via `pluginHandler.prepExports()`.

```javascript
obj.exports = [
    'onDeviceRefreshEnd',
    'onDesktopDisconnect',
    'registerPluginTab',
    'loadHistory'
];
```

**Mecanismo** (`pluginHandler.js:prepExports`):
1. Para cada plugin em `obj.plugins`, itera sobre `obj.exports[pluginName]`
2. Para cada função no array, chama `.toString()` no método
3. Concatena no formato: `obj.shortName.funcName = <código da função>`
4. Envia ao frontend via `/pluginHandler.js` endpoint

**No frontend** (`pluginHandlerBuilder`):
```javascript
// As funções exportadas ficam disponíveis em:
pluginHandler.shortName.funcName(args)

// Exemplo:
pluginHandler.scripttask.historyData(message)
pluginHandler.eventlog.onDeviceRefreshEnd()
```

**Hooks de frontend que são chamados automaticamente pelo MeshCentral:**

| Hook | Quando é chamado | Parâmetros |
|------|-----------------|------------|
| `onDeviceRefreshEnd(nodeid, panel, refresh, event)` | Quando um dispositivo é selecionado | `nodeid`, `panel`, `refresh`, `event` |
| `onDesktopDisconnect()` | Quando sessão de desktop remoto é desconectada | — |
| `onWebUIStartupEnd()` | Após carregamento inicial da página | — |
| `goPageStart(index, event)` | Antes de mudar de página | `index` (int), `event` |
| `goPageEnd(index, event)` | Após mudar de página | `index` (int), `event` |

### 4.6 Comunicação com o Agente

**Servidor → Agente:**
```javascript
// Enviar comando direto para um agente específico
if (obj.meshServer.webserver.wsagents[nodeid]) {
    obj.meshServer.webserver.wsagents[nodeid].send(JSON.stringify({
        action: 'plugin',
        plugin: 'shortName',
        pluginaction: 'commandName',
        data: { ... }
    }));
}
```

**Agente → Servidor (resposta/comando autônomo):**
```javascript
// No agent-side (modules_meshcore):
mesh.SendCommand({
    action: 'plugin',
    plugin: 'shortName',
    pluginaction: 'responseAction',
    nodeid: mesh.info._id,     // Importante: identificar o nó
    data: { ... }
});
```

Ambos chegam no `serveraction()` do plugin no servidor.

### 4.7 Banco de Dados (NeDB / MongoDB)

O MeshCentral suporta dois backends de banco. Plugins devem usar **NeDB** como padrão (não requer MongoDB).

```javascript
// db.js — factory que cria a conexão
module.exports.CreateDB = function(meshserver) {
    var obj = {};
    
    if (meshserver.args.mongodb) {
        // Usa MongoDB
        const db = client.db(dbname);
        obj.collection = db.collection('plugin_name_collection');
    } else {
        // Usa NeDB (padrão)
        var Datastore = require('nedb');
        obj.collection = new Datastore({
            filename: meshserver.getConfigFilePath('plugin-name-data.db'),
            autoload: true
        });
        obj.collection.persistence.setAutocompactionInterval(60000); // 1 min
        obj.collection.ensureIndex({ fieldName: 'nodeid' });
    }
    
    return obj;
};
```

#### Padrão de initializedB no main JS:
```javascript
obj.server_startup = function() {
    obj.meshServer.pluginHandler.pluginname_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
    obj.db = obj.meshServer.pluginHandler.pluginname_db;
};
```

**NeDB API básica:**
```javascript
// Insert
collection.insert({ nodeid: 'xxx', eventType: 'login', timestamp: new Date() });

// Find (com filtro)
collection.find({ nodeid: 'xxx' }).sort({ timestamp: -1 }).limit(100).exec(callback);

// Find (todos)
collection.find({}).sort({ timestamp: -1 }).exec(callback);

// Update
collection.update({ _id: id }, { $set: { field: value } }, { upsert: true });

// Remove
collection.remove({ _id: id }, {});
```

### 4.8 Sistema de Permissões

#### Registro de Permissões

```javascript
// Chamado em server_startup()
parent.registerPermissions('shortName', {
    'can_access': {
        title: 'Access Plugin',
        desc: 'Can access the plugin functionality',
        default: 'allowed'
    },
    'can_edit': {
        title: 'Edit',
        desc: 'Can edit values',
        default: 'denied'
    }
});
```

**Campos de cada permissão:**
| Campo | Descrição |
|-------|-----------|
| `title` | Nome exibido na UI de permissões |
| `desc` | Descrição exibida na UI |
| `default` | `'allowed'`, `'denied'`, ou `'inherited'` |

#### Verificação de Permissões

```javascript
// No serveraction ou handleAdminReq
var hasAccess = await parent.getAccessPermissions('shortName', user, { nodeid: nodeId });

// Verificar permissão específica
if (!hasAccess('can_access')) {
    res.sendStatus(401);
    return;
}

// Obter lista de todas as permissões concedidas
var allPerms = hasAccess('_ALL_'); // ['can_access', ...]
```

**Hierarquia de resolução (cascata):**
1. Node override (mais específico)
2. Mesh override
3. Configuração global
4. Default da permissão

**Aviso importante:** Se o default de uma permissão for `'denied'` e houver uma verificação ANTES do `handleAdminReq` ser chamado (ex: no `pluginHandler.handleAdminReq` ou `handlePluginAdminReq`), o acesso será negado mesmo para admins. Permissões de acesso ao painel admin devem ter `default: 'allowed'`.

### 4.9 DispatchEvent — Broadcast para Frontends

Alternativa ao `wssessions2[sessionid].send()` para enviar dados a TODOS os frontends conectados:

```javascript
obj.meshServer.DispatchEvent(
    ['*', 'server-users'],               // targets
    obj,                                 // source plugin
    {                                    // mensagem
        nolog: true,
        action: 'plugin',
        plugin: 'shortName',
        pluginaction: 'methodName',
        data: { ... }
    }
);
```

O frontend recebe através do handler registrado:
```javascript
// No pluginHandler do frontend:
parent.pluginHandler.shortName.methodName = function(message) {
    // message.data tem os dados
};
```

> **Diferença**: `DispatchEvent` envia para TODAS as sessões administrativas. `wssessions2[sessionid].send()` envia para UMA sessão específica.

---

## 5. Client-Side: Views e Comunicação

### 5.1 Template Engine: Handlebars

O MeshCentral usa **Handlebars** como view engine (configurado via `express-handlebars`). Templates usam extensão `.handlebars`.

```handlebars
{{! admin.handlebars — sem variáveis injetadas pelo servidor }}
<h1>User-Device Tracer</h1>
<p class="subtitle">Rastreio de login de usuários Windows</p>
```

```handlebars
{{! device.handlebars — com variáveis injetadas }}
<h2>User-Device Tracer</h2>
<p class="subtitle">Dispositivo: {{nodeName}}</p>
<script>
var nodeid = '{{nodeid}}';
</script>
```

**Sintaxe Handlebars:**
| Sintaxe | Efeito |
|---------|--------|
| `{{var}}` | Interpolação com HTML escapado |
| `{{{var}}}` | Interpelação com HTML cru (útil para JSON) |
| `{{#each array}}...{{/each}}` | Iteração |
| `{{#if cond}}...{{/if}}` | Condicional |

### 5.2 Comunicação via WebSocket

**Enviar comando para o servidor:**
```javascript
// No template (admin.handlebars ou device.handlebars)
var meshserver = (typeof parent !== 'undefined' && parent.meshserver) 
               ? parent.meshserver 
               : (window.meshserver || null);

function sendCmd(pluginaction, extra) {
    if (!meshserver) return;
    extra = extra || {};
    meshserver.send(Object.assign({
        action: 'plugin',
        plugin: 'shortName',
        pluginaction: pluginaction
    }, extra));
}

// Exemplo de uso:
sendCmd('getAllEvents', { limit: 500 });
```

**Receber resposta do servidor:**
```javascript
// Registrar handler no pluginHandler do parent
// MeshCentral chama pluginHandler.shortName[method](msg) quando chega resposta
(function registerHandlers() {
    var target = null;
    try {
        if (typeof pluginHandler !== 'undefined' && pluginHandler.shortName) {
            target = pluginHandler.shortName;
        } else if (typeof parent !== 'undefined' && parent.pluginHandler && parent.pluginHandler.shortName) {
            target = parent.pluginHandler.shortName;
        }
    } catch(e) {}
    
    if (!target) { setTimeout(registerHandlers, 500); return; }
    
    // Registrar handler para cada método de resposta
    target.eventList = function(msg) {
        var data = (msg && msg.data !== undefined) ? msg.data : msg;
        renderEventList(data);
    };
    
    target.userStats = function(msg) {
        renderUserStats((msg && msg.data !== undefined) ? msg.data : msg);
    };
})();
```

**Resposta do servidor (no plugin):**
```javascript
// Enviar resposta para uma sessão específica
obj.sendToSession = function(sessionid, data) {
    if (!sessionid) return;
    try {
        if (obj.meshServer.webserver.wssessions2 && 
            obj.meshServer.webserver.wssessions2[sessionid]) {
            obj.meshServer.webserver.wssessions2[sessionid].send(JSON.stringify(data));
        }
    } catch (e) {
        obj.debug('plugin:name', 'sendToSession error: ' + e.message);
    }
};

// Uso:
obj.sendToSession(sessionid, {
    action: 'plugin',
    plugin: 'shortName',
    method: 'eventList',
    data: resultArray
});
```

### 5.3 Registro de Aba no Dispositivo

```javascript
// Exportado para frontend via obj.exports
obj.onDeviceRefreshEnd = function (nodeid, panel, refresh, event) {
    if (typeof currentNode === 'undefined' || currentNode == null) return;
    
    // (Opcional) Mostrar apenas para Windows
    if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;
    
    // Registrar aba
    pluginHandler.registerPluginTab({
        tabTitle: 'My Plugin Tab',
        tabId: 'pluginMyTab'
    });
    
    // Injetar iframe na aba
    QA('pluginMyTab', 
       '<iframe id="pluginIframeMyTab" style="width:100%;height:600px;overflow:auto" '
       + 'scrolling="yes" frameBorder=0 '
       + 'src="/pluginadmin.ashx?pin=shortName&nodeid=' 
       + encodeURIComponent(currentNode._id) + '&user=1" />');
};
```

O método `registerPluginTab` no frontend (gerado por `prepExports`):
- Cria um header `<span>` no `p19headers`
- Cria um `<div>` no `p19pages`
- Torna visível o `MainDevPlugins`

### 5.4 Admin Panel (iframe vs página cheia)

**Painel admin (`hasAdminPanel: true`):**
- Acessado via `goPlugin()` no frontend: `goPlugin('shortName', 'Display Name')`
- Define iframe src para `/pluginadmin.ashx?pin=shortName`
- Mostra a view renderizada por `handleAdminReq`

**Aba do dispositivo:**
- Carregada como iframe com `&user=1` no query string
- A view `device.handlebars` é renderizada com `nodeid` e `nodeName`

**Comunicação no iframe:**
```javascript
// O iframe é same-origin, então tem acesso a:
parent.meshserver         // WebSocket do MeshCentral
parent.pluginHandler      // Handler de plugins
parent.pnetMsg            // (pode não existir em todas versões)
```

---

## 6. Agent-Side: modules_meshcore

### 6.1 Estrutura do Módulo do Agente

O arquivo `modules_meshcore/plugin_name.js` é automaticamente incluído no meshcore enviado para cada endpoint durante `obj.addMeshCoreModules()`.

**Classificação por plataforma:**

| Prefixo do arquivo | Plataforma |
|--------------------|------------|
| `win-` | Windows (com e sem AMT) |
| `linux-` | Linux (com e sem AMT) |
| `amt-` | Intel AMT (Windows e Linux) |
| (sem prefixo) | Todas as plataformas |

### 6.2 consoleaction — Ponto de Entrada

```javascript
var mesh = null;

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;  // parent = MeshAgent com SendCommand()
    
    switch (args.pluginaction) {
        case 'start':
            startPolling();
            break;
        case 'stop':
            stopPolling();
            break;
        case 'getStatus':
            return JSON.stringify(knownSessions);
            break;
    }
    return 'OK';
}
```

**Parâmetros:**

| Parâmetro | Descrição |
|-----------|-----------|
| `args` | Objeto comando (action, plugin, pluginaction, dados) |
| `rights` | Nível de permissão |
| `sessionid` | ID da sessão (se originado do frontend) |
| `parent` | Objeto MeshAgent com `SendCommand()`, `info`, etc. |

> **Nota**: `consoleaction` é chamada quando o servidor envia um comando para o agente com `action: 'plugin'`.

### 6.3 SendCommand — Enviar dados ao Servidor

```javascript
// Enviar dados do agente para o servidor
mesh.SendCommand({
    action: 'plugin',
    plugin: 'shortName',
    pluginaction: 'eventData',
    nodeid: (mesh.info && mesh.info._id) ? mesh.info._id : null, // IMPORTANTE
    events: JSON.stringify(events)
});
```

**Regras:**
- Sempre inclua `nodeid` se disponível (`mesh.info._id` ou `mesh.info.nodeid`)
- O servidor recebe em `serveraction(command, myparent)` onde `myparent.nodeid` pode estar disponível
- Se `command.nodeid` não for enviado, o servidor precisa derivar de `myparent.nodeid`

### 6.4 SimpleDataStore — Persistência Local

```javascript
var db = require('SimpleDataStore').Shared();

// Salvar
db.Put('pluginKey', { data: 'value' });

// Recuperar
var value = db.Get('pluginKey');

// Exemplo: último estado conhecido
var lastState = db.Get('plugin_lastState') || {};
```

### 6.5 Detecção de Sessões Windows (query user)

```javascript
if (process.platform !== 'win32') return;

var exec = require('child_process').exec;
exec('query user', { timeout: 10000 }, function (err, stdout, stderr) {
    var sessions = parseQueryUserOutput(stdout);
    // ...
});

function parseQueryUserOutput(stdout) {
    var lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    var sessions = [];
    for (var i = 1; i < lines.length; i++) {
        var line = lines[i];
        if (!line.trim()) continue;
        // Parse por posição fixa (locale-independent):
        var username   = line.substring(0, 22).trim();
        var sessionName = line.substring(22, 42).trim();
        var sessionId  = line.substring(42, 47).trim();
        var state      = line.substring(47, 57).trim();
        var idleTime   = line.substring(57, 70).trim();
        var logonTime  = line.substring(70).trim();
        // ...
        sessions.push({ username, sessionName, sessionId, state, ... });
    }
    return sessions;
}
```

**Regra de detecção de login/logout:**

| Estado anterior | Estado atual | Evento |
|----------------|-------------|--------|
| — (novo) | Active | `userLogin` |
| Active | Disc | `sessionDisconnected` |
| Disc | Active | `sessionReconnected` |
| Active | (sumiu) | `userLogout` |

> **Importante**: Rastreie TODAS as sessões em `knownSessions` (incluindo `Disc`). Dispare `userLogout` APENAS quando a chave da sessão SUMIR completamente do `query user`, não quando mudar de Active para Disc.

---

## 7. Fluxos de Comunicação Completos

### 7.1 Frontend → Server (consulta)

```
Browser                         MeshCentral Server
  │                                    │
  │ meshserver.send({                  │
  │   action: 'plugin',                │
  │   plugin: 'shortName',             │
  │   pluginaction: 'getData',         │
  │   ...                              │
  │ })                                 │
  │───────────────────────────────────>│
  │                                    │ serveraction(command, myparent, gp)
  │                                    │   myparent.ws.sessionId → sessionid
  │                                    │   command.pluginaction → 'getData'
  │                                    │   processa dados
  │                                    │
  │ wssessions2[sessionid].send({      │
  │   action: 'plugin',                │
  │   plugin: 'shortName',             │
  │   method: 'responseMethod',        │
  │   data: [...]                       │
  │ })                                 │
  │<───────────────────────────────────│
  │                                    │
  │ pluginHandler.shortName            │
  │   .responseMethod(msg)             │
  │      msg.data → renderTable()      │
```

### 7.2 Server → Frontend (resposta)

No servidor:
```javascript
obj.sendToSession(sessionid, {
    action: 'plugin',
    plugin: 'shortName',
    method: 'responseMethod',
    data: resultArray
});
```

No frontend (precisa registrar):
```javascript
parent.pluginHandler.shortName.responseMethod = function(msg) {
    renderData(msg.data);
};
```

### 7.3 Server → Agent (comando)

```
MeshCentral Server               Windows Agent
  │                                    │
  │ wsagents[nodeid].send({            │
  │   action: 'plugin',                │
  │   plugin: 'shortName',             │
  │   pluginaction: 'doSomething',     │
  │   params: {...}                    │
  │ })                                 │
  │───────────────────────────────────>│
  │                                    │ consoleaction(args, rights, sessionid, parent)
  │                                    │   args.pluginaction → 'doSomething'
  │                                    │   processa comando
  │                                    │
  │ mesh.SendCommand({                 │
  │   action: 'plugin',                │
  │   plugin: 'shortName',             │
  │   pluginaction: 'result',          │
  │   data: result                     │
  │ })                                 │
  │<───────────────────────────────────│
  │                                    │
  │ serveraction(command, myparent)     │
  │   myparent.nodeid → nodeid         │
  │   processa resultado               │
```

### 7.4 Agent → Server (dados)

```
Windows Agent (autônomo)         MeshCentral Server
  │                                    │
  │ mesh.SendCommand({                 │
  │   action: 'plugin',                │
  │   plugin: 'shortName',             │
  │   pluginaction: 'statusUpdate',    │
  │   nodeid: mesh.info._id,           │
  │   data: {...}                      │
  │ })                                 │
  │───────────────────────────────────>│
  │                                    │ serveraction(command, myparent)
  │                                    │   command.nodeid → nodeid (do agente)
  │                                    │   processa statusUpdate
```

### 7.5 Agent → Server (evento autônomo)

Alternativa usando `hook_processAgentData`:

```
Windows Agent                     MeshCentral Server
  │                                    │
  │ mesh.SendCommand({                 │
  │   action: 'plugin',                │
  │   plugin: 'shortName',             │
  │   ...                              │
  │ })                                 │
  │───────────────────────────────────>│
  │                                    │ hook_processAgentData(data, nodeid)
  │                                    │   data.action === 'plugin'
  │                                    │   data.plugin === 'shortName'
  │                                    │   processa dados com nodeid conhecido
```

---

## 8. Padrões por Plugin

### 8.1 ScriptTask

- **Autor**: Ryan Blenis
- **Finalidade**: Executar scripts (PowerShell, BAT, Bash) em endpoints
- **hasAdminPanel**: false (usa iframe para UI)

**Funções server-side:**

| Função | Descrição |
|--------|-----------|
| `server_startup()` | Init DB + timer de fila |
| `queueRun()` | Processa jobs pendentes, envia para agentes, gerencia schedules |
| `downloadFile(req, res, user)` | Download de scripts |
| `handleAdminReq(req, res, user)` | Renderiza views (admin, user, scriptedit, procedit, schedule) |
| `updateFrontEnd(ids)` | Envia atualizações via `DispatchEvent` |

**Padrões notáveis:**
- Usa `obj.meshServer.DispatchEvent(targets, obj, msg)` para broadcast
- DB com `type_field` para distinguir scripts, jobs, schedules, variáveis
- Template variables: substitui `#VARNAME#` em scripts
- `hook_processAgentData` não usado — usa `serveraction` para respostas do agente

### 8.2 EventLog

- **Autor**: Ryan Blenis
- **Finalidade**: Coletar e visualizar logs de eventos do Windows
- **hasAdminPanel**: true

**Funções server-side:**

| Função | Descrição |
|--------|-----------|
| `server_startup()` | Init DB |
| `handleAdminReq(req, res, user)` | Renderiza admin panel (delega para `admin.js`) |
| `registerPermissions()` | Permissões: `deviceLiveTab`, `deviceHistoryTab` |
| `addEventsFor(nodeid, events)` | Insere eventos no DB |
| `getEventsFor(nodeid, opts, callback)` | Consulta eventos por nó |
| `updateConfig(id, args)` | CRUD de configurações de coleta |

**Padrões notáveis:**
- Usa `_pluginPermissions()` para retornar objeto de permissões (diferente de `registerPermissions`)
- Admin panel usa `admin.handlebars` com `{{{configSets}}}` e `{{{configAssignments}}}` injetados
- Agent-side: PowerShell `Get-WinEvent` para coleta
- Periodicidade: 1 minuto (`setInterval`)

### 8.3 RegEdit

- **Autor**: Ryan Blenis
- **Finalidade**: Explorar e editar o registro do Windows
- **hasAdminPanel**: false (usa iframe)

**Funções server-side:**

| Função | Descrição |
|--------|-----------|
| `server_startup()` | Log de inicialização |
| `handleAdminReq(req, res, user)` | Renderiza view `regedit` com hives |
| `onDeviceRefreshEnd()` | Registra aba "RegEdit" no dispositivo |
| `serveraction()` | Roteia 13 ações: enumKey, getValue, setValue, createKey, deleteKey, renameKey, search, exportBranch, importBranch, userSidsToProfiles + resultados |

**Padrões notáveis:**
- Comunicação bidirecional via `sessionid`: frontend → serveraction → wsagents[nodeid] → agente → serveraction → wssessions2[sessionid] → frontend
- `registerPermissions` NÃO é usado — permissões são gerenciadas via siteadmin
- View `regedit` recebe `hives` como JSON string

### 8.4 RoutePlus

- **Autor**: Ryan Blenis
- **Finalidade**: Roteamento de portas TCP para dispositivos gerenciados
- **Arquivos**: `routeplus.js`, `db.js`, `modules_meshcore/routeplus.js`

**Funções server-side:**
- `server_startup()` → init DB, carrega rotas persistentes
- `routeManagement()` → Roteia tráfego TCP entre portas locais e remotas
- `serveraction(command, myparent, gp)` → CRUD de rotas: addRoute, removeRoute, listRoutes
- `hook_agentCoreIsStable(myparent, gp)` → Restabelece rotas após reconexão do agente
- `handleAdminReq(req, res, user)` → Painel de gerenciamento de rotas

**Padrões:**
- Usa `wsagents[nodeid].send()` para enviar comandos de túnel ao agente
- Persiste rotas em NeDB para restaurar após reboot do servidor
- Timer periódico para verificar health das conexões TCP

### 8.5 FileDistribution

- **Autor**: Ryan Blenis
- **Finalidade**: Distribuir arquivos do servidor para endpoints
- **hasAdminPanel**: false (UI via iframe)

**Funções notáveis:**
- `server_startup()` → initDB
- `serveraction()` → gerencia mapeamentos de arquivos
- DB schema: `{ type: 'map', node, serverpath, clientpath, filesize }`
- Comunicação server→agent via `wsagents[nodeid].send()`
- Path encoding: `serverpath = domainId/folderId/fileId/subpath`
### 8.6 WorkFromHome

- **Autor**: Ryan Blenis
- **Finalidade**: Agendar janelas de acesso remoto (RDP) para usuários
- **Versão**: 0.1.3, compat `>=1.1.35`
- **hasAdminPanel**: false (UI via iframe)
- **Arquivos**: `workfromhome.js`, `db.js`, `views/user.handlebars`, `views/pickNode.handlebars`, `modules_meshcore/workfromhome.js`

**Funções server-side documentadas:**
| Função | Descrição |
|--------|-----------|
| `server_startup()` | Init DB via `nemongo.js`, start timer 3h |
| `queueRun()` | Atualiza cookies de autenticação antes de expirar (3h) |
| `hook_agentCoreIsStable(myparent,gp)` | Restabelece túnel RDP após reconexão do agente |
| `startRoute(comp,map,rcookie)` | Envia comando `startRoute` ao agente via `wsagents[comp].send()` |
| `updateAuthCookie(comp,map,rcookie)` | Atualiza cookie de autenticação no agente |
| `serveraction(command,myparent,gp)` | Dispatch: addMap, removeMap, updateMapPort, updateMapLabel, updateAadCompat |
| `handleAdminReq(req,res,user)` | 3 rotas: admin panel, download RDP file, pickNode, user view |
| `updateFrontEnd(ids)` | Broadcast via `DispatchEvent(['*','server-users'], obj, msg)` |

**Padrões notáveis:**
- Cookie encoding: `obj.parent.encodeCookie({userid, domainid}, loginCookieEncryptionKey)` para auth RDP
- `resetQueueTimer()` → SetInterval a cada 3h (cookie lifetime ~4h)
- Views: separa `user.handlebars` (usuário) de `pickNode.handlebars` (seleção de dispositivo)
- DB wrapper: `nemongo.js` — compatibilidade NeDB ↔ MongoDB com API `.toArray()`
- Download de arquivo `.rdp` via `res.setHeader('Content-disposition', 'attachment; filename=...')` + `res.send(content)`
### 8.7 PluginHookScheduler

- **Autor**: bitctrl
- **Versão**: 0.0.2
- **Finalidade**: Orquestrar ordem de execução de hooks entre múltiplos plugins
- **Padrão**: Intercepta `pluginHandler.callHook()` e executa hooks na ordem declarada em config

**Mecanismo:**
1. `backendhooks` no config.json: `[ ['hookName', ['pluginA','pluginB']], ... ]`
2. `*` (wildcard) como hookName → captura todos os hooks não listados
3. `#` prefix → comenta o plugin (pula execução)
4. Substitui o `callHook` original do pluginHandler pelo próprio scheduler
5. `wrapFunctionCall(target, obj, options)` → injeta `hook_before*`/`hook_after*` em funções arbitrárias

**Uso:** Ideal para plugins que dependem da ordem de execução (ex: Agentname2Servername precisa rodar antes de outros).

### 8.8 Agentname2Servername

- **Autor**: bitctrl
- **Finalidade**: Sincronizar `--agentName` do agente com o nome exibido no servidor
- **Hook usado**: `hook_afterCreateMeshAgent`
- **Arquivos**: `agentname2servername.js`, `config.json` (sem modules_meshcore, sem views)

**Mecanismo:**
1. `hook_afterCreateMeshAgent(agent)` → instala listener WebSocket one-shot no agente
2. Listener verifica `include`/`exclude` filters (listas de nós no config)
3. Se aprovado, sobrescreve `agentInfo.computerName = agentName`
4. Seta `mesh.flags |= 2` para forçar sincronização do display name

**Padrões notáveis:**
- Plugin minimalista: 3 funções + 1 closure, sem banco, sem views
- Usa `hook_afterCreateMeshAgent` (hook NÃO documentado oficialmente)
- Filtros include/exclude por nodeId no config.json

### 8.9 PrinterControl

- **Autor**: stavila0170
- **Versão**: 0.4.13
- **Finalidade**: Gerenciar impressoras Windows (filas, drivers, portas, spooler, jobs)
- **hasAdminPanel**: false (UI via iframe na aba do dispositivo)
- **Arquivos**: `printercontrol.js` (959 linhas), `modules_meshcore/printercontrol.js` (618 linhas), `views/printercontrol.handlebars` (805 linhas)

**Camadas:**

| Camada | Arquivo | Função |
|--------|---------|--------|
| Server | `printercontrol.js` | Roteamento browser↔agente, permissões, subscriptions, heartbeat, lease |
| Agent | `modules_meshcore/printercontrol.js` | PowerShell via stdin, WMI watcher, lease renewal |
| UI | `views/printercontrol.handlebars` | Iframe auto-contido: toolbar, tabela, job queue, formulários |

**Funções server-side:**
- `onDeviceRefreshEnd()` → Lazy-load do iframe na aba do dispositivo
- `onWebUIStartupEnd()` → Injeta CSS dark-theme no modal de permissões
- `serveraction(command, myparent, gp)` → Roteia 17 ações: getPermissions, subscribeJobs, heartbeatJobs, inventory, jobs, cancelJob, pauseJob, resumeJob, testPage, addTcpPrinter, deletePrinter, removePort, removeDriver, spoolerStart, spoolerStop, spoolerRestart, clearQueue
- `handleAdminReq(req, res, user)` → Renderiza `printercontrol.handlebars`

**Padrões de agente:**
- Script PowerShell comprimido em GZIP e embarcado como Base64 no módulo (`SCRIPT_GZIP_BASE64`)
- Execução via stdin (`buildInMemoryCommand`) para evitar truncamento de argv
- Job watcher via WMI `__InstanceOperationEvent` em `Win32_PrintJob` com timeout 2s
- Lease-based: `jobWatcherLeaseTimer` (55s default, min 15s, max 120s) + `jobWatcherHardTimer` (10 min absoluto)
- Saída consumida linha a linha via `consumeWatcherOutput`

**Padrões de frontend:**
- `PrinterControl` IIFE para encapsulamento
- Estado: permissions, online, inventory, selectedPrinter, subscriptionId
- Heartbeat a cada 15s (`sendHeartbeat`)
- Visibilidade: `isPluginVisible()` + 10 min max timer
- Jobs recentes: retidos 15s após conclusão

### 8.10 DevTools

- **Autor**: Ryan Blenis
- **Versão**: 0.0.2, compat `>=0.4.4-s`
- **Finalidade**: Ferramentas de desenvolvimento: CRUD de configs de plugins, refresh do pluginHandler, restart do servidor
- **hasAdminPanel**: true
- **Arquivos**: `devtools.js`, `views/admin.handlebars` (sem modules_meshcore)

**Funções server-side:**
- `handleAdminReq(req, res, user)` → Renderiza admin panel com 5 ações
- `serveraction(command, myparent, gp)` → CRUD de configs: addPluginConfig, editPluginConfig, deletePluginConfig, refreshPluginHandler, restartServer

**Padrões notáveis:**
- **Restart do servidor**: `process.exit(123)` — MeshCentral interpreta código 123 como restart (não crash)
- **Broadcast**: `obj.meshServer.DispatchEvent(['*', 'server-users'], obj, {action:'pluginStateChange'})`
- **CRUD direto no DB**: `db.addPlugin/getPlugin/updatePlugin/deletePlugin` na coleção `plugins`
- **Admin panel**: `res.render(obj.VIEWS + 'admin')` com path absoluto (workaround para versão antiga)
- **Sem `registerPermissions()`**: usa `(user.siteadmin & 0xFFFFFFFF) == 0` manual

### 8.11 Sample

- **Autor**: Ryan Blenis
- **Finalidade**: Plugin de exemplo minimalista
- **Funções**:
  - `onDesktopDisconnect()` → Preenche campo de evento com timestamp
  - `exports = ['onDesktopDisconnect']`

### 8.12 PluginHookExample

- **Autor**: bitctrl
- **Finalidade**: Template de plugin demonstrando o padrão PluginHookScheduler
- **Arquivos**: `pluginhookexample.js` (185 linhas), `config.json`

**Demonstra:**
1. Integração com PluginHookScheduler para ordenação de hooks
2. `wrapFunctionCall(target, obj, options)` para injetar hooks `before`/`after` em funções arbitrárias
3. Dois sub-plugins falsos (`pluginA`, `pluginB`) que competem pelo mesmo hook
4. Hooks em eventos custom E built-in do MeshCentral
5. Configuração `backendhooks` no config.json: `[ ['hookName', ['pluginA','pluginB']] ]`

**Padrões:**
- Usa `pluginHookScheduler.wrapFunctionCall()` para embrulhar funções sem modificar o código original
- Demonstra que a ORDEM dos plugins no array `backendhooks` DETERMINA a ordem de execução

---

## 9. Boas Práticas e Gotchas

### 9.1 Arquivos e Paths

| Regra | Detalhe |
|-------|---------|
| Nome do JS | Deve ser exatamente `shortName.js` |
| Path do plugin | `meshcentral-data/plugins/shortName/` |
| Path das views | Registrado automaticamente pelo `handleAdminReq` |
| **NUNCA** use caminho absoluto em `res.render()` | Use só o nome do template: `res.render('admin', vars)` |

### 9.2 Banco de Dados

| Regra | Detalhe |
|-------|---------|
| Use NeDB como padrão | Não force MongoDB |
| `ensureIndex` | Faça após `autoload` |
| `setAutocompactionInterval` | Recomendado: 60000ms (1 minuto) |
| `getConfigFilePath()` | Use para paths de arquivos DB |

### 9.3 Comunicação

| Regra | Detalhe |
|-------|---------|
| `meshserver.send()` | Método padrão para frontend→server |
| `parent.meshserver.send()` | No iframe |
| **NUNCA** use `pnetMsg` | Não é garantido existir em todas versões |
| Inclua `nodeid` | Sempre que possível nos comandos do agente |
| `myparent.nodeid` | Fallback para derivar nodeid da conexão do agente |

### 9.4 Views

| Regra | Detalhe |
|-------|---------|
| Use `.handlebars` | Não `.ejs` — o MeshCentral usa Handlebars |
| `{{var}}` | HTML escapado |
| `{{{var}}}` | HTML cru (para JSON strings) |
| CSP | Respeite o Content-Security-Policy do servidor: sem CDN externo |
| CSS/JS inline | Tudo servido de `'self'` |

### 9.5 Agent Module

| Regra | Detalhe |
|-------|---------|
| `consoleaction()` | Ponto de entrada único para comandos do servidor |
| `mesh.SendCommand()` | Único método para enviar dados ao servidor |
| `require('MeshAgent')` | Disponível após inicialização |
| `require('SimpleDataStore')` | Persistência local no agente |
| Polling | Use `setInterval` para tarefas periódicas |
| Windows-only | Verifique `process.platform !== 'win32'` |

### 9.6 Erros Comuns

| Erro | Causa | Solução |
|------|-------|---------|
| `401 Unauthorized` no admin panel | Plugin não carregou em `obj.plugins` (erro no `require`) OU permissão `view_admin: denied` bloqueia o pré-check | Verificar console do servidor. Trocar default para `allowed` |
| `Failed to lookup view` | Template não encontrado OU extensão errada | Usar `.handlebars` e `res.render('nome')` sem path |
| `sessionEvents missing nodeid` | Agente não inclui `nodeid` no `SendCommand` | Incluir `nodeid: mesh.info._id` no comando |
| CSP bloqueando recursos | CDN externo no template | Inline tudo ou servir de `'self'` |
| Plugin não aparece em `obj.plugins` após Reload | Erro no `require()` ou na constructor | Verificar `console.log` do servidor |

---

## 10. Referência Rápida de Assinaturas

### Hooks Server-Side

```javascript
obj.server_startup()                                                      // void
obj.hook_agentCoreIsStable(myparent, gp)                                  // myparent: agent connection, gp: meshServer
obj.hook_processAgentData(data, nodeid)                                    // data: object, nodeid: string
obj.hook_userLoggedIn(user)                                                // user: {_id, name, siteadmin, ...}
obj.hook_setupHttpHandlers()                                               // void
```

### Handlers

```javascript
obj.serveraction(command, myparent, grandparent)                           // void
obj.handleAdminReq(req, res, user)                                         // void (HTTP)
obj.handleAdminPostReq(req, res, user)                                     // void (HTTP)
```

### Frontend (exportados)

```javascript
obj.onDeviceRefreshEnd(nodeid, panel, refresh, event)                      // void
obj.onDesktopDisconnect()                                                  // void
obj.onWebUIStartupEnd()                                                    // void
obj.goPageStart(index, event)                                              // void
obj.goPageEnd(index, event)                                                // void
```

### Agent-Side

```javascript
function consoleaction(args, rights, sessionid, parent)                    // return string
```

### pluginHandler API

```javascript
parent.registerPermissions(pluginName, permissions)                        // void
parent.getAccessPermissions(pluginName, user, context)                     // Promise → function(permission) → bool
parent.db.getPlugins(callback)                                             // void
parent.db.updatePlugin(id, data)                                           // void
parent.db.getPluginPermissions(pluginName, callback)                       // void
parent.db.setPluginPermissions(pluginName, data, callback)                 // void
```

### meshServer API (acessível via obj.meshServer)

```javascript
obj.meshServer.webserver.wsagents[nodeid]                                 // WebSocket → agente
obj.meshServer.webserver.wssessions2[sessionid]                            // WebSocket → frontend
obj.meshServer.getConfigFilePath(filename)                                 // string → path completo
obj.meshServer.parent.agents[nodeid]                                       // objeto do agente
obj.meshServer.parent.nodes[nodeid]                                        // dados do nó (se disponível)
obj.meshServer.DispatchEvent(targets, sourceObj, message)                  // void
obj.meshServer.debug(module, message)                                      // void
```

---

> **Documento gerado em 23/07/2026** baseado na análise dos 12 plugins listados + código-fonte do `pluginHandler.js` v1.0.0+.
>
> Plugins analisados: ScriptTask, EventLog, RegEdit, RoutePlus, FileDistribution, WorkFromHome, DevTools, Sample, PluginHookScheduler, Agentname2Servername, PrinterControl, PluginHookExample.
