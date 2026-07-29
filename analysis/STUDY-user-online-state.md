# Study: User Online State — Correção da Heurística Frontend

> **Status**: Documento de estudo. Sem código a ser aplicado ainda.
> **Escopo**: Mapear o problema, levantar opções, desenhar proposta de API.
> **Decisão do usuário** (já tomada): estudo primeiro, código depois. Source of truth: `wsagents` (runtime). API shape: híbrido events + getLiveSessions.

---

## 1. O problema concreto

### 1.1 Bug observado

Usuários aparecem como **Online** (verde) na view admin mesmo quando o dispositivo está desligado.

### 1.2 Causa raiz (verificada no código)

`views/admin.handlebars:254`:
```js
sessions.forEach(function(s){
    if (s.open && s.state !== 'login' && s.state !== 'lock') {
        var da = _activeUsers[s.nodeid] || [];
        // ... override para 'login' se user bate com _activeUsers
        s.state = 'login';
    }
});
```

A heurística só consulta `_activeUsers`. Se o `userCache` ficou stale (ou nunca foi populado para um node), a lista vem vazia, e o `s.open` continua com seu state original (`login` por padrão no trailing push do `buildSessions`).

`pwrMap` é enviado pelo backend mas **nunca é consultado** na view admin. Só `device.handlebars:191-195` usa `pwrMap[nodeid].pwr === 0`.

### 1.3 Por que `pwrMap` sozinho não basta

`pwrMap` vem de `obj.devicePower` (cache TTL 5min do `doc.pwr`). Problemas:
- Stale por até 5 min após disconnect
- Não reativo — só atualiza no `scanNow` a cada 30s
- `doc.pwr` é set pelo MeshCentral no connect/disconnect, mas pode ter lag

`wsagents` (in-memory `obj.meshServer.webserver.wsagents`) é a fonte reativa canônica: presença = agente conectado. Mas só é válido durante a vida do server (não persistido).

### 1.4 Por que `_activeUsers` falha

`_activeUsers` vem de `obj.userCache` populado pelo scanner (`obj.checkNode` → `obj.mdb.Get`). Se o scanner:
- ainda não rodou nesse node
- rodou antes do disconnect (stale até TTL de 5min)
- falhou por erro de DB

…então `_activeUsers[nodeid]` fica vazio e o frontend mostra "Online" mesmo offline.

---

## 2. Mapas atuais

### 2.1 Endpoints do backend (`usertracer.js:354-371`)

| pluginaction | Quem chama | Resposta |
|---|---|---|
| `getCurrentUsers` | (não usado pelo frontend atual) | `method: currentUsers` |
| `getTimeline` | admin + device | `method: timeline` |
| `getDeviceNames` | admin (devices dropdown) | `method: deviceNames` |
| `getUserNames` | admin (users dropdown) | `method: userNames` |
| `getNodeDetails` | (admin click no device) | `method: nodeDetails` |
| `purgeHistory` | admin (purge button) | `method: purgeResult` |

### 2.2 O que o frontend recebe em `getTimeline`

```js
{
    action: 'plugin', plugin: 'usertracer', method: 'timeline',
    data: docs,           // events brutos do DB
    _pwrMap: pwrMap,      // {nodeid: {pwr, conn, lastconnect, time}}
    _activeUsers: activeUsers, // {nodeid: [domain\user, ...]}
    _reqSeq: ...
}
```

### 2.3 O que o frontend FAZ com isso

| Campo | admin.handlebars | device.handlebars |
|---|---|---|
| `data` | buildSessions → renderTimeline (Gantt) | buildSessions → renderGantt (Gantt) |
| `_pwrMap` | **ignorado** (exceto passagem para renderTimeline) | usado em `_renderGantt` para `devOff` |
| `_activeUsers` | override `s.state='login'` se user bate | usado em `_renderGantt` para status |

### 2.4 Source-of-truth disponíveis nativamente

| Fonte | Reativo? | Persiste? | Localização |
|---|---|---|---|
| `obj.meshServer.webserver.wsagents[nodeid]` | sim (in-memory) | não | `core/02-webserver-routes.md:120` |
| `obj.meshServer.GetConnectivityState(nodeid)` | cache | não | `core/08-meshcentral-server.md:55` |
| `doc.pwr` / `doc.conn` (DB) | lag ~segundos | sim | `core/05-db-api.md` |
| `hook_afterNotifyUserOfDeviceStateChange` | reativo | depende de quem ouve | `core/08-meshcentral-server.md:59` |

