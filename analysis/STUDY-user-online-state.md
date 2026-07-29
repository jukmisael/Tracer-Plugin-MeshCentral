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

`wsagents` (in-memory `parent.webserver.wsagents`) é a fonte reativa canônica: presença = agente conectado. Mas só é válido durante a vida do server (não persistido).

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
| `parent.webserver.wsagents[nodeid]` | sim (in-memory) | não | `core/02-webserver-routes.md:120` |
| `parent.GetConnectivityState(nodeid)` | cache | não | `core/08-meshcentral-server.md:55` |
| `doc.pwr` / `doc.conn` (DB) | lag ~segundos | sim | `core/05-db-api.md` |
| `hook_afterNotifyUserOfDeviceStateChange` | reativo | depende de quem ouve | `core/08-meshcentral-server.md:59` |

### 2.5 User info já disponível no agent connect

Quando o MeshAgent conecta, ele envia `command.users`, `command.lusers`, `command.upnusers` (vide `meshagent.js:1976-1978`, inferido do contexto). Esses arrays ficam em `meshagent.users` / `meshagent.lusers` (formato `DOMAIN\username`). Quando o agente desconecta, esses dados somem de `wsagents` mas ficam persistidos em `doc.users`/`doc.lusers`.

Então a verdade "live" = `wsagents[dbNodeKey].users`. A verdade "persisted" = `doc.users` (pode estar stale).

---

## 3. Proposta de design (v4.0)

### 3.1 Princípios

1. **Backend é fonte de verdade para "live state"**. Frontend renderer puro.
2. **Join devicePower+activeUsers server-side**. Frontend recebe "sessão resolvida" ou recebe pwrMap+activeUsers **consistentes** com o mesmo timestamp.
3. **Reativo, sem polling**. Usar `hook_afterNotifyUserOfDeviceStateChange` para atualizar cache interno.
4. **Manter compatibilidade**: contratos WS existentes continuam funcionando; novo endpoint é aditivo.

### 3.2 Nova API backend

#### 3.2.1 `getTimeline` — manter shape, **mascarar** `pwrMap`+`activeUsers` consistente

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

#### 3.2.2 `getLiveSessions` — novo endpoint opcional

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

#### 3.2.3 Backend hooks reativos (substituir setInterval)

Substituir `obj.scanNow` por hooks:
- `hook_afterNotifyUserOfDeviceStateChange(myparent, meshid, nodeid, connectTime, connectType, powerState, serverid, stateSet, extraInfo)` — atualizar cache interno
- `hook_agentWebSocketDisconnected(meshagent)` — limpar cache do node
- Manter `scanNow` apenas como fallback a cada 5min para limpar stale entries

### 3.3 Mudanças no frontend

#### 3.3.1 `admin.handlebars:254` — usar `_live` em vez de `_activeUsers`

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

#### 3.3.2 Substituir heurística por chamada explícita

No lugar de `_activeUsers[nodeid] || []`, usar `_live[nodeid]?.currentUsers || []`.

### 3.4 Contratos

| Quem | Antes | Depois |
|---|---|---|
| Backend `_pwrMap` | TTL 5min scanner | removido, substituído por `_live` reativo |
| Backend `_activeUsers` | TTL 5min scanner | removido, parte de `_live.online` |
| Frontend `_pwrMap` global | cacheado em `_pwrMap` | `_live` global |
| Frontend `_activeUsers` global | cacheado em `_activeUsers` | `_live[nodeid].currentUsers` |
| WS scan loop | setInterval 30s | hooks reativos + fallback 5min |

### 3.5 Compatibilidade

- `_reqSeq` mantido (já existe)
- `data` array mantido (events brutos)
- Novo `_live` é **aditivo** — frontend antigo ignora, novo frontend consome
- Frontend pode fazer **migração gradual**: ler `_live` se presente, fallback para `_pwrMap`+`_activeUsers` se não

### 3.6 Riscos

1. **`parent.webserver.wsagents` é por server**. Se o MeshCentral tiver múltiplos servers (mesh federation), o plugin precisa iterar `obj.parent.webserver` em todos. Verificar `meshcentral.js:CreateSubServer` para mapear.
2. **`dbNodeKey` vs `nodeid`**: `wsagents` é indexado por `dbMeshKey+dbNodeKey`. Frontend manda só `nodeid`. Backend precisa converter ou iterar todos os `wsagents` para achar match.
3. **`ws.users` vs `ws.lusers`**: `meshagent.js:1976-1978` mostra que esses arrays são populados após `agentInfo`. Antes disso, vazios. Hook `hook_agentCoreIsStable` é o ponto de readiness.

---

## 4. Decisões fechadas (validadas)

| Pergunta | Decisão |
|---|---|
| Device online, sem user logado | **"Sem usuário"** — cor neutra (cinza claro/azul), distinto de "Offline" |
| Device desligado | **Mostrar ambos**: status atual reflete device state + sub-label com timestamp do último evento do user (ex: "Online às 14:32") |
| Estratégia de migração | **Cutover total** em v4.0: remove `_pwrMap` e `_activeUsers` do backend; frontend lê só `_live`. Rollout por versão de plugin (usuário precisa recarregar) |
| Hooks vs scan | **Duas fases**: v4.0 adiciona hooks reativos + mantém `scanNow` como fallback; v4.1 remove `scanNow` após validação |
| Múltiplos servers (mesh federation) | OK — `wsagents` é local por server, plugin já roda em cada um |

## 5. Próximos passos

### 5.1 Implementar v4.0 (cutover total)

- [ ] Backend: `resolveLiveState(nodeids)` server-side usando `parent.webserver.wsagents`
- [ ] Backend: trocar `_pwrMap`+`_activeUsers` por `_live` em `getTimeline`
- [ ] Backend: registrar `hook_afterNotifyUserOfDeviceStateChange` + `hook_agentWebSocketDisconnected`
- [ ] Frontend admin.handlebars: substituir heurística em linha 254 por uso de `_live[nodeid]`
- [ ] Frontend device.handlebars: ajustar `_renderGantt` (linhas 191-195) para consumir `_live`
- [ ] Frontend: novo label "Sem usuário" quando `live.online && live.currentUsers.length === 0`
- [ ] Frontend: sub-label com timestamp do último evento quando `!live.online`
- [ ] Auditoria: confirmar que `scanNow` é usado APENAS para popular `userCache`/`devicePower` antes de remover

### 5.2 Implementar v4.1 (pós-validação)

- [ ] Remover `scanNow` (ou TTL de 1h como sanity check)
- [ ] Remover `obj.devicePower` e `obj.userCache`
- [ ] `_live` calculado on-demand em cada request

### 5.3 Plano de teste

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

- `parent.webserver.wsagents[dbNodeKey]` — `analysis/core/02-webserver-routes.md:120`
- `parent.GetConnectivityState(nodeid)` — `analysis/core/08-meshcentral-server.md:55`
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