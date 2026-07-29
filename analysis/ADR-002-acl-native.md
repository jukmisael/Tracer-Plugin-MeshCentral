# ADR-002: ACL — usar APIs nativas do MeshCentral, nunca reinventar

> **Status**: ✅ **Aceito** — implementação v4.0
> **Contexto**: plugins podem cair em armadilha de implementar ACL próprio. MeshCentral já tem 3 camadas nativas (MESHRIGHT_*, GetNodeWithRights, getAccessPermissions) que cobrem 100% dos casos.
> **Decisão**: **usar exclusivamente o nativo**. Verificar via `GetNodeWithRights` server-side. Nunca duplicar ACL no frontend.

---

## 1. As 3 camadas nativas do MeshCentral

Verificadas diretamente na codebase (`webserver.js`, `pluginHandler.js`, `meshuser.js`):

### Camada 1: MESHRIGHT_* (bits de direito)

Definidos em `webserver.js:150-174`:

```js
const MESHRIGHT_EDITMESH = 0x00000001;
const MESHRIGHT_MANAGEUSERS = 0x00000002;
const MESHRIGHT_MANAGECOMPUTERS = 0x00000004;
const MESHRIGHT_REMOTECONTROL = 0x00000008;
const MESHRIGHT_AGENTCONSOLE = 0x00000010;
const MESHRIGHT_SERVERFILES = 0x00000020;
const MESHRIGHT_WAKEDEVICE = 0x00000040;
const MESHRIGHT_SETNOTES = 0x00000080;
const MESHRIGHT_REMOTEVIEWONLY = 0x00000100;
const MESHRIGHT_NOTERMINAL = 0x00000200;
const MESHRIGHT_NOFILES = 0x00000400;
const MESHRIGHT_NOAMT = 0x00000800;
const MESHRIGHT_DESKLIMITEDINPUT = 0x00001000;
const MESHRIGHT_LIMITEVENTS = 0x00002000;
const MESHRIGHT_CHATNOTIFY = 0x00004000;
const MESHRIGHT_UNINSTALL = 0x00008000;
const MESHRIGHT_NODESKTOP = 0x00010000;
const MESHRIGHT_REMOTECOMMAND = 0x00020000;
const MESHRIGHT_RESETOFF = 0x00040000;
const MESHRIGHT_GUESTSHARING = 0x00080000;
const MESHRIGHT_DEVICEDETAILS = 0x00100000;   // usado para "Do utilizador"
const MESHRIGHT_RELAY = 0x00200000;
const MESHRIGHT_NOREGISTRY = 0x00400000;
const MESHRIGHT_NOSOFTWARE = 0x00800000;
const MESHRIGHT_ADMIN = 0xFFFFFFFF;
```

**Para User-Device Tracer**: `MESHRIGHT_DEVICEDETAILS` (0x100000) é o que libera `node.users`/`node.lusers` no UI nativo. Se user não tem esse right, MeshCentral nativo **não mostra** "Active Users" na device page.

### Camada 2: GetNodeWithRights / GetMeshRights / GetNodeRights

**`webserver.GetNodeWithRights(domain, user, nodeid, func)`** (`webserver.js:9548`):

```js
obj.GetNodeWithRights = function (domain, user, nodeid, func) {
    // pre-validate user + nodeid
    // db.Get(nodeid) → check user.links[nodeid], user.links[meshid], userGroups
    // retorna (node, rights, visible)
    //   rights = bitmask MESHRIGHT_*
    //   visible = bool — user pode ver o node
};
```

Verifica **3 caminhos** de permissão:
1. **Device link direto**: `user.links[nodeid]` (mais específico)
2. **Mesh (device group) link**: `user.links[node.meshid]`
3. **User group link**: itera `user.links` procurando `ugrp/...` e checa `userGroup.links[meshid]` ou `userGroup.links[nodeid]`

**`webserver.GetMeshRights(user, meshid)`** (`webserver.js:9697`):
- Cache in-memory `GetNodeRightsCache[user._id][meshid][nodeid]` com TTL 10s
- Mesma lógica, mas só mesh-level

### Camada 3: getAccessPermissions (RBAC custom do plugin)

**`pluginHandler.getAccessPermissions(pluginName, user, context)`** (`pluginHandler.js:709`):