### 2.5 User info já disponível no agent connect

Quando o MeshAgent conecta, ele envia `command.users`, `command.lusers`, `command.upnusers` (vide `meshagent.js:1976-1978`, inferido do contexto). Esses arrays ficam em `meshagent.users` / `meshagent.lusers` (formato `DOMAIN\username`). Quando o agente desconecta, esses dados somem de `wsagents` mas ficam persistidos em `doc.users`/`doc.lusers`.

Então a verdade "live" = `wsagents[dbNodeKey].users`. A verdade "persisted" = `doc.users` (pode estar stale).

## 3. Detalhes técnicos da implementação v4.0

### 3.1 Anatomia completa de `wsagents`

Quando um agente conecta, o MeshCentral popula `obj.meshServer.webserver.wsagents[dbNodeKey]` com o objeto da sessão:

```js
var ws = obj.meshServer.webserver.wsagents['node//domain/<id>'];
// Campos disponíveis:
// - ws.nodeid, ws.name, ws.domain, ws.meshid
// - ws.agentInfo = { computerName, agentVersion, platformType, osdesc, powerState, ... }
// - ws.remoteaddr, ws.connectTime
// - ws.dbNodeKey = "node/<domain>/<id>"    ← chave do mapa
// - ws.dbMeshKey = "mesh/<domain>/<id>"
// - ws.authenticated (0 | 1 | 2+)
// - ws.users = ['DOMAIN\user', ...]        ← atualizado pelo agent
// - ws.lusers = ['DOMAIN\user', ...]      ← com status de bloqueio
// - ws.upnusers = ['user@domain.com', ...]
// - ws._socket = { remoteAddress, ... }   ← TCP-level
```

**Diferença chave entre runtime e DB**:
- `wsagents` = presente SÓ quando agent está conectado AGORA. Some em `ws.on('close')`.
- `obj.meshServer.db.Get(nodeid)` = `doc.users`, persiste entre sessões mas pode estar stale.

Para o `resolveLiveState`, usar `wsagents` é a verdade runtime; `doc.users` é fallback.

### 3.2 Hook signatures completas

| Hook | Assinatura | Quando dispara |
|---|---|---|
| `hook_agentCoreIsStable(myparent, gp)` | `(agentSession, meshServer)` | Agente terminou de carregar meshcore + agentInfo completo |
| `hook_processAgentData(data, nodeid)` | `(parsedJSON, nodeid)` | Toda mensagem do agent com `action === 'plugin'` |
| `hook_afterNotifyUserOfDeviceStateChange(_, meshid, nodeid, ...)` | `(stateSet, meshid, nodeid, connectTime, connectType, powerState, serverid, extraInfo)` | **Depois** do broadcast de state change |
| `hook_agentWebSocketDisconnected(meshagent)` | `(agentSession)` | `ws.on('close')` no agent |
| `hook_beforeCreateMeshAgent(parent, db, ws, req, args, domain)` | `(...)` | Antes de criar a instância MeshAgent (requer PluginHookScheduler) |
| `hook_afterCreateMeshAgent(meshagent, parent, db, ws, req, args, domain)` | `(meshagent, ...) → meshagent` | Depois (mutável) |

**Convenção**: hooks `hook_beforeXxx(arg1, ...)` recebem args originais; `hook_afterXxx(result, arg1, ...)` recebem o resultado como primeiro parâmetro.

**Implementação de cache reativo sem polling**:
```js
// server_startup
obj._liveCache = {};   // {nodeid: {online, since, currentUsers, ...}}

obj.hook_afterNotifyUserOfDeviceStateChange = function(stateSet, meshid, nodeid, connectTime, connectType, powerState) {
    if (!nodeid) return stateSet;
    var isOnline = (stateSet && stateSet.state === 1) || (powerState !== undefined && stateSet !== null);
    obj._liveCache[nodeid] = {
        online: !!isOnline,
        powerState: powerState,
        connectTime: connectTime,
        updatedAt: Date.now()
    };
    return stateSet;
};

obj.hook_agentWebSocketDisconnected = function(meshagent) {
    if (!meshagent || !meshagent.nodeid) return;
    var nid = meshagent.nodeid;
    // wsagents já não tem essa entrada — _liveCache precisa saber
    if (obj._liveCache[nid]) {
        obj._liveCache[nid].online = false;
        obj._liveCache[nid].disconnectedAt = Date.now();
    }
};
```

