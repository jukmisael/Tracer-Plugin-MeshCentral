# MeshCentral Plugin Development Guide

## Referência de Acesso a Dados

Baseado na análise do MeshCentral v1.2.4 e 12 plugins da comunidade.

---

### Cadeia de Objetos no Plugin

```
No plugin:
  parent                        = pluginHandler (pluginHandler.js)
  parent.parent                 = meshServer (meshcentral.js / meshserver.js)
  parent.parent.webserver       = webserver.js (Express + WebSocket)
  parent.parent.db              = banco de dados (NeDB / MongoDB)

NÃO existe:
  parent.parent.parent          ← undefined
  parent.parent.agents          ← undefined
  parent.parent.parent.agents   ← undefined
```

### Onde estão os dados

| Dado | Onde encontrar | Exemplo |
|------|---------------|---------|
| Agentes conectados | `meshServer.webserver.wsagents` | `wsagents["node//xxx"]` |
| Nome do dispositivo | `wsagents[nid].name` ou `wsagents[nid].agentInfo.computerName` | `"BR-24002"` |
| Usuários ativos | **`db.Get(nodeId, callback)`** → `doc.users` | `["BKSSERVICES\Fabiana.Gomes"]` |
| Nó do banco | `db.Get("node//domain/id", fn)` → `docs[0]` | `{ _id, name, users, lusers, ... }` |
| Session ID (frontend) | `myparent.ws.sessionId` | `"user//domain/id/random"` |
| WebSocket do agente | `wsagents[nid].send(JSON.stringify(msg))` | enviar comando ao agente |
| WebSocket do frontend | `wssessions2[sessionId].send(JSON.stringify(msg))` | responder ao frontend |

### Exemplo Correto: Listar Usuários Ativos

```javascript
obj.serveraction = function (command, myparent, gp) {
    if (command.plugin !== 'meuplugin') return;
    var sid = null;
    try { sid = myparent.ws.sessionId; } catch (e) {}
    if (!sid) return;

    if (command.pluginaction === 'getUsers') {
        var result = [];
        var ws = obj.meshServer.webserver.wsagents || {};
        var ids = Object.keys(ws);
        if (ids.length === 0) { obj.send(sid, { data: [] }); return; }

        var pending = ids.length;
        ids.forEach(function (nodeId) {
            obj.meshServer.db.Get(nodeId, function (err, docs) {
                if (!err && docs && docs.length > 0) {
                    var doc = docs[0];
                    // doc.users = ["DOMAIN\username"] (enviado pelo agente)
                    // doc.lusers = versão com status de bloqueio
                    // doc.upnusers = formato user@domain
                    if (Array.isArray(doc.users) && doc.users.length > 0) {
                        result.push({ nodeid: nodeId, name: doc.name, users: doc.users });
                    }
                }
                pending--;
                if (pending <= 0) obj.send(sid, { action: 'plugin', method: 'userList', data: result });
            });
        });
    }
};
```

### Hooks e seus Parâmetros

| Hook | Parâmetros | Observação |
|------|-----------|------------|
| `server_startup()` | — | Chamado na inicialização |
| `hook_agentCoreIsStable(myparent, gp)` | `myparent` = agente WebSocket (`wsagents[nid]`), `gp` = meshServer | Chamado quando agente conecta |
| `hook_processAgentData(data, nodeid)` | `data` = mensagem do agente, `nodeid` = ID do nó | Chamado a cada dado recebido |
| `hook_userLoggedIn(user)` | `user` = objeto do usuário MeshCentral | Chamado no login web |
| `serveraction(command, myparent, grandparent)` | `myparent` = conexão WebSocket, `grandparent` = meshServer | Comandos do frontend e agente |
| `handleAdminReq(req, res, user)` | `user` = objeto do usuário logado | HTTP: `/pluginadmin.ashx?pin=nome` |

### Comunicação Frontend ↔ Server

**Frontend → Server (via WebSocket):**
```javascript
// No iframe ou página do plugin:
var ms = (typeof parent !== 'undefined' && parent.meshserver) || window.meshserver;
ms.send({ action: 'plugin', plugin: 'shortName', pluginaction: 'commandName', ... });
```

**Server → Frontend (resposta):**
```javascript
// No serveraction:
obj.meshServer.webserver.wssessions2[sessionId].send(JSON.stringify({
    action: 'plugin', plugin: 'shortName', method: 'callbackName', data: ...
}));
```

**Frontend recebe (registrar handler):**
```javascript
parent.pluginHandler.shortName.callbackName = function(msg) {
    var data = (msg && msg.data !== undefined) ? msg.data : msg;
    // processar data
};
```

### Erros Comuns Corrigidos

| Erro | Causa | Solução |
|------|-------|---------|
| `Cannot read properties of undefined (reading 'agents')` | `meshServer.parent` não existe | Use `meshServer.webserver.wsagents` |
| `parent.agents` retorna 0 | `agents` não está em `parent` | Dados de agente estão em `webserver.wsagents` |
| Nenhum usuário aparece | `agentInfo` não tem username | Dados de usuário estão no DB: `db.Get(nodeId)` |
| Resposta chega vazia | DB query é assíncrona, resposta enviada antes | Use contador `pending` para aguardar callbacks |
| `result.some is not a function` | `Array.prototype.some` não disponível em ES5 | Use loop manual: `for(){if() return}` |
