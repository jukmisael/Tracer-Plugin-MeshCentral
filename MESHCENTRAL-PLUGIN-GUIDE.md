# MeshCentral Plugin Development Guide

> **Documento técnico completo (v2.0)** — baseado na análise direta do código-fonte do
> `pluginHandler.js` (`Ylianst/MeshCentral` master), `webserver.js`, `db.js`, e de 13
> plugins da comunidade (ScriptTask, EventLog, RegEdit, RoutePlus, FileDistribution,
> WorkFromHome, DevTools, Sample, PluginHookExample, PluginHookScheduler,
> Agentname2Servername, PrinterControl) — confirmado em ambiente de produção com
> MeshCentral v1.x com 12 agentes.

---

## Sumário

1. [Arquitetura e Cadeia de Objetos](#1-arquitetura-e-cadeia-de-objetos)
2. [Estrutura do Plugin](#2-estrutura-do-plugin)
3. [config.json — Manifesto do Plugin](#3-configjson--manifesto-do-plugin)
4. [Ciclo de Vida do Plugin: Loading → server_startup → Reload](#4-ciclo-de-vida-do-plugin)
5. [Server-Side: Hooks e Funções](#5-server-side-hooks-e-funções)
   - 5.1 [`server_startup()`](#51-server_startup)
   - 5.2 [`hook_agentCoreIsStable(myparent, gp)`](#52-hook_agentcoreisstable)
   - 5.3 [`hook_processAgentData(data, nodeid)`](#53-hook_processagentdata)
   - 5.4 [`serveraction(command, myparent, gp)`](#54-serveraction)
   - 5.5 [`handleAdminReq(req, res, user)` & `handleAdminPostReq`](#55-handleadminreq)
   - 5.6 [`handleAdminPostReq(req, res, user)`](#56-handleadminpostreq)
   - 5.7 Hooks BitCtrl (PluginHookScheduler/PluginHookExample)
   - 5.8 `registerPermissions` (RBAC)
6. [Banco de Dados](#6-banco-de-dados)
   - 6.1 [Backends suportados](#61-backends-suportados)
   - 6.2 [Métodos do `meshServer.db`](#62-métodos-do-meshserverdb)
   - 6.3 [CRUD no `meshServer.db`](#63-crud-no-meshserverdb)
   - 6.4 [Plugin DB próprio (db.js)](#64-plugin-db-próprio-dbjs)
7. [WebSocket: Protocolo frontend ↔ server ↔ agent](#7-websocket-protocolo)
   - 7.1 [Como plugins acessam o WebSocket](#71-como-plugins-acessam-o-websocket)
   - 7.2 [Formato do envelope `{action:'plugin',...}`](#72-formato-do-envelope-actionplugin)
   - 7.3 [Frontend → Server (browser → plugin)](#73-frontend--server-browser--plugin)
   - 7.4 [Server → Frontend (plugin → browser)](#74-server--frontend-plugin--browser)
   - 7.5 [Server → Agent (plugin → MeshAgent)](#75-server--agent-plugin--meshagent)
   - 7.6 [Agent → Server → Frontend (resposta correlacionada)](#76-agent--server--frontend-resposta-correlacionada)
   - 7.7 [`sessionid` — correlação de requisições](#77-sessionid--correlação-de-requisições)
8. [HTTP API (pluginadmin.ashx, /pluginHandler.js, /pluginfile.ashx)](#8-http-api)
9. [Frontend: Templates, Abas e o objeto `pluginHandler`](#9-frontend-templates-abas-e-o-objeto-pluginhandler)
10. [Agent-Side: `modules_meshcore/`](#10-agent-side-modules_meshcore)
11. [Permissões (RBAC) — `registerPermissions` + `getAccessPermissions`](#11-permissões-rbac)
12. [Obtendo Dados Específicos — Referência Completa](#12-obtendo-dados-específicos)
13. [DispatchEvent — Broadcast para todos os browsers](#13-dispatchevent--broadcast-para-todos-os-browsers)
14. [Debug e Diagnóstico](#14-debug-e-diagnóstico)
15. [Erros Comuns e Armadilhas](#15-erros-comuns-e-armadilhas)
16. [Exemplos Completos por Categoria](#16-exemplos-completos-por-categoria)
17. [Versão `prepExports` injetada no navegador](#17-versão-prepexports-injetada-no-navegador)
18. [Glossário de Tipos de Documento do MeshCentral DB](#18-glossário-de-tipos-de-documento-do-meshcentral-db)
19. [Apêndice: Hooks disponíveis no MeshCentral](#19-apêndice-hooks-disponíveis-no-meshcentral)

---

## 1. Arquitetura e Cadeia de Objetos

### Hierarquia de objetos no servidor

```
objeto retornado por module.exports.<shortName>(pluginHandler)
  obj.parent                     = pluginHandler (singleton)
    .parent                      = meshServer (também chamado "main server")
      .db                        = DB abstraction (NeDB|MongoDB|...)
      .webserver                 = objeto retornado por CreateWebServer()
        .wsagents                = { nodeId → agentSession }     (agentes conectados)
        .wssessions              = { userId  → [session,...] }   (websockets de usuários)
        .wssessions2             = { userId+rnd → session }      (mapa por sessionId)
        .users / .meshes         = in-memory caches carregadas do DB
        .express() / .app        = Express app com rotas registradas
      .pluginHandler             = referência ao próprio pluginHandler
      .args                      = argumentos CLI processados (incl. .mongodb)
      .config                    = config.json do servidor
      .debug(...), .getConfigFilePath(name)
      .DispatchEvent(targets, source, event)
      .escapeCodeString(...)
```

### O que existe vs o que NÃO existe

| Tentativa | Resultado | Solução |
|-----------|-----------|---------|
| `meshServer.parent` | `undefined` | Não existe `.parent` no meshServer; só descendo via obj |
| `meshServer.webserver.parent.agentXxx` | … | A partir do agent WS, use `myparent` no `hook_` |
| `meshServer.parent.agents` | `TypeError` | Use `meshServer.webserver.wsagents` |

### Onde o plugin é carregado

`obj.pluginPath = obj.parent.path.join(obj.parent.datapath, 'plugins')`.

Plugins ficam em `<datapath>/plugins/<shortName>/<shortName>.js`.

Existem dois modos de carregar (`pluginHandler.js`, linha 20-35):

1. **Lista estática** em `parent.config.settings.plugins.list` (objeto).
2. **DB-managed**: `parent.db.getPlugins(...)` retornando docs com `status == 1`.

Carregamento real (linha 28):
```js
obj.plugins[plugin.shortName] =
  require(obj.pluginPath + '/' + plugin.shortName + '/' + plugin.shortName + '.js')[plugin.shortName](obj);
obj.exports[plugin.shortName] = obj.plugins[plugin.shortName].exports;
```

Importante: o nome exportado do módulo `module.exports.<shortName>` **deve** ser igual ao `shortName` do config.json, e a fábrica recebe o objeto `pluginHandler` como parâmetro (não o meshServer).

### Cadeia de objetos deduzida via debug (User-Device Tracer v3.2)

```javascript
obj.meshServer.webserver.wsagents      // 12 keys (agentes)
obj.meshServer.webserver.wssessions2   // 1+ keys (sessões admin logadas)
obj.meshServer.db.Get                  // function — callback ~22ms / ~1ms (page cache)
obj.meshServer.getConfigFilePath       // function — path do arquivo DB
obj.meshServer.pluginHandler           // referência ao pluginHandler
obj.meshServer.args                    // argumentos CLI
obj.meshServer.config                  // config geral
obj.meshServer.parentpath              // path do node_modules
obj.meshServer.DispatchEvent           // broadcast
```

---

## 2. Estrutura do Plugin

```
plugin_name/                            # Pasta dentro de <datapath>/plugins/
├── config.json                         # Manifesto (OBRIGATÓRIO)
├── plugin_name.js                      # Server-side factory (OBRIGATÓRIO)
├── db.js                               # Módulo DB próprio (opcional)
├── admin.js                            # Admin handler separado (opcional)
├── modules_meshcore/                   # Agent-side (opcional)
│   ├── mymodule.js                     #   → carregado em TODOS os cores
│   ├── win-myfeature.js                #   → apenas Windows AMT
│   ├── linux-myfeature.js              #   → apenas Linux AMT + Linux no-AMT
│   ├── amt-special.js                  #   → AMT cores (Windows + Linux)
│   └── smbios-extras.js                #   → AMT cores
└── views/                              # Handlebars templates (opcional)
    ├── admin.handlebars                #   Painel admin (`?pin=name&admin=1`)
    ├── device.handlebars               #   Aba do dispositivo (`?pin=name&user=1`)
    └── includes/                       #   Para `?include=1`, retorna CSS/JS
```

### Esqueleto mínimo do plugin JS principal

```javascript
"use strict";
module.exports.<shortName> = function (parent) {     // <-- mesmo nome do shortName!
    var obj = {};
    obj.parent = parent;                            // pluginHandler
    obj.meshServer = parent.parent;                 // meshServer (atalho comum)
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];           // funções expostas ao browser

    obj.server_startup = function () {
        // init do DB próprio, timers, scanners...
    };
    obj.handleAdminReq = function (req, res, user) { /* render admin template */ };
    obj.serveraction = function (command, myparent, gp) { /* dispatch */ };

    return obj;
};
```

---

## 3. `config.json` — Manifesto do Plugin

Validado em `pluginHandler.isValidConfig(conf, url)` (linhas 103-108). Se inválido: `"Error getting plugin config."`.

| Campo | Tipo | Obrigatório | Observação |
|-------|------|-------------|-----------|
| `name` | string | sim | Nome exibido na admin UI |
| `shortName` | string | sim | Nome do `.js`, também usado em `/pluginadmin.ashx?pin=` e em URLs internas |
| `version` | string | semver | Comparada em `versionCompare()` |
| `description` | string | sim | |
| `hasAdminPanel` | boolean | sim | Exibe botão no menu admin |
| `homepage` | string | sim | |
| `changelogUrl` | string | sim | Raw markdown |
| `configUrl` | string | sim | Raw URL para o próprio config.json (usado para updates) |
| `downloadUrl` | string | sim* | ZIP do repo (*obrigatório se `repository.type == 'git'`) |
| `repository.type` | string | sim | `"git"` é o único suportado |
| `repository.url` | string | sim | URL do `.git` |
| `versionHistoryUrl` | string | não | Tags/releases |
| `meshCentralCompat` | string | sim | Ex: `">=1.0.0"`, `">=1.2.0"` |

Regras importantes:
- `shortName` deve ser **alphanumeric** (validado em `handleAdminReq`).
- O ZIP é baixado de `downloadUrl`, descompactado em `<datapath>/plugins/<shortName>/` e ativado via `db.setPluginStatus(id, 1, cb)`.
- "Reload" é feito por `obj.reloadPlugin(name, cb)` que limpa `require.cache` e carrega novamente.

Exemplo (User-Device Tracer):
```json
{
  "name": "User-Device Tracer",
  "shortName": "usertracer",
  "version": "3.5.80",
  "hasAdminPanel": true,
  "homepage": "https://github.com/...",
  "changelogUrl": "https://raw.githubusercontent.com/.../changelog.md",
  "configUrl": "https://raw.githubusercontent.com/.../config.json",
  "downloadUrl": "https://github.com/.../archive/master.zip",
  "repository": { "type": "git", "url": "https://github.com/.../..." },
  "meshCentralCompat": ">=1.0.0"
}
```

---

## 4. Ciclo de Vida do Plugin

Sequência real (extraída de `pluginHandler.installPlugin`, linhas 142-189, e `reloadPlugin` 207-219):

```
installPlugin(id)
  ├─ db.getPlugin(id)
  ├─ download ZIP to <pluginPath>/<shortName>.zip
  ├─ yauzl.extract → <pluginPath>/<shortName>/
  ├─ db.setPluginStatus(id, 1, cb)
  ├─ require(<pluginPath>/<shortName>/<shortName>.js)[shortName](obj)
  ├─ if obj.plugins[sn].server_startup → call it
  └─ parent.updateMeshCore()         ← recomputa os cores com os modules_meshcore

reloadPlugin(name)
  ├─ require.cache[resolvedPath] = null   ← limpa cache
  ├─ delete obj.plugins[name], obj.exports[name]
  ├─ require(...) novamente
  └─ if server_startup → re-executa
```

`parent.updateMeshCore()` regenera os arquivos de `MeshCore.js`/`MeshCmd.exe` no datapath com os módulos de todos os plugins. Isso dispara **reinício dos agentes** na próxima reconexão.

`server_startup` é chamado **uma vez**:
- após `installPlugin` (on-install)
- durante o boot normal do servidor (DB-managed plugins carregados em `parent.db.getPlugins(...)`)
- após `reloadPlugin`

**Limitação importante**: atualizar `config.json` do plugin ou trocar `modules_meshcore/` exige desinstalar e reinstalar (ou atualizar) para que `updateMeshCore()` seja chamado.

---

## 5. Server-Side: Hooks e Funções

O sistema de hooks é **dinâmico**: `obj.callHook(hookName, ...args)` (linhas 58-64) itera `obj.plugins` e invoca o método se existir. Qualquer hook é chamável — não há registro estático.

> **Nota**: hooks específicos do MeshCentral (ex.: `hook_agentCoreIsStable`, `hook_processAgentData`) são chamados de **dentro do core do MeshCentral** (meshagent.js, meshrelay.js, webserver.js). Plugins de terceiros como o **PluginHookScheduler** estendem o sistema criando novos hooks antes/depois de qualquer função do core via `wrapFunctionCall()`. Ver §5.7.

### 5.1 `server_startup()`

Chamado uma vez após o plugin ser carregado ou recarregado.

```javascript
obj.server_startup = function () {
    obj.meshServer.pluginHandler.<shortName>_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
    obj.db = obj.meshServer.pluginHandler.<shortName>_db;
    obj.startScanner();
};
```

Usos típicos: criar DB próprio, iniciar `setInterval` para tarefas periódicas (scanner de 30s do User-Device Tracer, scan de 1 minuto do ScriptTask, scan de 20 min do FileDistribution).

### 5.2 `hook_agentCoreIsStable(myparent, gp)`

Disparado uma vez por agente quando este estabelece conexão estável (após autenticação, capa core pronta).

```javascript
obj.hook_agentCoreIsStable = function (myparent, gp) {
    // myparent = agentSession (tem .nodeid, .agentInfo, .dbNodeKey, .dbMeshKey, .remoteaddr, .authenticated=1)
    // gp       = meshServer (= parent.parent do plugin)
    // EventLog usa:
    myparent.send(JSON.stringify({
        action: 'plugin', pluginaction: 'serviceCheck',
        plugin: 'eventlog', nodeid: myparent.dbNodeKey,
        rights: true, sessionid: true                       // sessionid:true = "ok para responder"
    }));
};
```

### 5.3 `hook_processAgentData(data, nodeid)`

Disparado quando o agente envia dados ao servidor. Invocado para qualquer mensagem de agente cujo `action === 'plugin'` (não foi consumida pelo core).

```javascript
obj.hook_processAgentData = function (data, nodeid) {
    // data.action    = "plugin" | outros
    // data.plugin    = "usertracer" (sempre)
    // data.nodeid    = ID do nó
    // nodeid         = "node//domain/id" (cuidado: pode ser objeto em alguns fluxos)
};
```

Atenção (já documentado no User-Device Tracer): `nodeid` pode vir como **objeto, array ou número** em alguns paths internos do MeshCentral — sempre normalize: `typeof nodeid === 'string' ? nodeid : (nodeid && (nodeid.nodeid || nodeid._id))`.

### 5.4 `serveraction(command, myparent, gp)`

**Ponto único de entrada para todas as mensagens `action:'plugin'` vindas de browser ou agent** (após o core não ter consumido). Ver §7.3 e §7.6.

### 5.5 `handleAdminReq(req, res, user)`

Chamado pelo Express em `GET /pluginadmin.ashx?pin=<shortName>` (linha 282-288 de `pluginHandler.js`):

```javascript
obj.handleAdminReq = function (req, res, user) {
    // req.query.pin     = shortName (já validado alphanumeric)
    // req.query.admin   = "1" para painel admin
    // req.query.user    = "1" para aba dentro do device page
    // req.query.nodeid  = ID do nó (quando user=1)
    // req.query.include = "1" + ?path=X → retorna CSS/JS estático
    // user.name         = username do MeshCentral
    // user._id          = "user//domain/userid"
    // user.siteadmin    = 0xFFFFFFFF = site-admin; 0 = usuário comum; rights OR'd
    // req.session       = presente quando logado

    if (req.query.user == 1) {
        return res.render('device', { nodeid, nodeName });   // aba do dispositivo
    }
    if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
        res.sendStatus(401); return;
    }
    res.render('admin', vars);                                  // painel admin (somente admins)
};
```

Server-side validation (linha 283):
```js
if ((req.query.pin == null) || (obj.common.isAlphaNumeric(req.query.pin) !== true)) {
    res.sendStatus(401); return;
}
```

Rota completa de `webserver.js` (linhas 6895-6920):
```
Express routes (somente registradas se parent.pluginHandler != null):
  GET  /pluginadmin.ashx  → handlePluginAdminReq → pluginHandler.handleAdminReq(req, res, user, obj)
  POST /pluginadmin.ashx  → handlePluginAdminPostReq → pluginHandler.handleAdminPostReq(req, res, user, obj)
  GET  /pluginHandler.js → handlePluginJS → pluginHandler.refreshJS(req, res)
```

> Importante: webserver **muda o diretório `views`** para `<pluginPath>/<pin>/views` antes de chamar seu handler. Use `res.render('admin', vars)` com nome relativo, não absoluto.

### 5.6 `handleAdminPostReq(req, res, user)`

Mesma rota que `handleAdminReq`, mas POST. Body parsed com `bodyParser.urlencoded({ extended: false })`.

### 5.7 Hooks BitCtrl (PluginHookScheduler / PluginHookExample)

Quando você precisa interceptar **qualquer função do MeshCentral core** (não apenas os hooks pré-definidos), use o padrão BitCtrl:

```javascript
// Disponível apenas quando o PluginHookScheduler está ativo.
// Permite adicionar `hook_beforeXxx` e `hook_afterXxx` para qualquer método.

const { PLUGIN_SHORT_NAME } = require('../pluginhookscheduler')({
  __dirname,
  requiredPluginHooks: [
    'hook_beforeCreateMeshAgent',    'hook_afterCreateMeshAgent',
    'hook_beforeCreateMeshRelay',    'hook_afterCreateMeshRelay',
    'hook_beforeCreateLocalRelay',   'hook_afterCreateLocalRelay',
    'hook_beforeCreateMeshUser',     'hook_afterCreateMeshUser',
    'hook_beforeNotifyUserOfDeviceStateChange',
    'hook_afterNotifyUserOfDeviceStateChange',
    'hook_agentWebSocketDisconnected',
  ],
});

server_startup() {
    pluginHandler.wrapFunctionCall(webserver.meshAgentHandler, 'CreateMeshAgent');
    pluginHandler.wrapFunctionCall(webserver.meshRelayHandler, 'CreateMeshRelay');
    // ...
}

hook_afterCreateMeshAgent(meshagent, parent, db, ws, req, args, domain) {
    // meshagent é o objeto criado — pode mutá-lo antes de retornar
    if (meshagent.agentInfo) meshagent.agentInfo.computerName = ...;
    return meshagent;
}
```

Convenção: hooks `hook_beforeXxx(arg1, arg2, ...)` recebem os argumentos; `hook_afterXxx(result, arg1, arg2, ...)` recebem o resultado como primeiro argumento.

### 5.8 `registerPermissions(pluginName, permissions)` (RBAC)

Ver §11 (detalhamento completo).

---

## 6. Banco de Dados

### 6.1 Backends suportados

Definido em `db.js` linha 27-28:
```js
const DB_LIST = ['None', 'NeDB', 'MongoJS', 'MongoDB', 'MariaDB', 'MySQL', 'PostgreSQL', 'AceBase', 'SQLite'];
```

Detecção automática via `parent.args.mongodb`, `parent.args.sqlite3`, etc. Default é NeDB.

### 6.2 Métodos do `meshServer.db`

Operadores genéricos (todos os backends):

| Método | Assinatura | Comportamento |
|--------|-----------|---------------|
| `Get(id, callback)` | `(string, fn(err, docs))` | Retorna **array** (geralmente 0..1 doc), chamado com `docs=[]` se não existe |
| `Set(document, callback?)` | `(doc, fn?)` | Upsert por `_id` |
| `Insert(document, callback?)` | `(doc, fn?)` | Insere novo |
| `Update(query, update, options, callback)` | MongoDB-like | |
| `Remove(id, callback)` | Remove por `_id` |
| `GetAllType(type, callback)` | Filtra por `type` field |
| `GetAllTypeNoTypeField(type, domain, callback)` | Otimizado SQL |

Específicos de plugins (use para guardar config persistente do próprio plugin):
- `db.getPlugins(cb)`, `db.getPlugin(id, cb)`
- `db.addPlugin(cfg, cb)`, `db.updatePlugin(id, cfg, cb)`
- `db.deletePlugin(id, cb)`, `db.setPluginStatus(id, status, cb)` (`status` 1=enabled)
- `db.getPluginPermissions(pluginName, cb)`, `db.setPluginPermissions(name, data, cb)`

**NeDB page cache** medido com 12 agentes:
- Primeira consulta: ~22ms (I/O disco)
- Consultas subsequentes: ~1ms (page cache in-memory)

### 6.3 CRUD no `meshServer.db`

```javascript
// READ - sempre recebe array
obj.meshServer.db.Get('node//domain/nodeid', function(err, docs) {
    if (!docs || !docs.length) return;
    var d = docs[0];            // d._id, d.mtype, d.osdesc, d.users, d.ip, ...
});

// WRITE - Set() é upsert padrão
obj.meshServer.db.Set({
    _id: 'myCustomRecord/123',
    type: 'myCustomRecord',
    domain: 'default',
    customField: 'value'
}, function(err) { ... });

// UPDATE - estilo MongoDB
obj.meshServer.db.Update({ _id: 'x', type: 'foo' }, { $set: { y: 1 } }, {}, function(err) { ... });

// REMOVE
obj.meshServer.db.Remove('myCustomRecord/123', function(err) { ... });

// GETALL por type
obj.meshServer.db.GetAllType('mesh', function(err, docs) { /* docs = todos os meshes */ });
```

### 6.4 Plugin DB próprio (`db.js`)

Padrão recomendado (ScriptTask/EventLog) — abstrai NeDB vs MongoDB:

```javascript
"use strict";
module.exports.CreateDB = function (meshserver) {
    var obj = {};
    var Datastore = null;
    var MongoClient, ObjectID;

    module.paths.push(require('path').join(meshserver.parentpath, 'node_modules'));

    if (meshserver.args.mongodb) {
        // === MongoDB branch (via NEMongo shim) ===
        MongoClient = require('mongodb').MongoClient;
        ObjectID = require('mongodb').ObjectID;
        MongoClient.connect(meshserver.args.mongodb, { useNewUrlParser: true, useUnifiedTopology: true }, function (err, client) {
            var db = client.db(meshserver.args.mongodbname || 'meshcentral');
            obj.myCollection = db.collection('plugin_<shortName>');
            obj.myCollection.createIndex({ type: 1 });
        });
    } else {
        // === NeDB branch ===
        try { Datastore = require('@seald-io/nedb'); } catch (ex) {}
        if (!Datastore) try { Datastore = require('@yetzt/nedb'); } catch (ex) {}
        if (!Datastore) Datastore = require('nedb');

        obj.myCollection = new Datastore({
            filename: meshserver.getConfigFilePath('plugin-<shortName>.db'),
            autoload: true
        });
        obj.myCollection.setAutocompactionInterval(60000);
        obj.myCollection.ensureIndex({ fieldName: 'type' });
    }

    // Helpers
    var formatId = function(id) {
        if (meshserver.args.mongodb && typeof ObjectID === 'function') {
            try { return new ObjectID(id); } catch (e) { return id; }
        }
        return id;
    };

    obj.insert = function(doc) {
        if (meshserver.args.mongodb) obj.myCollection.insertOne(doc);
        else obj.myCollection.insert(doc);
    };

    obj.find = function(query, cb) {
        if (meshserver.args.mongodb) obj.myCollection.find(query).toArray(cb);
        else obj.myCollection.find(query).exec(cb);
    };

    obj.update = function(id, args) {
        id = formatId(id);
        if (meshserver.args.mongodb) return obj.myCollection.updateOne({ _id: id }, { $set: args });
        else return obj.myCollection.update({ _id: id }, { $set: args });
    };

    obj.delete = function(id) {
        id = formatId(id);
        if (meshserver.args.mongodb) return obj.myCollection.deleteOne({ _id: id });
        else return obj.myCollection.deleteOne({ _id: id });
    };

    return obj;
};
```

Convenções:
- Use `meshserver.getConfigFilePath('plugin-<shortName>-suffix.db')` para path absoluto.
- Defina TTL no MongoDB: `createIndex({ time: 1 }, { expireAfterSeconds: 2592000 })`.
- NeDB TTL: `ensureIndex({ fieldName: 'time', expireAfterSeconds: 2592000 })`.
- Use um campo `type` para "tabela polimórfica" (ver ScriptTask: `script`, `folder`, `job`, `jobSchedule`, `variable`).

---

## 7. WebSocket: Protocolo `frontend ↔ server ↔ agent`

### 7.1 Como plugins acessam o WebSocket

Tudo via `obj.meshServer.webserver`:

| Estrutura | Conteúdo | Uso típico |
|-----------|----------|-----------|
| `wsagents` | `{ nodeId → agentSession }` | Enviar comando a um agente: `wsagents[nid].send(JSON.stringify(cmd))` |
| `wssessions2` | `{ 'user/<dom>/<user>/<rnd>' → browserSession }` | Enviar msg ao browser que originou a requisição |
| `wssessions` | `{ userId → [browserSession,...] }` | Broadcast para todas as sessões de um usuário |
| `users` / `meshes` | In-memory caches | Permissões, mesh keys, etc. |

> Confirmação via debug User-Device Tracer: `wsagents` tem 12 keys (11 Win + 1 Linux), `wssessions2` tem 1 key (admin logado).

### 7.2 Formato do envelope `{action:'plugin',...}`

Todos os comandos de plugin usam este envelope:

```json
{
  "action": "plugin",         // ← obrigatório, identifica como mensagem de plugin
  "plugin": "<shortName>",    // ← roteamento server-side (pluginHandler.callHook)
  "method": "<frontend-fn>",  // ← usado em server→frontend (handler no pluginHandler)
  "pluginaction": "<verb>",   // ← usado em frontend→server (entra em serveraction)
  "nodeid": "node//...",      // ← opcional, injetado em algumas rotas
  "userid": "user//...",      // ← INJETADO AUTOMATICAMENTE pelo MeshCentral!
  "sessionid": "<sid>",       // ← para correlação agent→frontend (ver §7.7)
  "...": "<campos do verbo>"
}
```

### 7.3 Frontend → Server (browser → plugin)

O frontend chama `ms.send(...)` onde `ms = parent.meshserver` no contexto do iframe/tab.

**No iframe device**: o `ms` é acessível via `top.meshserver`.

```javascript
// === Exemplo concreto do User-Device Tracer ===
if (ms) {
    var _s = ++_reqSeq;
    ms.send({
        action: 'plugin',
        plugin: 'usertracer',
        pluginaction: 'getTimeline',
        nodeid: n,
        startDate: new Date(pr.rs).toISOString(),
        endDate:   new Date(pr.re).toISOString(),
        limit: 8000,
        _reqSeq: _s
    });
}
```

Quando chega no servidor, o core do MeshCentral já adiciona:
- `command.userid` = `"user//<dom>/<userid>"`
- (às vezes) `command.nodeid` se a chamada veio de uma tab de device

E então roteia para `pluginHandler.callHook('serveraction', command, myparent, grandparent)` em cada plugin.

### 7.4 Server → Frontend (plugin → browser)

Três padrões suportados:

**(a) Sessão única (resposta a uma requisição):**
```javascript
// User-Device Tracer - getCurrentUsers
obj.send = function(sid, data) {
    if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) {
        obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data));
    }
};
// Uso:
var sid = myparent.ws.sessionId; // 'user//<dom>/<user>/<rnd>'
obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: [...]} );
```

**(b) Broadcast para todas as sessões logadas — `DispatchEvent`:**
```javascript
// ScriptTask - updateFrontEnd
var targets = ['*', 'server-users'];
obj.meshServer.DispatchEvent(targets, obj, {
    nolog: true,
    action: 'plugin',
    plugin: 'scripttask',
    pluginaction: 'historyData',     // ou pluginaction OU method
    scriptId: ids.scriptId, nodeId: null,
    scriptHistory: sh, nodeHistory: null, scriptSchedule: ss
});
```

`DispatchEvent(targets, source, event)` resolve `targets` para uma lista de sessions e envia para cada uma. `targets`:
- `'*'` — todos os admins
- `'server-users'` — todos os usuários logados
- `'user/<dom>/<userid>'` — um usuário
- `'server-admins'` — somente site-admins

**(c) Via `obj.parent.send(...)`** (helpers, menos comum em plugins).

### 7.5 Server → Agent (plugin → MeshAgent)

```javascript
// ScriptTask - queueRun
var jObj = {
    action: 'plugin',
    plugin: 'scripttask',
    pluginaction: 'triggerJob',
    jobId, scriptId, replaceVars, scriptHash, dispatchTime
};
obj.meshServer.webserver.wsagents[job.node].send(JSON.stringify(jObj));
```

**Formas comuns** (todas via WebSocket do agente):
```javascript
function sendToAgent(nodeid, command) {
    var agent = obj.meshServer.webserver.wsagents[nodeid];
    if (!agent) return false;
    try { agent.send(JSON.stringify(command)); return true; } catch (ex) { return false; }
}

// RegEdit:
obj.sendToAgent(command.nodeid, {
    action: 'plugin', plugin: 'regedit', pluginaction: 'enumKey',
    hive, path, sessionid: ws.sessionId        // ← sessionid para correlação
});

// EventLog (dentro de hook_agentCoreIsStable):
myparent.send(JSON.stringify({
    action: 'plugin', pluginaction: 'serviceCheck',
    plugin: 'eventlog', nodeid: myparent.dbNodeKey,
    rights: true, sessionid: true              // ← sessionid=true = correlação habilitada
}));
```

### 7.6 Agent → Server → Frontend (resposta correlacionada)

O agent responde com a mesma estrutura e inclui um campo que o MeshCentral usa para roteamento. Há dois sub-fluxos:

**(a) Plugin handler nativo do MeshCentral** (regra geral):

Quando o server recebe `action:'plugin'` do agente:
1. Tenta rotear para o plugin que tem um `hook_processAgentData`.
2. Se o plugin define `serveraction` E `command.sessionid` é uma string válida de sessão, o core já faz roteamento direto para `wssessions2[command.sessionid]`.

Padrão EventLog (linha 62-77):
```javascript
case 'sendlog': {
    command.method = 'fe_on_message';          // ← handler do frontend
    var splitsessionid = command.sessionid.split('/');
    if ((splitsessionid[0] == 'user') && (splitsessionid[1] == myobj.parent.domain.id)) {
        var ws = grandparent.wssessions2[command.sessionid];
        if (ws != null) {
            command.nodeid = parent.dbNodeKey;
            delete command.sessionid;
            try { ws.send(JSON.stringify(command)); } catch (ex) {}
        }
    }
    break;
}
```

**(b) Resposta manual com `sessionid` (RegEdit, PrinterControl):**

O plugin controla 100% via `sessionid`:
```javascript
// Server recebe 'enumKeyResult' do agent
case 'enumKeyResult': case 'getValueResult': case 'setValueResult': /* ... */ {
    var targetSessionid = command.sessionid;
    var response = {
        action: 'plugin', plugin: 'regedit',
        method:  'loadKeyData',                  // ← frontend function
        method2: command.pluginaction.replace('Result', ''),
        success: command.success, error: command.error,
        data: command.data, nodeid: command.nodeid
    };
    if (targetSessionid && obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[targetSessionid]) {
        obj.meshServer.webserver.wssessions2[targetSessionid].send(JSON.stringify(response));
    }
    break;
}
```

Vantagem: controle total sobre o nome do método frontend.

### 7.7 `sessionid` — correlação de requisições

Existem dois modos:

**Modo legacy (`sessionid:true`)**: usado quando você envia um comando direto pelo `myparent.send(...)` no `hook_agentCoreIsStable`. O MeshCentral interpreta `true` como "use este session para responder".

**Modo explícito**: você lê o `sessionid` da sessão do browser (`myparent.ws.sessionId`) e envia com o comando:
```javascript
var sessionid = myparent.ws.sessionId;    // 'user//<dom>/<userid>/<rnd>'
sendToAgent(command.nodeid, { ..., sessionid: sessionid });
```

Depois roteia a resposta via `wssessions2[sessionid]`.

**Modo requestId (PrinterControl)**: para operações independentes (não streaming):
```javascript
var requestId = crypto.randomBytes(18).toString("hex");
obj.pending[requestId] = { nodeid, operation, params, session, userid, timer };
sendToAgent(command.nodeid, { ...pluginaction, params, requestId });

// Quando o agent responder com operationResult:
var pending = obj.pending[command.requestId];
sendToSession(pending.session, browserMessage('result', { requestId, operation, success, data }));
```

---

## 8. HTTP API

Rotas registradas em `webserver.js` (linhas 7463-7467) **somente se `parent.pluginHandler != null`**:

| Método | Rota | Handler | Observação |
|--------|------|---------|-----------|
| GET   | `/pluginadmin.ashx?pin=<shortName>` | `handlePluginAdminReq` → `pluginHandler.handleAdminReq` | Admin panel e device tab |
| POST  | `/pluginadmin.ashx?pin=<shortName>` | `handlePluginAdminPostReq` → `pluginHandler.handleAdminPostReq` | Body URL-encoded |
| GET   | `/pluginHandler.js` | `handlePluginJS` → `pluginHandler.refreshJS` | Retorna o JS injetado com `pluginHandler = new pluginHandlerBuilder();` |

Antes de chamar o handler do plugin, o `webserver.js` valida:
1. `checkUserIpAddress(req, res)` — filtra IPs permitidos
2. `req.session.userid` deve existir
3. `obj.users[req.session.userid]` deve existir (i.e., login válido)
4. `req.query.pin` deve ser alfanumérico
5. `pluginHandler.handleAdminReq` então define `serv.app.set('views', path.join(pluginPath, req.query.pin, 'views'))` e chama seu handler

### Por que Handlebars e não EJS

MeshCentral usa **express-handlebars** (importado em `webserver.js` como `obj.exphbs`). Ao chamar `res.render('admin', vars)`, o Express resolve para `views/admin.handlebars` *dentro do diretório `views` do plugin* — sem path absoluto.

`res.render(__dirname + '/views/admin', vars)` **NÃO funciona** porque o Express concatena `'views/' + name + '.handlebars'`. Use sempre `'admin'` (relativo).

---

## 9. Frontend: Templates, Abas e o Objeto `pluginHandler`

### 9.1 Como o frontend obtém `pluginHandler`

A página principal do MeshCentral carrega `/pluginHandler.js` em todas as páginas autenticadas. Esse endpoint (`refreshJS`, linhas 54-57):

```js
res.set('Content-Type', 'text/javascript');
res.send('pluginHandlerBuilder = ' + obj.prepExports() + '\r\n' +
         ' pluginHandler = new pluginHandlerBuilder();' +
         ' pluginHandler.callHook("onWebUIStartupEnd");');
```

**`prepExports()`** (linhas 36-53) gera uma string JS com a forma:
```javascript
function() {
  var obj = {};
  obj.<shortName> = {};
  obj.<shortName>.<exportFnName1> = <functionSource>; // ← serializado via .toString()
  obj.<shortName>.<exportFnName2> = <functionSource>;
  ...
  obj.callHook = function(hookName, ...args) {
    for (const p of Object.keys(obj)) {
      if (typeof obj[p][hookName] == 'function') obj[p][hookName].apply(this, args);
    }
  };
  return obj;
}
```

Isto é executado no navegador, criando um objeto global `pluginHandler.<shortName>.<exportFn>`.

### 9.2 Helpers injetados

Junto com seus exports, o `pluginHandlerBuilder` expõe:

| Helper | Função |
|--------|--------|
| `pluginHandler.callHook(hookName, ...args)` | Chama `hookName` em todos os `<shortName>` registrados (se existir) |
| `pluginHandler.<shortName>.<fn>` | Sua função exportada |
| `pluginHandler.registerPluginTab({tabId, tabTitle})` | Cria `<span id="p19ph-<tabId>"></span>` e `<div id="<tabId>">` |
| `pluginHandler.callPluginPage(id, el)` | Ativa a tab (igual ao clicar) |
| `pluginHandler.refreshPluginHandler()` | Recarrega `/pluginHandler.js` |
| `pluginHandler.addPluginEx(...)` / `addPluginDlg(...)` | Helpers de modal/dialog (alguns plugins usam) |

### 9.3 Tabs do plugin

**Padrão antigo** (`registerPluginTab` na página):
```javascript
// ScriptTask (linha 19-22)
obj.onDeviceRefreshEnd = function() {
    pluginHandler.registerPluginTab({ tabTitle: 'ScriptTask', tabId: 'pluginScriptTask' });
    QA('pluginScriptTask', '<iframe id="pluginIframeScriptTask" style="width:100%;height:700px" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=scripttask&user=1" />');
};
```

Resultado: na aba do dispositivo, abre um iframe que aponta para o device handlebars do plugin.

**Padrão `on_device_header` / `on_device_page`** (regra geral — visto em PluginHookScheduler e EventLog):
```javascript
obj.on_device_header = function() {
    return '<span>...</span>';
};
obj.on_device_page = function() {
    return '<div id=pluginEventLog></div>';
};
```
Esses são coletados por `pluginHandler.deviceViewPanel()` (linhas 94-102) e renderizados **dentro do DOM do MeshCentral**, não em iframe. Permite acesso direto a `currentNode`, `meshserver`, `nodes`, `attemptWebRTC`, `authCookie`, `serverPublicNamePort`, `authRelayCookie`, `domainUrl` (variáveis globais injetadas pelo MeshCentral).

### 9.4 Identificando browser → agent no iframe vs in-page

| Modo | `meshserver` | Acesso às globais |
|------|--------------|-------------------|
| **Iframe** (`?pin=...&user=1`) | `top.meshserver` (porque o iframe é separado) ou `window.meshserver` no topo | **Limitado** — `parent.meshserver.send(...)` em algumas versões |
| **In-page** (`on_device_page`) | `meshserver` (variável global direta) | **Total** — `currentNode`, `meshserver`, `nodes`, `Q()`, `QH()`, `QA()` helpers, `CreateAgentRedirect()`, etc. |

Iframe sandboxes têm **Content Security Policy**. Scripts inline são bloqueados. Use `addEventListener('message', ...)` para ouvir mensagens do parent (não `onmessage` se for sobrescrito pelo MeshCentral).

EventLog usa **modo in-page** (linhas 32-49 de `eventlog.js`) para criar uma conexão de live logging com o agente:
```javascript
pluginHandler.eventlog.livelog = CreateAgentRedirect(
    meshserver, pluginHandler.eventlog.createRemoteEventLog(pluginHandler.eventlog.fe_on_message),
    serverPublicNamePort, authCookie, authRelayCookie, domainUrl
);
pluginHandler.eventlog.livelog.Start(pluginHandler.eventlog.livelognode._id);
```

### 9.5 Lidando com handlers backend duplos

O MeshCentral **às vezes** chama `pluginHandler.<shortName>.<method>` automaticamente quando o server envia `action:'plugin', method:'X'`. Isso significa que você pode registar handlers de **duas formas**:

```javascript
// Em um handlebars do plugin (iframe):
(function() {
    var ph = (top && top.pluginHandler && top.pluginHandler.usertracer) ||
             (parent && parent.pluginHandler && parent.pluginHandler.usertracer);
    if (ph) {
        ph.timeline = function(message) { renderTimeline(message.data); };
        // ou ph.deviceNames = function(msg) { ... };  (compat opcional)
    }
    // E TAMBÉM listener no WebSocket RAW, para os casos onde o framework não roteou:
    if (ms && ms.socket) {
        ms.socket.addEventListener('message', function(e) {
            try {
                var d = JSON.parse(e.data);
                if (d.action === 'plugin' && d.plugin === 'usertracer') {
                    if (d.method === 'deviceNames') renderDeviceNames(d.data || []);
                    else if (d.method === 'userNames') renderUserNames(d.data || []);
                }
            } catch (ex) {}
        });
    }
})();
```

**Best practice**: use **sempre** o listener RAW (`addEventListener('message', ...)` no `ms.socket`) — é o único caminho confiável. Nunca use `ms.onMessage` (sobrescreve o do framework), nem `ms.socket.onmessage = fn` (substitui listeners e só permite um).

---

## 10. Agent-Side: `modules_meshcore/`

### 10.1 Como é injetado

`pluginHandler.addMeshCoreModules(modulesAdd)` (linhas 65-93) lê `modules_meshcore/*.js` e injeta em `windows-amt`/`linux-amt`/etc. via `addModule("<name>", "<escaped-source>");`.

**Convenção de prefixo** controla para quais cores o módulo vai:
| Prefixo do arquivo | Cores incluídos |
|--------------------|----------------|
| `amt-...` ou `smbios.js` | `windows-amt` + `linux-amt` |
| `win-...` | `windows-amt` |
| `linux-...` | `linux-amt` + `linux-noamt` |
| (sem prefixo) | `windows-amt` + `linux-amt` + `linux-noamt` |

Todos esses arquivos ficam embutidos no binário `MeshCore.js`/`MeshCmd` que o servidor entrega aos agentes. Mudanças em `modules_meshcore/` exigem **reinício dos agentes** para que peguem o novo bundle.

### 10.2 Esqueleto agent-side

```javascript
"use strict";
var mesh = null;
var debug_flag = false;

function dbg(str) {
    if (debug_flag !== true) return;
    var fs = require('fs');
    var log = fs.createWriteStream('plugin.txt', { flags: 'a' });
    log.write('\n' + new Date().toLocaleString() + ': ' + str);
    log.end('\n');
}

// Padrão ScriptTask - SEMPRE exporte consoleaction
function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;        // parent = o objeto MeshAgent (o "mesh" host)
    switch (args.pluginaction) {
        case 'start':          start(); break;
        case 'setDebug':       debug_flag = (args.value === 'true'); break;
        case 'stop':           stop(); break;
        default: console.log('PLUGIN: scripttask agent: unknown action: ' + args.pluginaction);
    }
    return 'OK';
}

// Expor para o lado server
exports.consoleaction = consoleaction;

// Auto-start (sem argumentos)
if (typeof setInterval !== 'undefined') {
    setTimeout(function() {
        try {
            if (process.platform === 'win32') {
                mesh = require('MeshAgent');
                start();
            } else if (process.platform === 'linux') {
                mesh = require('MeshAgent');
                start();
            }
        } catch (e) {}
    }, 5000);
}
```

**Comunicação agent → server** (a partir do módulo):
```javascript
function sendResultToServer(result) {
    mesh.SendCommand({
        action: 'plugin',
        plugin: 'scripttask',
        pluginaction: 'jobComplete',   // ou qualquer verb
        nodeid: mesh.info._id,         // ← CRÍTICO: inclua o nodeid
        jobId: '...', retVal: result
    });
}
```

**Detecção de plataforma** (ScriptTask) usa prefixo do nome do arquivo (`win-`/`linux-`/etc.). Em `win-` só envia para Windows; em `linux-` só para Linux, etc.

### 10.3 Hooks agent-side disponíveis (legado)

Em `scripttask.js` e similares, há referência a:
- `hook_agentCoreIsStable` (server-side callback; o agent-side chama por SendCommand durante init)
- `hook_processAgentData` (server-side callback; cada plugin message do agent entra aqui)

No agent, **o módulo só responde a comandos via `consoleaction`**. Não existe sistema automático de hooks no agent — tudo é polling ou baseado em eventos do MeshAgent.

### 10.4 Arquivos especiais recovery

Linhas 64 (aprox.) de `addMeshCoreModules` — os módulos `win-console`, `win-message-pump`, `win-terminal` são adicionalmente injetados em `windows-recovery` e `windows-agentrecovery`.

---

## 11. Permissões (RBAC)

### 11.1 Modelo de 3 níveis

**Cascata** (ver `checkPluginPermission` linhas 249-281):
1. **node override** — `permConfig.nodeOverrides[<nodeId>]`
2. **mesh override** — `permConfig.meshOverrides[<meshId>]`
3. **global** — `permConfig.allowed.users` ou `denied.users`
4. **default** — registrado em `registerPermissions`

Cada usuário/perm tem `allowed`/`denied` (não `inherited`). Avaliação:
- `allowed.users` contém `user._id` → `allowed`
- `denied.users` contém `user._id` → `denied`
- Senão → `inherited` (sobe pro próximo nível)

Site-admin (`user.siteadmin === 0xFFFFFFFF`) **sempre** retorna `true`.

### 11.2 Registrando suas permissões

```javascript
server_startup() {
    obj.parent.registerPermissions('myplugin', {
        can_view:  { title: 'View data',  desc: 'Read-only access',  default: 'denied' },
        can_write: { title: 'Modify data', desc: 'Create/edit/delete', default: 'denied' },
        can_admin: { title: 'Administer plugin', desc: 'Admin only', default: 'denied' }
    });
}
```

### 11.3 Checando permissões

```javascript
async function checkAccess(user, nodeid) {
    const hasPermission = await obj.parent.getAccessPermissions('myplugin', user, { nodeid });
    if (!hasPermission('can_view')) throw new Error('Forbidden');
    return hasPermission;
}

// Forma compacta:
const allowedPerms = await hasPermission('_ALL_'); // ['can_view'] por exemplo
```

`getAccessPermissions` (linhas 234-248) resolve meshId do node via DB, depois retorna uma função:
```javascript
function(permission) {
    if (permission == '_ALL_') return allowedPerms;
    return allowedPerms.indexOf(permission) >= 0;
}
```

### 11.4 Permissões legadas (EventLog, etc.)

```javascript
obj._pluginPermissions = function() { return { "deviceLiveTab": "Event Log: Live Tab" }; };
obj.exports = ['_pluginPermissions', /*...*/];
```

Funciona em plugins antigos mas é API deprecated.

### 11.5 Node rights + ACL adicional

Para checar acesso ao nó em si (independente de perm do plugin), use o helper do webserver:
```javascript
webserver.GetNodeWithRights(domain, user, nodeid, function(node, rights) {
    if (!node || rights === 0) { /* Forbidden */ }
});
```

`PrinterControl` (linhas 74-80 do printercontrol.js) combina os dois:
```javascript
function withNodeRights(session, webserver, nodeid, callback) {
    var user = session && session.user, domain = session && session.domain;
    webserver.GetNodeWithRights(domain, user, nodeid, function(node, rights) {
        if (!node || rights === 0) { callback(new Error('denied')); return; }
        callback(null, node, rights, user);
    });
}
```

---

## 12. Obtendo Dados Específicos

### 12.1 Agentes conectados (de `wsagents`)

```javascript
var ws = obj.meshServer.webserver.wsagents || {};
for (var nid in ws) {
    var a = ws[nid];
    // a.nodeid, a.name, a.agentInfo = {computerName, agentVersion, platformType, ...}
    // a.remoteaddr, a.connectTime, a.domain, a.meshid
    // a.dbNodeKey = "node/<domain>/<id>"
    // a.dbMeshKey = "mesh/<domain>/<id>"
    // a.authenticated (0|1|2+), a.name ('Computer Name')
}
```

Exemplo prático (ScriptTask queueRun): `Object.keys(wsagents)` para obter agentes ativos. Combinado com `obj.db.getPendingJobs(ids)`, encontra jobs para rodar.

### 12.2 Detalhes de um agente (de `db.Get`)

```javascript
obj.meshServer.db.Get(nodeid, function(err, docs) {
    if (!docs || !docs.length) return;
    var d = docs[0];
    // d._id, d.name, d.domain, d.meshid, d.mtype (1=Linux/Mac, 2=Windows)
    // d.host, d.icon, d.osdesc, d.ip, d.hostname
    // d.users = ['DOMAIN\username', ...]      ← usuários ativos
    // d.lusers = ['DOMAIN\username', ...]     ← com status de bloqueio
    // d.upnusers = ['user@domain.com', ...]   ← UPN format
    // d.firstconnect, d.lastbootuptime, d.idletime
    // d.wsc (Windows Security Center), d.av (antivírus)
    // d.defender (bool), d.agent = versão
    // d.pwr (power state), d.conn (connection state)
    // d.lastconnect (timestamp)
    // d.tag (custom tag), d.rname (real name)
});
```

### 12.3 Informações de usuário

```javascript
var userDoc = obj.meshServer.webserver.users['user//domain/userid'];
// userDoc.name, .email, .domain, .links (perm), .siteadmin, .realname, .phone
// userDoc.groups = ['meshid', ...]
// userDoc.creation, .login, .access
```

### 12.4 Meshes (device groups)

```javascript
var meshes = obj.meshServer.webserver.meshes;
for (var mid in meshes) {
    var m = meshes[mid];
    // m.name, m.desc, m.domain, m.mtype
    // m.links = { 'user/<dom>/<user>': {rights: 4}, ... }
    // m.nodes (lista de node IDs)
    // m.agentCertificate, m.agentCertificateHash
    // m.amt (Intel AMT config), m.kvm (IP-KVM config)
}
```

### 12.5 Sessionid de um frontend request

```javascript
// Dentro de serveraction:
var sessionid = null;
try { sessionid = myparent.ws.sessionId; } catch (e) {}
// sessionid = "user//<domain>/<userid>/<randomhash>"
```

### 12.6 Identificando o usuário logado numa sessão

```javascript
// No server-side, dentro de serveraction:
var user = myparent.user;          // ou myparent.dbUser
// user._id = "user/<dom>/<userid>"
// user.name, user.siteadmin, ...
```

### 12.7 Commandos úteis do meshServer

```javascript
obj.meshServer.dispatchEventToAgent(nodeid, command, callback); // (pode não existir — verifique)
obj.meshServer.DispatchEvent(targets, source, event);           // broadcast para browsers
obj.meshServer.getConfigFilePath(filename);                      // resolve <datapath>/<file>
obj.meshServer.UpdateServerStats(...);
obj.meshServer.GetConnectivityState(nodeid);                     // 'connected'|'connecting'|null
obj.meshServer.parentpath;                                       // path dos node_modules
obj.meshServer.escapeCodeString(str);                            // usado pelo prepExports
obj.meshServer.debug('plugin:name', 'message');                  // logger do server
obj.meshServer.updateMeshCore();                                 // regenera MeshCore para os agents
```

---

## 13. DispatchEvent — Broadcast para todos os browsers

`meshServer.DispatchEvent(targets, source, event)` resolve `targets` e envia `event` para cada session que match.

`targets` aceita:
- `'*'` — todos
- `'<userid>'` (`'user//domain/userid'`) — um usuário
- `'server-users'`, `'server-admins'` — grupos especiais
- Array de strings — combinação

```javascript
// Exemplo: notificar todos os browsers que o histórico mudou
obj.meshServer.DispatchEvent(
    ['*', 'server-users'],
    obj,
    {
        nolog: true,                      // não loga no servidor (opcional)
        action: 'plugin',
        plugin: 'scripttask',
        pluginaction: 'historyData',
        scriptId: sid, nodeId: null,
        scriptHistory: sh, nodeHistory: null, scriptSchedule: ss
    }
);
```

Resultado: todos os `pluginHandler.<shortName>.historyData(message)` registrados são chamados.

---

## 14. Debug e Diagnóstico

### 14.1 Server-side: `console.log` + `obj.debug`

```javascript
console.log('[UT] startup');
obj.debug('plugin:usertracer', 'Starting scanner');
```

`obj.debug(...)` só imprime se o MeshCentral foi iniciado com `--debug`. Use para saídas condicionado a flag de debug do servidor.

### 14.2 Frontend: collapsible debug panel

```html
<div id="dbgToggle" onclick="var e=document.getElementById('debug');e.style.display=e.style.display==='none'?'block':'none'">🔽 Debug</div>
<div id="debug" style="display:none;font-size:9px;font-family:monospace;max-height:200px;overflow:auto"></div>
<script>
var D = [];
function dlog() {
    var args = Array.prototype.slice.call(arguments);
    D.push(new Date().toLocaleTimeString() + ' ' + args.join(' '));
    document.getElementById('debug').innerHTML = D.slice(-80).join('\n');
    console.log('[PLUGIN]', args.join(' '));
}
</script>
```

### 14.3 WebSocket trace completo

```javascript
if (ms && ms.socket) {
    var orig = ms.socket.onmessage;
    ms.socket.addEventListener('message', function(ev) {
        var raw = ev.data;
        console.log('[WS RAW]', raw.length, raw.substring(0, 300));
        try {
            var p = JSON.parse(raw);
            console.log('[WS PARSED]', p.action, p.plugin, p.method, p.pluginaction);
        } catch (e) {}
    });
}
```

**Importante**: use `addEventListener` (não `onmessage=`) para não sobrescrever listeners do framework.

### 14.4 Verificando carregamento do plugin

```bash
# Tail do console do servidor ao instalar/recarregar:
sudo journalctl -u meshcentral -f
# Procure por:
#   "Loading plugin: <shortName>"
#   "Error loading plugin: <stack>"
#   "Error in plugin hook <sn>:<hook>: <stack>"
```

---

## 15. Erros Comuns e Armadilhas

| Erro / Sintoma | Causa | Solução |
|-----------------|-------|---------|
| `Error getting plugin config. Check that you have valid JSON.` | config.json inválido (campos faltando) | Ver §3 |
| 401 no admin panel | Plugin não carregou | `console.log` em cada passo do require() |
| `Cannot read 'agents' of undefined` | tentou `meshServer.parent.agents` | Use `meshServer.webserver.wsagents` |
| `Cannot find module 'nedb'` | NeDB não disponível | Cadeia `@seald-io/nedb` → `@yetzt/nedb` → `nedb` |
| `Failed to lookup view "X"` | `res.render(__dirname + '/views/X')` | Use `res.render('X')` (relativo); nome de arquivo **handlebars** |
| Handler frontend recebe objeto `meshserver` em vez de `data` | framework interceptou `obj[p][method]` e chamou na inicialização | Use listener em `ms.socket.addEventListener('message', ...)` |
| `_reqUser` chega com valor antigo | Race condition de requests | Echo de `_reqSeq` no request, ignore se `_reqSeq !== _reqSeq` |
| Plugin instala mas não vê `modules_meshcore` atualizado | `updateMeshCore()` não foi chamado | Reinstalar plugin (não recarregar); agentes precisam reconectar |
| `TypeError: nodeid.substring is not a function` | `hook_processAgentData` recebe nodeid não-string | `typeof nodeid === 'string' ? nodeid : (nodeid.nodeid || nodeid._id)` |
| `401 ref error` após `reloadPlugin` | `require.cache` não foi limpo | Sim: `reloadPlugin` em `pluginHandler.js` já cuida |
| CSP bloqueia `<script>` inline no iframe | sandbox do iframe | Use `<script>` em arquivo `.js` externo via `?include=1` |
| Browser fica preso em "Carregando..." | device.handlebars usando `top.meshserver` mas está em iframe aninhado | Tente `parent.meshserver`, `window.meshserver` ou `top.meshserver` |
| `setInterval` continua após reload | sem `clearInterval` | Adicionar `obj.scanTimer && clearInterval(obj.scanTimer)` em reload |
| Frontend `onMessage` é chamado com `meshserver` em vez de dados | framework já consumiu msg via `pluginHandler.<shortName>.<method>` | Hook no `pluginHandler.<shortName>.<method>` (aceita), mas **também** coloque listener no `ms.socket` para ser resiliente |
| Plugin desinstalado mas arquivos persistem | ZIP extraction cria diretórios | Delete manual em `<datapath>/plugins/<shortName>/` |
| `registerPermissions` não tem efeito | chamou em lugar errado | Chame em `server_startup()` |
| Iframe aponta para `?pin=X` mas dá 404 | plugin reinstalado mudou o `shortName` | Limpar cache do browser / atualizar URL |
| `obj.plugins[sn].handleAdminReq is not a function` | esqueceu de exportar | Adicione `obj.handleAdminReq = function(req,res,user){...}` |
| `req.query.user == 1` mas renderiza errado | esqueceu de diferenciar admin vs user | Ver §5.5 |
| `os.tmpdir()` em path upload não permitido | webserver usa `safeUploadTempPath` | Use `path.join(obj.parent.filespath, 'tmp/...')` |

---

## 16. Exemplos Completos por Categoria

### 16.1 Mínimo absoluto — `Sample`

```javascript
"use strict";
module.exports.sample = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.exports = ["onDesktopDisconnect"];

    obj.onDesktopDisconnect = function() {
        // chamado quando uma sessão de desktop fecha
        writeDeviceEvent(encodeURIComponent(currentNode._id));
        Q('d2devEvent').value = Date().toLocaleString() + ': ';
        focusTextBox('d2devEvent');
    };

    return obj;
};
```

### 16.2 Plugin Admin com DB próprio — `DevTools`

(50 linhas completas)

```javascript
"use strict";
module.exports.devtools = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.VIEWS = __dirname + '/views/';

    obj.handleAdminReq = function(req, res, user) {
        if ((user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render(obj.VIEWS + 'admin', {});
    };

    obj.serveraction = function(command, myparent, grandparent) {
        switch (command.pluginaction) {
            case 'addPluginConfig':
                if (command.cfg.status == null) command.cfg.status = 1;
                obj.meshServer.db.addPlugin(command.cfg, function() {
                    obj.meshServer.db.getPlugins(function(err, docs) {
                        try { myparent.ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) {}
                    });
                });
            break;
            case 'refreshPluginHandler':
                obj.meshServer.DispatchEvent(['*', 'server-users'], obj, { action: 'pluginStateChange' });
            break;
            case 'getPluginConfig':
                obj.meshServer.db.getPlugin(command.id, (err, conf) => {
                    myparent.ws.send(JSON.stringify({ action: 'plugin', plugin: 'devtools', method: 'loadEditPluginConfig', conf, result: err }));
                });
            break;
            case 'savePluginConfig':
                obj.meshServer.db.updatePlugin(command.id, command.conf, (err, conf) => {
                    obj.meshServer.db.getPlugins(function(err, docs) {
                        try { myparent.ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) {}
                    });
                });
            break;
            case 'deletePluginConfig':
                obj.meshServer.db.deletePlugin(command.id, (err, conf) => {
                    obj.meshServer.db.getPlugins(function(err, docs) {
                        try { myparent.ws.send(JSON.stringify({ action: 'updatePluginList', list: docs, result: err })); } catch (ex) {}
                    });
                });
            break;
            case 'restartServer': process.exit(123);
            break;
        }
    };
    return obj;
};
```

### 16.3 Plugin com timers + DB + agent module + RBAC — `PrinterControl`

(130 linhas, melhor exemplo de patterns modernos):

```javascript
"use strict";
var crypto = require("crypto");

module.exports.printercontrol = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.VIEWS = __dirname + "/views/";
    obj.pending = Object.create(null);

    var ACTION_PERMISSIONS = {
        inventory: "can_view", jobs: "can_view",
        cancelJob: "manage_jobs", pauseJob: "manage_jobs", resumeJob: "manage_jobs",
        testPage: "manage_printers", addTcpPrinter: "manage_printers",
        deletePrinter: "manage_printers",
        removeDriver: "manage_drivers",
        spoolerStart: "manage_spooler", spoolerStop: "manage_spooler",
        spoolerRestart: "manage_spooler", clearQueue: "manage_spooler"
    };

    function registerPluginPermissions() {
        parent.registerPermissions("printercontrol", {
            can_view:        { title: "View printers",     desc: "...", default: "denied" },
            manage_jobs:     { title: "Manage print jobs", desc: "...", default: "denied" },
            manage_printers: { title: "Manage printers",   desc: "...", default: "denied" },
            manage_drivers:  { title: "Manage drivers",    desc: "...", default: "denied" },
            manage_spooler:  { title: "Manage spooler",    desc: "...", default: "denied" }
        });
    }

    obj.server_startup = function () {
        registerPluginPermissions();
        obj.debug("plugin:printercontrol", "Started");
    };

    obj.onDeviceRefreshEnd = function(nodeid) {
        if (!currentNode || currentNode.osdesc.toLowerCase().indexOf("windows") < 0) return;
        pluginHandler.registerPluginTab({ tabTitle: "Printers", tabId: "pluginPrinterControl" });
    };

    obj.handleAdminReq = function(req, res) {
        if (req.query.user !== "1") { res.sendStatus(401); return; }
        res.render(obj.VIEWS + "printercontrol", {});
    };

    // === Helpers ===
    function sendToSession(session, message) {
        try {
            if (session.send) { session.send(JSON.stringify(message)); return true; }
            if (session.ws) { session.ws.send(JSON.stringify(message)); return true; }
        } catch (ex) {}
        return false;
    }
    function browserMessage(type, extra) {
        var msg = { action: "plugin", plugin: "printercontrol", method: "handlePrinterMessage", type: type };
        Object.keys(extra).forEach(k => msg[k] = extra[k]);
        return msg;
    }
    function fail(session, action, error, requestId) {
        sendToSession(session, browserMessage("result", { requestId, operation: action, success: false, error: String(error) }));
    }

    function withNodeRights(session, webserver, nodeid, callback) {
        var user = session.user, domain = session.domain;
        webserver.GetNodeWithRights(domain, user, nodeid, function(node, rights) {
            if (!node || rights === 0) { callback(new Error("denied")); return; }
            callback(null, node, rights, user);
        });
    }

    function getPermissionChecker(user, nodeid) {
        return obj.parent.getAccessPermissions("printercontrol", user, { nodeid });
    }

    function agentIsOnline(nodeid) {
        return !!(obj.meshServer.webserver.wsagents[nodeid]);
    }

    function sendToAgent(nodeid, command) {
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (!agent) return false;
        try { agent.send(JSON.stringify(command)); return true; } catch (ex) { return false; }
    }

    // === Browser → Plugin ===
    function handleBrowserOperation(command, session, webserver) {
        var operation = command.pluginaction;
        var requiredPermission = ACTION_PERMISSIONS[operation];
        if (!requiredPermission) { fail(session, operation, "Unsupported"); return; }
        withNodeRights(session, webserver, command.nodeid, function(err, node, rights, user) {
            if (err) { fail(session, operation, err.message); return; }
            getPermissionChecker(user, command.nodeid).then(hasPermission => {
                if (!hasPermission(requiredPermission)) { fail(session, operation, "Permission denied"); return; }
                if (!agentIsOnline(command.nodeid)) { fail(session, operation, "Agent offline"); return; }
                var requestId = crypto.randomBytes(18).toString("hex");
                var timer = setTimeout(() => {
                    var p = obj.pending[requestId]; if (!p) return;
                    delete obj.pending[requestId];
                    fail(p.session, p.operation, "Timed out", requestId);
                }, 180000);
                obj.pending[requestId] = { nodeid: command.nodeid, operation, params: command.params || {}, session, userid: user._id, timer };
                sendToAgent(command.nodeid, { action: "plugin", plugin: "printercontrol", pluginaction: operation, params: command.params || {}, requestId });
            });
        });
    }

    // === Agent → Plugin ===
    function handleAgentResult(command) {
        if (command.pluginaction !== "operationResult" || typeof command.requestId !== "string") return;
        var pending = obj.pending[command.requestId]; if (!pending) return;
        clearTimeout(pending.timer); delete obj.pending[command.requestId];
        sendToSession(pending.session, browserMessage("result", {
            requestId: command.requestId, operation: pending.operation,
            success: command.success === true,
            error: command.success === true ? null : String(command.error || "failed"),
            data: command.data == null ? null : command.data
        }));
    }

    obj.serveraction = function(command, myparent, grandparent) {
        if (!command || command.plugin !== "printercontrol") return;
        // distinguish browser vs agent
        if (!myparent || !myparent.user) {
            if (command.pluginaction === "operationResult") handleAgentResult(command);
            return;
        }
        handleBrowserOperation(command, myparent, grandparent);
    };

    return obj;
};
```

### 16.4 Plugin scanner-only (puro server-side, sem agent module) — **User-Device Tracer**

Ver `usertracer.js` neste repo — ~640 linhas que cobrem:
- server_startup com init de DB próprio
- Scanner 30s que percorre `wsagents` e `mdb.Get` para cada agente
- Diff detection (login/logout/lock/unlock)
- serveraction com 6 `pluginaction`s (getCurrentUsers, getTimeline, getNodeDetails, etc.)
- handleAdminReq com switch `?user=1` / admin
- onDeviceRefreshEnd registrando tab + iframe
- Multiple hooks (hook_agentCoreIsStable, hook_processAgentData)

### 16.5 Hook wrapper custom — **Agentname2Servername**

```javascript
// Após PluginHookScheduler estar instalado:
const { PLUGIN_SHORT_NAME, pluginConfig } = require('../pluginhookscheduler')({
    __dirname,
    requiredPluginHooks: ['hook_afterCreateMeshAgent']
});

module.exports = {
    [PLUGIN_SHORT_NAME]: function (pluginHandler) {
        const meshserver = pluginHandler.parent;
        let webserver;
        return {
            server_startup() { webserver = meshserver.webserver; },
            hook_afterCreateMeshAgent(meshagent, parent, db, ws, req, args, domain) {
                ws.on('message', function listener(data) {
                    if (meshagent.authenticated < 1) return;
                    // mutate meshagent or webserver state here
                    meshagent.agentInfo.computerName = ...;
                });
                return meshagent;
            }
        };
    }
};
```

---

## 17. Versão `prepExports` injetada no navegador

A string gerada por `pluginHandler.prepExports()` (linhas 36-53) é literalmente esta (exemplo para 2 plugins `scripttask` e `usertracer`):

```javascript
function() {
  var obj = {};
  obj.scripttask = {};
  obj.scripttask.onDeviceRefreshEnd = function onDeviceRefreshEnd() { /* source */ };
  obj.scripttask.resizeContent = function resizeContent() { /* source */ };
  obj.usertracer = {};
  obj.usertracer.onDeviceRefreshEnd = function onDeviceRefreshEnd() { /* source */ };

  obj.callHook = function (hookName, ...args) {
    for (const p of Object.keys(obj)) {
      if (typeof obj[p][hookName] == 'function') obj[p][hookName].apply(this, args);
    }
  };

  return obj;
}
```

Após o `/pluginHandler.js` ser carregado:
```javascript
pluginHandler = new pluginHandlerBuilder();
pluginHandler.callHook("onWebUIStartupEnd");
```

Então:
- `pluginHandler.callHook('onWebUIStartupEnd')` chama `obj.scripttask.onWebUIStartupEnd(...)` em cada plugin que exportou esse nome.
- `pluginHandler.<shortName>.<methodName>(...)` chama o método específico.

Note o que NÃO é gerado pelo `prepExports` (vs. o que o User-Device Tracer injetava manualmente):
- Sem `registerPluginTab` (esse helper é injetado por **outro lugar** do código do frontend do MeshCentral; não está no `prepExports`)
- Sem `callPluginPage`, `refreshPluginHandler`, `addPluginEx` — esses são **outros métodos do objeto `pluginHandler` que existem no client-side mas vêm do código global do MeshCentral, não do `prepExports`**

Na prática: **`pluginHandler.registerPluginTab({...})` funciona porque o código global do MeshCentral cria esse método no objeto `pluginHandler` na página**. Dentro do iframe, esses helpers vêm via `top.pluginHandler.registerPluginTab` (variável global do parent).

---

## 18. Glossário de Tipos de Documento do MeshCentral DB

`_id` é sempre `"<type>/<domain>/<rest>"`. Os principais tipos:

| `type` | `_id` prefix | Campos chave | Notas |
|--------|--------------|--------------|-------|
| `user` | `user/<domain>/<userid>` | name, email, salt, hash, siteadmin, links, groups | |
| `mesh` | `mesh/<domain>/<meshid>` | name, desc, mtype, links, nodes, agentCertificate | device group |
| `node` | `node/<domain>/<nodeid>` | name, host, ip, osdesc, mtype, users[], lusers[], upnusers[], pwr, conn, lastconnect, tag, agent | agent |
| `sysinfo` | `si<nodeid>` | – | system info |
| `cfile` | `cfile...` | – | core files |
| `event` | – | time, domain, action, nodeid, userid, doc | event log (TTL 20d default) |
| `power` | – | time, nodeid, doc | power events (TTL 10d) |
| `lastconnect` | `lc<nodeid>` | time, domain, meshid | last connection time |
| `note` | `nt<nodeid>` | – | device notes |
| `iploc` | – | – | IP location |
| `ifinfo` | `if<nodeid>` | – | network interface info |
| `plugin` | – | (full plugin config saved) | plugin state |
| `pluginpermission` | `pluginpermission/<pluginName>` | – | stored plugin permission overrides |
| `logintoken` | `logintoken-<name>` | – | login tokens |

Abreviações:
- `si<id>` = sysinfo
- `nt<id>` = notes
- `lc<id>` = lastconnect
- `if<id>` = ifinfo
- `im<id>` = image

---

## 19. Apêndice: Hooks disponíveis no MeshCentral

Nem todos os hooks abaixo estão documentados oficialmente. O sistema `callHook()` aceita qualquer nome — eles são definidos pelos pontos do código do MeshCentral que chamam `parent.pluginHandler.callHook('xyz', ...)`.

### Hooks server-side (chamados pelo core do MeshCentral)

| Hook | Quando | Argumentos |
|------|--------|-----------|
| `server_startup` | Após carregar/recarregar plugin | `()` |
| `hook_agentCoreIsStable` | Agent conectou e core está pronto | `(myparent, grandparent)` |
| `hook_processAgentData` | Mensagem `action:'plugin'` vinda do agent | `(data, nodeid)` |
| `setupHttpHandlers` / `server_startup` (legado) | Pode registrar rotas Express extras | `(webserver)` |
| `handleAdminReq` | `GET /pluginadmin.ashx` | `(req, res, user)` |
| `handleAdminPostReq` | `POST /pluginadmin.ashx` | `(req, res, user)` |
| `on_device_header` | Render de página de device | `()` — retorna HTML string ou null |
| `on_device_page` | Render de página de device | `()` — retorna HTML string |
| `goPageStart` / `goPageEnd` | Hooks de navegação entre páginas | `(page)` |

### Hooks frontend-side (exportados via `obj.exports`)

| Hook | Quando | Argumentos |
|------|--------|-----------|
| `onWebUIStartupEnd` | Após `pluginHandler = new pluginHandlerBuilder()` na primeira carga | `()` |
| `onDeviceRefreshEnd` | Quando a tab do dispositivo é renderizada/atualizada | `(nodeid, panel, refresh, event)` |
| `fe_on_message` | Recebe mensagem do agent via `sessionid` correlation | `(server, message)` |
| `onRemoteEventLogStateChange` | Estado de conexão live log mudou | `(state)` |
| `registerPluginTab` | Para definir o título da tab dinamicamente | `()` |
| `onDesktopDisconnect` | Sessão desktop fechou | `()` |
| `consoleaction` | **Agent-side**: chamado pelo MeshAgent | `(args, rights, sessionid, parent)` |
| `malix_triggerOption` | Trigger de alerta personalizado | `(selectElem)` |
| `historyData` | Hook customizado chamado via DispatchEvent | `(message)` |
| `variableData` | Idem | `(message)` |
| `mapData` / `mapUpdate` | FileDistribution | `(message)` |

### Hooks BitCtrl (requer PluginHookScheduler)

Estes hooks são **gerados dinamicamente** quando você chama `pluginHandler.wrapFunctionCall(target, methodName)`. Veja `pluginhookexample.js`:

- `hook_beforeCreateMeshAgent` / `hook_afterCreateMeshAgent`
- `hook_beforeCreateMeshRelay` / `hook_afterCreateMeshRelay`
- `hook_beforeCreateLocalRelay` / `hook_afterCreateLocalRelay`
- `hook_beforeCreateMeshUser` / `hook_afterCreateMeshUser`
- `hook_beforeNotifyUserOfDeviceStateChange` / `hook_afterNotifyUserOfDeviceStateChange`
- `hook_agentWebSocketDisconnected`
- Qualquer `hook_before<Method>` / `hook_after<Method>` que você registar via `wrapFunctionCall`.

Convenção para hooks customizados:
- `hook_before<Name>(arg1, arg2, ...)` — antes da função, recebe os argumentos
- `hook_after<Name>(result, arg1, arg2, ...)` — depois da função, recebe o resultado como primeiro argumento + os argumentos originais

---

> **Documento atualizado em 29/07/2026.** Baseado em análise direta do código-fonte de:
> - `pluginHandler.js` (MeshCentral v1.x master, 297 linhas)
> - `webserver.js` (plugin routes em linhas 6895-6920, 7463-7467)
> - `db.js` (linhas 27-28 com lista de backends)
> - Plugins analisados: ScriptTask, EventLog, RegEdit, DevTools, Sample, PluginHookExample, PluginHookScheduler, PrinterControl, Agentname2Servername, FileDistribution
> - Debug de produção com 12 agentes (11 Windows + 1 Linux) em MeshCentral v1.2.4