### 3.3 Cross-referenciando com `db.Get` para fallback

Quando o `wsagents[nid]` é `undefined` (device desligado), ainda queremos saber:
- Último user que estava logado (`doc.users`)
- Último timestamp de connect (`doc.lastconnect`)
- Power state histórico (`doc.pwr`)

```js
function resolveLiveState(nodeids) {
    var wsAgents = obj.meshServer.webserver.wsagents || {};
    var live = {};
    var pending = [];   // nodes que precisam de db.Get fallback

    nodeids.forEach(function(nid) {
        var ws = wsAgents[nid];
        if (ws) {
            // Runtime truth
            live[nid] = {
                online: true,
                powerState: (ws.agentInfo && ws.agentInfo.powerState),
                ip: (ws._socket && ws._socket.remoteAddress),
                currentUsers: ws.users || [],
                currentLusers: ws.lusers || [],
                source: 'wsagents',
                updatedAt: Date.now()
            };
        } else {
            // Marcado para fallback
            live[nid] = { online: false, source: 'pending-db' };
            pending.push(nid);
        }
    });

    // db.Get fallback para devices offline (best-effort, não bloqueante)
    pending.forEach(function(nid) {
        obj.meshServer.db.Get(nid, function(err, docs) {
            if (err || !docs || !docs.length) return;
            var d = docs[0];
            live[nid] = {
                online: false,
                powerState: d.pwr,
                lastconnect: d.lastconnect,
                currentUsers: d.users || [],
                currentLusers: d.lusers || [],
                source: 'db-fallback',
                updatedAt: Date.now()
            };
            // NÃO enviamos update ao frontend — só na próxima request
        });
    });

    return live;   // First-paint usa só runtime; fallback assíncrono preenche na próxima request
}
```

**Performance**: 1 round-trip ao DB por node offline no primeiro request após disconnect. Aceitável porque é cacheado em `_liveCache`.

### 3.4 Hooks vs polling: trade-offs

| Aspecto | Hook reativo | Polling (atual) |
|---|---|---|
| Latência de detecção | imediato (sub-segundo) | até TTL (5min) |
| Custo de CPU | zero quando idle | 1×scanNow a cada 30s = N×30s verificações |
| Resiliência a restart | perde eventos durante downtime | varre DB ao subir |
| Complexidade | média (hooks precisam estar registrados) | baixa (setInterval) |
| Compatibilidade | depende do PluginHookScheduler (hook infra) | sempre disponível |

**Recomendação**: para v4.0, adicionar hooks + manter `scanNow` como fallback com TTL longo (5min). Para v4.1, remover polling após validação em produção.

### 3.5 Diferenças `wsagents` vs `wssessions2`

| Estrutura | Tipo | Conteúdo | Chave |
|---|---|---|---|
| `wsagents` | agent-side | `{ dbNodeKey → agentSession }` | `dbNodeKey` |
| `wssessions` | browser-side | `{ userId → [session, ...] }` (array) | `userId` |
| `wssessions2` | browser-side | `{ 'user/<dom>/<user>/<rnd>' → session }` (1:1) | `sessionId` completo |

Para broadcast ao frontend (admin), usar `wssessions2` com `myparent.ws.sessionId` ou `DispatchEvent`.

### 3.6 `GetConnectivityState` — quando usar

`obj.meshServer.GetConnectivityState(nodeid)` retorna `'connected' | 'connecting' | null`. Cache interno, atualizado pelos mesmos hooks que `wsagents`. Útil para **checagem rápida** sem iterar `wsagents`:

```js
var state = obj.meshServer.GetConnectivityState(nid);
// 'connected' = agent conectado
// 'connecting' = handshake em andamento
// null = offline
```

Trade-off vs `!!wsagents[nid]`:
- `GetConnectivityState`: O(1) cache hit, sem alocação
- `wsagents[nid]`: O(1) também, mas aloca lookup; tem info extra (users, agentInfo)

**Recomendação**: usar `!!wsagents[nid]` quando precisa dos dados extras; `GetConnectivityState` quando é só bool.

### 3.7 Enviando dados ao frontend — 3 padrões

**(a) Resposta direta a uma request específica** (mais comum):
```js
obj._send = function(sid, data) {
    var ws = obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid];
    if (ws) try { ws.send(JSON.stringify(data)); } catch (e) {}
};
// Uso em serveraction:
obj.serveraction = function(command, myparent, gp) {
    var sid = myparent.ws.sessionId;
    obj._send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: ... });
};
```