```js
obj.getAccessPermissions = function(pluginName, user, context) {
    var nodeId = context.nodeid;
    var meshId = context.meshid;
    // Resolve meshId from nodeId se necessário (db.Get → node.meshid)
    return meshPromise.then(function(resolvedMeshId) {
        // Cascade: node override → mesh override → global → default
        // Retorna função: has('can_view') => bool
    });
};
```

**Cascata de override** (`pluginHandler.js:838-919`):
1. Node override (`permConfig.nodeOverrides[nodeid]`)
2. Mesh override (`permConfig.meshOverrides[meshid]`) — só se user tem link ao mesh
3. Global (`permConfig.allowed.users` / `denied.users`)
4. Default registrado em `registerPermissions`

Site-admin (`user.siteadmin === 0xFFFFFFFF`) **sempre passa** (linha 840).

---

## 2. Como o MeshCentral nativo usa isso (referência)

### 2.1 Filtrar nodes antes de enviar ao frontend

`meshuser.js:5279` — remove sysinfo/netinfo se user não tem `MESHRIGHT_DEVICEDETAILS`:
```js
if ((parent.GetNodeRights(user, results[i].node.meshid, results[i].node._id) & MESHRIGHT_DEVICEDETAILS) == 0) {
    delete results[i].sys;
    delete results[i].net;
}
```

### 2.2 Resposta a comandos que pedem dados sensíveis

`meshuser.js:6682` — `getnetworkinfo`:
```js
parent.GetNodeWithRights(domain, user, command.nodeid, function (node, rights, visible) {
    if ((visible == false) || ((rights & MESHRIGHT_DEVICEDETAILS) == 0)) {
        obj.send({ action: 'getnetworkinfo', nodeid: command.nodeid, tag: command.tag, noinfo: true, result: 'Invalid device id' });
        return;
    }
    // ... proceed com db.Get('if' + node._id)
});
```

Mesmo padrão em `meshuser.js:6707` (getsysinfo) e `meshuser.js:6824` (lastconnect).

### 2.3 UI nativo — "Do utilizador" na device list

`views/default.handlebars:5398` (`getUserShortStr`):
```js
function getUserShortStr(node) {
    if (node == null || node.users == null || (!Array.isArray(node.users)) || node.users.length == 0) return '';
    // ... renderiza node.users[0] como "Active User"
}
```

**Note**: este código **NÃO** checa ACL explicitamente. A segurança vem do **fato de que `node` foi entregue ao frontend já filtrado** por `GetNodeWithRights` no servidor. Se user não tem access ao node, o node inteiro (incluindo `users`/`lusers`) **nunca chega** ao frontend.

**Conclusão**: o filter server-side é o único local onde ACL importa. Frontend pode assumir que dados recebidos são authorized.

---

## 3. O que os plugins da comunidade fazem

### 3.1 RegEdit (oficial, Ryan Blenis)

`regedit.js:59` (`handleAdminReq`):
```js
obj.handleAdminReq = function(req, res, user) {
    if (req.query.user == 1) {
        var vars = { hives: JSON.stringify(obj.HIVES) };
        res.render(obj.VIEWS + 'regedit', vars);
    }
};
```

**Nenhuma checagem ACL explícita**. Confia que `webserver.handlePluginAdminReq` (linha 6899-6901) já filtra:
- `checkUserIpAddress(req, res)`
- `req.session.userid` deve existir
- `obj.users[req.session.userid]` deve existir
- `req.query.pin` deve ser alphanumeric

`serveraction` do regedit também não checa ACL — confia que `command.nodeid` já foi validado.

### 3.2 ScriptTask (oficial)

`scripttask.js:189-230` (`handleAdminReq`):
```js
obj.handleAdminReq = function(req, res, user) {
    if ((user.siteadmin & 0xFFFFFFFF) == 1 && req.query.admin == 1) {
        // admin
    } else if (req.query.admin == 1 && (user.siteadmin & 0xFFFFFFFF) == 0) {
        res.sendStatus(401); return;
    } else if (req.query.user == 1) {
        // user
    }
};
```

Apenas distingue admin vs user. **Não checa ACL por node**.

### 3.3 User-Device Tracer v3.5.x (atual)

`usertracer.js:329` (`handleAdminReq`):
```js
if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
    res.sendStatus(401); return;
}
res.render('admin', {});
```

Também **não checa ACL por node** para a query `getTimeline`. O `db.getEvents` no v3.5.x usa `command.nodeids` como filtro, mas não valida se user tem access a esses nodeids.