**(b) Broadcast para todos (push)**:
```js
obj.meshServer.DispatchEvent(['*'], obj, {
    action: 'plugin', plugin: 'usertracer', method: 'liveUpdate',
    data: { ... }
});
// Frontend ouve em ms.socket.addEventListener('message') — handler 'liveUpdate'
```

**(c) `pluginHandler.<shortName>.<method>` automático** (framework):
- Quando `method` é string, o MeshCentral já roteia para `pluginHandler.<shortName>.<method>` no browser
- Mas pode haver race com `addEventListener` listener (PH callback roda primeiro)
- **Best practice**: SEMPRE usar `addEventListener` no `ms.socket` para ouvir; PH callback só para logging

### 3.8 Padrão `requestId` para correlação request/response

Quando o frontend dispara várias requests em paralelo e respostas podem chegar fora de ordem, usar `_reqSeq`:
```js
// Frontend
var _reqSeq = 0;
function loadTimeline() {
    var seq = ++_reqSeq;
    ms.send({ action:'plugin', plugin:'usertracer', pluginaction:'getTimeline',
              _reqSeq: seq, /* ... */ });
}
function handleTimeline(msg) {
    if (msg._reqSeq !== _reqSeq) return;   // stale, ignora
    renderTimeline(msg.data);
}
```

Já implementado no User-Device Tracer. Manter em v4.0.

### 3.9 Agent → server: correlação via `sessionid`

Quando o backend envia comando ao agent e quer resposta correlacionada:
```js
// Server side
function sendToAgentWithResponse(nodeid, verb, params, sid) {
    var ws = obj.meshServer.webserver.wsagents[nodeid];
    if (!ws) return;
    ws.send(JSON.stringify({
        action: 'plugin',
        plugin: 'usertracer',
        pluginaction: verb,
        nodeid: nodeid,
        sessionid: sid,   // wssessions2 key
        ...params
    }));
}
// Quando o agent responde com { action:'plugin', pluginaction:'XResult', sessionid:'...' }
// → meshuser.js faz roteamento direto para wssessions2[sessionid]
// → frontend recebe em ph.timeline / ph.X / etc.
```

Útil em v4.0 se quisermos **consultar info adicional do agent on-demand** (ex: lista de processos rodando, último comando executado). Mas para v4.0 mínimo, `wsagents` runtime já basta.

### 3.10 ACL — verificando permissões no backend

Antes de retornar dados ao frontend, verificar se o user tem acesso ao node:
```js
function withNodeAccess(user, nodeid, cb) {
    if (!user) return cb(null, false);
    if ((user.siteadmin & 0xFFFFFFFF) === 0xFFFFFFFF) return cb(null, true);  // site-admin
    obj.meshServer.webserver.GetNodeWithRights(user.domain, user, nodeid, function(node, rights) {
        cb(null, !!node && rights > 0);
    });
}
```

Para v4.0, manter compat: se `getTimeline` hoje não filtra por ACL (porque `getEvents` já filtra), `resolveLiveState` deve respeitar o mesmo filtro.

### 3.11 `obj.db` (plugin DB próprio) — aproveitar para live state?

O `db.js` do User-Device Tracer usa NeDB com `tracerEvents`. **Não usar para live state**:
- TTL NeDB não é confiável para dados críticos
- Race entre scanner e request
- Poluição do DB com dados efêmeros

Live state = sempre in-memory em `obj._liveCache` ou `obj.meshServer.webserver.wsagents`.

### 3.12 Debugging — checklist para v4.0

| Sintoma | Onde investigar |
|---|---|
| Frontend mostra "Online" para device offline | `_liveCache[nid].online` no backend → `wsagents[nid]` no momento da request |
| Frontend mostra "Offline" para device online | Race entre `hook_afterNotifyUserOfDeviceStateChange` e request; verificar timing |
| `_live` chega vazio ao frontend | `nodeids` no request não bate com keys em `wsagents` (pode ser `dbNodeKey` vs `nodeid`!) |
| `hook_*` não dispara | Verificar se PluginHookScheduler está instalado; alguns hooks precisam `wrapFunctionCall` |
| `obj.meshServer.webserver` undefined | Plugin carregado antes de `webserver` ser criado (raro; verificar ordem em `server_startup`) |

Adicionar `obj.debug('plugin:usertracer', ...)` em pontos-chave: `resolveLiveState` entry, hook `*NotifyUser*` entry, `_liveCache` updates.

### 3.13 Ordem de operações em `server_startup` (v4.0)

```js
obj.server_startup = function() {
    // 1. DB init (já existe)
    obj.db = require('./db.js').CreateDB(obj.meshServer);

    // 2. Live cache init
    obj._liveCache = {};

    // 3. Registrar hooks (se PluginHookScheduler disponível)
    if (obj.parent && obj.parent.wrapFunctionCall) {
        obj.parent.wrapFunctionCall(
            obj.meshServer, 'NotifyUserOfDeviceStateChange'
        );
    }

    // 4. Manter scanNow como fallback (v4.0) — TTL 5min
    obj.startScanner();

    // 5. Cleanup handler
    obj._stopped = false;
};
```

### 3.14 Performance — N agents vs M requests

`resolveLiveState(nodeids)` itera `nodeids` (frontend) e checa cada um em `wsagents` (in-memory O(1)). Custo total: O(N) onde N = nodes no request. Para 100 nodes: ~0.1ms. Não é gargalo.

`db.Get` fallback para nodes offline: 1 round-trip ao DB por node. Se 100% dos nodes estão offline, request fica lento. **Mitigação**: cachear `doc.users` em `_liveCache` com TTL de 30s para evitar DB hits repetidos.

---

## 4. Proposta de design (v4.0)

### 4.1 Princípios

1. **Backend é fonte de verdade para "live state"**. Frontend renderer puro.
2. **Join devicePower+activeUsers server-side**. Frontend recebe "sessão resolvida" ou recebe pwrMap+activeUsers **consistentes** com o mesmo timestamp.
3. **Reativo, sem polling**. Usar `hook_afterNotifyUserOfDeviceStateChange` para atualizar cache interno.
4. **Refator limpo, sem compatibilidade**: estamos em dev. Cortar tudo que é velho, reescrever do zero. Migrations só importam quando v4.0 for para prod (vide ADR-001 §10).

### 4.2 Nova API backend

#### 4.2.1 `getTimeline` — manter shape, **mascarar** `pwrMap`+`activeUsers` consistente

Hoje o backend faz:
```js
docs = getEvents(...)
pwrMap = obj.devicePower   // cache stale
activeUsers = obj.userCache  // cache stale
```

Proposta: trocar `pwrMap`/`activeUsers` por uma única chamada server-side que **resolve o estado vivo** no momento da request:

```js
function resolveLiveState(nodeids) {
    var wsAgents = obj.meshServer.webserver.wsagents || {};
    nodeids.forEach(function(nid) {
        var ws = wsAgents[nid];
        var isOnline = !!ws;
        live[nid] = {
            online: isOnline,
            powerState: ws?.agentInfo?.powerState,  // 0=AC, 1=Battery
            ip: ws?._socket?.remoteAddress,
            currentUsers: isOnline ? (ws.users || []) : [],
            currentLusers: isOnline ? (ws.lusers || []) : [],
            lastconnect: doc.lastconnect,  // from DB fallback
            pwr: doc.pwr  // from DB fallback
        };
    });
    return live;
}
```

E o response fica:
```js
{
    action: 'plugin', plugin: 'usertracer', method: 'timeline',
    data: docs,
    _live: live,   // NOVO nome, substitui _pwrMap + _activeUsers
    _reqSeq: ...
}
```

#### 4.2.2 `getLiveSessions` — novo endpoint opcional

Para o frontend mais "puro", um endpoint que retorna sessões já resolvidas:

```js
// request
{ action:'plugin', plugin:'usertracer', pluginaction:'getLiveSessions', nodeids: [...] }
// response
{
    action: 'plugin', method: 'liveSessions',
    data: {
        node1: {
            online: true,
            currentUsers: [...],
            sessions: [{ user, state, since }, ...]  // login state atual
        },
        ...
    }
}
```

#### 4.2.3 Backend hooks reativos (substituir setInterval)

Substituir `obj.scanNow` por hooks:
- `hook_afterNotifyUserOfDeviceStateChange(myparent, meshid, nodeid, connectTime, connectType, powerState, serverid, stateSet, extraInfo)` — atualizar cache interno
- `hook_agentWebSocketDisconnected(meshagent)` — limpar cache do node
- Manter `scanNow` apenas como fallback a cada 5min para limpar stale entries