**Vulnerabilidade atual**: user non-admin que conhece um `nodeid` pode fazer `getTimeline` com esse nodeid e receber dados.

---

## 4. Decisão para v4.0

### 4.1 Server-side: filtrar com `GetNodeWithRights`

```js
obj._actionGetTimeline = function(command, sid) {
    var user = obj._getSessionUser(sid);
    if (!user) { obj._send(sid, { method:'timeline', data:[], _live:{} }); return; }

    // Resolver lista de nodes acessíveis
    var requestedNodeIds = command.nodeids || (command.nodeid ? [command.nodeid] : null);
    obj._filterAccessibleNodes(user, requestedNodeIds, function(accessibleNodeIds) {
        if (accessibleNodeIds.length === 0) {
            obj._send(sid, { method:'timeline', data:[], _live:{}, _reqSeq: command._reqSeq });
            return;
        }
        // ... query + resolveLiveState
    });
};

obj._filterAccessibleNodes = function(user, nodeIds, cb) {
    // Admin full com manageAllDeviceGroups: tudo do domain
    if ((user.siteadmin & 0xFFFFFFFF) === 0xFFFFFFFF) {
        var mg = obj.meshServer.parent && obj.meshServer.parent.config &&
                 obj.meshServer.parent.config.settings &&
                 obj.meshServer.parent.config.settings.managealldevicegroups;
        if (mg && (mg.indexOf(user._id) >= 0 || Object.keys(user.links || {}).some(function(k) {
            return mg.indexOf(k) >= 0;
        }))) {
            cb(nodeIds || Object.keys(obj.meshServer.webserver.nodes || {}));
            return;
        }
    }

    if (!nodeIds || nodeIds.length === 0) {
        // Sem filtro explícito: retornar todos os nodes visíveis
        cb(Object.keys(obj.meshServer.webserver.nodes || {}).filter(function(nid) {
            return user.links && user.links[nid];
        }));
        return;
    }

    var accessible = [], pending = nodeIds.length;
    if (pending === 0) { cb(accessible); return; }

    nodeIds.forEach(function(nid) {
        obj.meshServer.webserver.GetNodeWithRights(user.domain, user, nid, function(node, rights, visible) {
            if (visible && rights > 0) accessible.push(nid);
            if (--pending === 0) cb(accessible);
        });
    });
};
```

### 4.2 Frontend: nunca filtrar ACL

Já documentado em STUDY §3.10.6: backend filtra, frontend renderiza.

### 4.3 Permissões custom do plugin (RBAC)

Manter as 2 permissões atuais:
- `can_view_history` (default `allowed`)
- `can_purge_history` (default `denied`)

Nenhuma nova permissão precisa ser adicionada para v4.0. O ACL de node é feito via MESHRIGHT_DEVICEDETAILS, não via RBAC do plugin.

---

## 5. Edge cases

### 5.1 User com `MESHRIGHT_REMOTECONTROL` mas sem `MESHRIGHT_DEVICEDETAILS`

Pode controlar o desktop mas não vê "Do utilizador". Para User-Device Tracer:
- Acesso a `node.users`/`node.lusers` → requer `MESHRIGHT_DEVICEDETAILS`
- Acesso ao `getTimeline` em si → qualquer `rights > 0` no node

**Decisão**: User-Device Tracer **requer** `MESHRIGHT_DEVICEDETAILS` para retornar dados (alinhado com o UI nativo). Sem esse right, mesmo que user tenha `MESHRIGHT_REMOTECONTROL`, ele não pode usar o plugin.

### 5.2 Plugin rodando em server com mesh federation

Cada server tem seu próprio `webserver.users` cache. `GetNodeWithRights` funciona server-local. Se node está em outro server, retorna `visible=false` (correto).

### 5.3 User sem sessão válida

`obj._getSessionUser(sid)` retorna null. Backend deve responder com `data:[]` e `_live:{}` sem erro visível (ou 401 explícito se quiser).

### 5.4 Cache de `GetNodeWithRights`

`webserver.js:9781-9810` mostra cache de 10s. Não devemos confiar cegamente — sempre chamar fresco para `getTimeline` (cache miss OK; queremos precisão).

---

## 6. Anti-patterns (NÃO fazer)

### Reinventar ACL no frontend