### 4.3 Mudanças no frontend

#### 4.3.1 `admin.handlebars:254` — usar `_live` em vez de `_activeUsers`

```js
sessions.forEach(function(s){
    var live = _live[s.nodeid] || {};
    var devOff = !live.online;
    if (devOff) {
        s.state = 'logout';  // dispositivo desligado → não pode estar "Online"
    } else if (s.open && s.state !== 'login' && s.state !== 'lock') {
        var da = live.currentUsers || [];
        // override só se device online E user bate
        ...
    }
});
```

#### 4.3.2 Substituir heurística por chamada explícita

No lugar de `_activeUsers[nodeid] || []`, usar `_live[nodeid]?.currentUsers || []`.

### 4.4 Contratos

| Quem | Antes | Depois |
|---|---|---|
| Backend `_pwrMap` | TTL 5min scanner | removido, substituído por `_live` reativo |
| Backend `_activeUsers` | TTL 5min scanner | removido, parte de `_live.online` |
| Frontend `_pwrMap` global | cacheado em `_pwrMap` | `_live` global |
| Frontend `_activeUsers` global | cacheado em `_activeUsers` | `_live[nodeid].currentUsers` |
| WS scan loop | setInterval 30s | hooks reativos + fallback 5min |

### 4.5 Limpeza (dev mode)

Projeto em dev — pode cortar sem deprecation:
- **Remover** `_pwrMap` do response WS
- **Remover** `_activeUsers` do response WS
- **Remover** `obj.devicePower`, `obj.userCache`, `obj.scanNow` (substituídos por `_live` calculado on-demand)
- **Remover** fallback de compatibilidade no frontend
- **Remover** heurística em `admin.handlebars:254` que override state para login

Quando v4.0 for para prod, vide ADR-001 §10 para estratégia de migrations/rollback.

### 4.6 Riscos

1. **`obj.meshServer.webserver.wsagents` é por server**. Se o MeshCentral tiver múltiplos servers (mesh federation), o plugin precisa iterar `obj.meshServer` em todos. Verificar `meshcentral.js:CreateSubServer` para mapear.
2. **`dbNodeKey` vs `nodeid`**: `wsagents` é indexado por `dbMeshKey+dbNodeKey`. Frontend manda só `nodeid`. Backend precisa converter ou iterar todos os `wsagents` para achar match.
3. **`ws.users` vs `ws.lusers`**: `meshagent.js:1976-1978` mostra que esses arrays são populados após `agentInfo`. Antes disso, vazios. Hook `hook_agentCoreIsStable` é o ponto de readiness.

---

## 5. Decisões fechadas (validadas)

| Pergunta | Decisão |
|---|---|
| Device online, sem user logado | **"Sem usuário"** — cor neutra (cinza claro/azul), distinto de "Offline" |
| Estratégia de migração | **Dev mode**: cutover limpo em v4.0. **Quando for para prod**: vide ADR-001 §10 (migrations + rollout + rollback) |
| Hooks vs scan | **Duas fases**: v4.0 adiciona hooks reativos + mantém `scanNow` como fallback; v4.1 remove `scanNow` após validação |
| Múltiplos servers (mesh federation) | OK — `wsagents` é local por server, plugin já roda em cada um |

## 6. Próximos passos

### 6.1 Implementar v4.0 (refator limpo, dev mode)

- [ ] Backend: `resolveLiveState(nodeids)` server-side usando `obj.meshServer.webserver.wsagents`
- [ ] Backend: trocar `_pwrMap`+`_activeUsers` por `_live` em `getTimeline`
- [ ] Backend: registrar `hook_afterNotifyUserOfDeviceStateChange` + `hook_agentWebSocketDisconnected`
- [ ] Frontend admin.handlebars: substituir heurística em linha 254 por uso de `_live[nodeid]`
- [ ] Frontend device.handlebars: ajustar `_renderGantt` (linhas 191-195) para consumir `_live`
- [ ] Frontend: novo label "Sem usuário" quando `live.online && live.currentUsers.length === 0`
- [ ] Frontend: sub-label com timestamp do último evento quando `!live.online`
- [ ] Auditoria: confirmar que `scanNow` é usado APENAS para popular `userCache`/`devicePower` antes de remover

### 6.2 Implementar v4.1 (pós-validação)

- [ ] Remover `scanNow` (ou TTL de 1h como sanity check)
- [ ] Remover `obj.devicePower` e `obj.userCache`
- [ ] `_live` calculado on-demand em cada request

### 6.3 Plano de teste

| Cenário | Status esperado |
|---|---|
| Device online, user com login state | Online (verde) |
| Device online, user com lock state | Bloqueado (laranja) — comportamento atual preservado |
| Device online, sem user no agent | Sem usuário (cinza claro) — **novo** |
| Device desligado, histórico com login | Offline (cinza) + sub-label "Online às HH:MM" |
| Device desligado, sem histórico | Offline (cinza) sem sub-label |
| Race: device desconectou entre last event e scan | Offline (cinza) — `_live.online=false` override imediato |

---

## Anexo A — referências nativas

- `obj.meshServer.webserver.wsagents[dbNodeKey]` — `analysis/core/02-webserver-routes.md:120`
- `obj.meshServer.GetConnectivityState(nodeid)` — `analysis/core/08-meshcentral-server.md:55`
- `hook_afterNotifyUserOfDeviceStateChange` — `analysis/HOOKS-CATALOG.md:22`
- `hook_agentWebSocketDisconnected(meshagent)` — `analysis/HOOKS-CATALOG.md:33`
- `ws.users`, `ws.lusers` (formato `DOMAIN\user`) — `meshagent.js:1976-1978` (não no repo, inferido)

## Anexo B — código atual envolvido

- `views/admin.handlebars:119, 254` — bug do Online sempre verde
- `views/device.handlebars:191-195` — uso correto de `pwrMap`
- `usertracer.js:170-241` — scanner `checkNode` com TTL 5min
- `usertracer.js:413-461` — `getTimeline` que junta cache stale
- `usertracer.js:81` — `obj.devicePower = {}` cache TTL
- `usertracer.js:80` — `obj.userCache = {}` cache de users

---

## Anexo C — patterns do MeshCentral relevantes para v4.0

### C.1 Manipulando `nodeid` em `hook_processAgentData`

> Atenção: `nodeid` pode vir como **string, objeto ou array** em diferentes paths.

```js
function normalizeNodeId(nodeid) {
    if (typeof nodeid === 'string') return nodeid;
    if (nodeid && typeof nodeid === 'object') return nodeid.nodeid || nodeid._id;
    return null;
}

obj.hook_processAgentData = function(data, nodeid) {
    var nid = normalizeNodeId(nodeid);
    if (!nid) return;
    // ... usar nid
};
```

### C.2 Convenção `addEventListener` no frontend

> NUNCA use `onmessage = fn` — substitui listeners e só permite um.
> NUNCA use `ms.onMessage = fn` — sobrescreve o do framework.
> SEMPRE `ms.socket.addEventListener('message', fn)`.

```js
(function() {
    var ph = (top && top.pluginHandler && top.pluginHandler.usertracer) ||
             (parent && parent.pluginHandler && parent.pluginHandler.usertracer);
    if (ph) {
        ph.timeline = function(message) {
            // PH callback para logging apenas — não renderizar aqui
            console.log('[PH timeline]', message);
        };
    }
    if (ms && ms.socket) {
        ms.socket.addEventListener('message', function(e) {
            try {
                var d = JSON.parse(e.data);
                if (d.action === 'plugin' && d.plugin === 'usertracer' && d.method === 'timeline') {
                    handleTimeline(d);   // WS handler owns all rendering
                }
            } catch (ex) { console.error(ex); }
        });
    }
})();
```

**Lição crítica**: PH callback roda PRIMEIRO. Se ambos manipulam estado (`_xrefPending`, `_reqSeq`), o WS handler vê estado modificado. Para v4.0: PH só loga, WS handler renderiza.

### C.3 Performance: 12 agentes em produção

| Operação | Latência |
|---|---|
| `obj.meshServer.db.Get(nodeid)` primeira vez | ~22ms (I/O disco) |
| `obj.meshServer.db.Get(nodeid)` subsequente | ~1ms (NeDB page cache) |
| `obj.meshServer.webserver.wsagents[nid]` lookup | <0.1ms |
| `obj.meshServer.GetConnectivityState(nid)` | <0.1ms |
| `obj.meshServer.DispatchEvent(['*'], ...)` 12 wssessions | ~5ms |

Para 100+ nodes, considerar paginação em `getTimeline` (já tem `limit: 5000`).

### C.4 Migrations via reloadPlugin