```js
// ERRADO
function loadTimeline() {
    if (user.links && user.links[nodeid]) {  // duplica lógica do servidor
        // load
    }
}
```

O frontend **recebe apenas dados já filtrados**. Fazer check extra no frontend = código morto que vaza segurança (se ACL mudar no servidor, frontend fica inconsistente).

### Mandar `command.nodeids` sem validar no servidor

```js
// ERRADO
obj.db.getEvents({ nodeid: { $in: command.nodeids } }, opts, function(docs) {
    obj._send(sid, { data: docs });  // user pode ter pedido nodes que não tem access
});
```

User pode mandar `nodeids: ['node//domain/secret-node']` mesmo sem access. **Sempre** passar por `GetNodeWithRights`.

### Confiar em `user.siteadmin`

```js
// ERRADO (sub-ótimo)
if ((user.siteadmin & 0xFFFFFFFF) === 0xFFFFFFFF) {
    // mostrar tudo
}
```

**Certo**:
```js
if ((user.siteadmin & 0xFFFFFFFF) === 0xFFFFFFFF) {
    // ainda chamar GetNodeWithRights para filtrar por domain
    // OU checar manageAllDeviceGroups
}
```

Admin full ainda respeita domain (não vê devices de outros domains). Validar.

### Assumir `node.users` existe

```js
// ERRADO
var onlineUsers = node.users;  // pode ser undefined
```

**Certo**:
```js
var onlineUsers = node.users || [];
```

`node.users` só é populado quando agent envia `agentInfo`. Pode estar `undefined` mesmo em node conectado.

---

## 7. Resumo da decisão

| Caso | API nativa a usar |
|---|---|
| User pode ver este node? | `GetNodeWithRights(domain, user, nodeid)` → `(rights, visible)` |
| User tem rights custom do plugin? | `parent.getAccessPermissions('usertracer', user, ctx)` → Promise |
| User é admin full? | `(user.siteadmin & 0xFFFFFFFF) === 0xFFFFFFFF` |
| User tem permission específica do node? | `(rights & MESHRIGHT_DEVICEDETAILS) === MESHRIGHT_DEVICEDETAILS` |
| Cache de rights? | Usar `GetNodeRightsCache` interno do webserver (TTL 10s) — não reimplementar |

**Sempre que possível**: usar as APIs listadas. Reinventar = bugs de segurança + drift com MeshCentral upstream.

---

## 8. Gaps identificados nas docs locais (`analysis/`)

Vasculhando `analysis/PERGUNTA-RESPOSTA-NATIVA.md` + `analysis/HOOKS-CATALOG.md` + `MESHCENTRAL-PLUGIN-GUIDE.md`, encontrei:

| Gap | Onde falta | Correção proposta |
|---|---|---|
| `GetNodeWithRights` signature completa com 3 paths (direct/mesh/userGroup) | `analysis/PERGUNTA-RESPOSTA-NATIVA.md` §4 menciona só genérico | Adicionar signature detalhada com `cb(node, rights, visible)` |
| `getAccessPermissions` Promise API + cascade node→mesh→global→default | não documentado | Adicionar à §6 |
| `MESHRIGHT_*` constants — qual usar para "user info" | não documentado | Adicionar §12.2 (User info) com `MESHRIGHT_DEVICEDETAILS` |
| `webserver.GetAllMeshWithRights(user, rightsMask)` | não documentado | Adicionar §12.5 |
| Pattern de filter server-side em `meshuser.js:5279` (`delete results[i].sys; delete results[i].net`) | só mencionado em doc | Adicionar como exemplo canônico |
| `GetNodeRightsCache` in-memory cache TTL 10s | não documentado | Adicionar §3.10.4 |
| `user.removeRights` (sub-rights) — UX feature | não documentado | Adicionar §11.6 |

**Atualizar `analysis/PERGUNTA-RESPOSTA-NATIVA.md`** para incluir os gaps antes de implementar v4.0.

---

## 9. Próximo passo

1. Implementar `_filterAccessibleNodes` em `usertracer.js`
2. Aplicar em `getTimeline`, `getCurrentUsers`, `getDeviceNames` (se aplicável)
3. Atualizar `PERGUNTA-RESPOSTA-NATIVA.md` com os gaps de §8
4. Smoke test: user sem `MESHRIGHT_DEVICEDETAILS` deve receber `data:[]` + `_live:{}`