> "Reload" não dispara `updateMeshCore()`. Mudanças em `config.json` ou `modules_meshcore/` exigem **reinstalar** (delete + install).

Para v4.0 com mudanças no backend JS:
- Usuário clica "Reload" no admin → `require.cache` limpo, `server_startup` re-executa
- Frontend JS cacheado no browser: usuário precisa dar F5
- DB schema: se mudar collection NeDB, fazer migration script

### C.5 Lidando com múltiplos servers (mesh federation)

> Plugin roda em **cada** MeshCentral server independentemente. Cada server tem seu próprio `wsagents`, `wssessions2`, DB.

Se federado:
- Agent conecta ao server A → `wsagents` do server A
- Frontend conecta ao server B → request via server B → `getTimeline` executa no server B
- `wsagents` no server B **não** tem o agent → resultado parece offline

**Solução**: o plugin em cada server responde apenas sobre nodes que conectaram **àquele** server. MeshCentral federation sincroniza nodes via DB compartilhado mas **não** in-memory state. Para resolver cross-server, seria necessário IPC ou DB-shared cache (complexo). Documentar como limitação conhecida em v4.0.

### C.6 Debugging com `obj.debug`

```js
obj.debug('plugin:usertracer', '[hook] state change', nodeid, '→', isOnline ? 'online' : 'offline');
// Aparece no console do MeshCentral APENAS com flag --debug
```

Para debug sempre-on, usar `console.log('[UT]', ...)` (vai pro journal/stdout sempre).

### C.7 Padrão para `getTimeline` paginação

```js
// Frontend
ms.send({
    action: 'plugin', plugin: 'usertracer', pluginaction: 'getTimeline',
    startDate: '2026-07-01T00:00:00Z',
    endDate:   '2026-07-29T23:59:59Z',
    limit: 5000,         // max events
    skip: 0,             // pagination offset
    _reqSeq: ++_reqSeq
});
// Backend
var opts = { limit: command.limit || 5000, skip: command.skip || 0 };
obj.db.getEvents(query, opts, function(docs) { /* ... */ });
```

### C.8 Cleanup de timers no reload

```js
obj._timers = [];   // guardar refs

obj.server_startup = function() {
    obj._timers.push(setInterval(obj.scanNow, 30000));
};

// Quando recarregado, hook chama cleanup:
if (obj._timers) obj._timers.forEach(clearInterval);
obj._timers = [];
```

User-Device Tracer v3.5.x usa `obj._stopped` flag + `obj._stopScanner()`. Manter padrão.

## Anexo D — referências cruzadas para v4.0

| Tópico | Doc + linha |
|---|---|
| Plugin startup + object chain | `MESHCENTRAL-PLUGIN-GUIDE.md:55-118` |
| Hook `agentCoreIsStable` | `MESHCENTRAL-PLUGIN-GUIDE.md:260-275` |
| Hook `processAgentData` | `MESHCENTRAL-PLUGIN-GUIDE.md:277-290` |
| Hooks BitCtrl (wrapFunctionCall) | `MESHCENTRAL-PLUGIN-GUIDE.md:343-377` |
| WebSocket protocolo + envelopes | `MESHCENTRAL-PLUGIN-GUIDE.md:525-734` |
| `wsagents` runtime | `MESHCENTRAL-PLUGIN-GUIDE.md:1057-1067` |
| `db.Get` node doc completo | `MESHCENTRAL-PLUGIN-GUIDE.md:1073-1089` |
| DispatchEvent broadcast | `MESHCENTRAL-PLUGIN-GUIDE.md:1148-1174` |
| Debugging patterns | `MESHCENTRAL-PLUGIN-GUIDE.md:1178-1232` |
| Erros comuns | `MESHCENTRAL-PLUGIN-GUIDE.md:1236-1248` |
| Hooks nativos MeshCentral | `analysis/HOOKS-CATALOG.md:21-49` |
| Agent connect/disconnect | `analysis/HOOKS-CATALOG.md:154-157` |
| wsagents lookup | `analysis/PERGUNTA-RESPOSTA-NATIVA.md:14-36` |
| Power state | `analysis/PERGUNTA-RESPOSTA-NATIVA.md:190-200` |
| agentInfo (users, lusers, upnusers) | `analysis/PERGUNTA-RESPOSTA-NATIVA.md:236-244` |
- `usertracer.js:81` — `obj.devicePower = {}` cache TTL
- `usertracer.js:80` — `obj.userCache = {}` cache de users