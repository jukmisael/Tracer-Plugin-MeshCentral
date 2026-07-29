# ADR-001: Source-of-truth para "Live User State"

> **Status**: ✅ **Aceito** — implementação imediata
> **Contexto**: precisamos decidir se confiamos em dados server-side (`wsagents`, `agentInfo.users` populado no connect) ou se fazemos round-trip ao agent em cada request.
> **Decisão**: **Server-side, sem polling de agent** — usar `wsagents` runtime + cache derivado do `agentInfo` que o agent já envia no connect.
> **Migração**: zero. Projeto ainda em dev (v3.5.x); quando v4.0 for para prod, migrations serão necessárias (vide §10).

---

## 1. Contexto

O User-Device Tracer precisa saber, em cada request do frontend, **qual usuário está logado AGORA** em cada device, e se o device está **ligado**.

### Opções em jogo

| Opção | Como | Custo |
|---|---|---|
| **A. Confiar em `wsagents` runtime** | `!!parent.webserver.wsagents[nid]` | zero — in-memory |
| **B. Round-trip ao agent via `SendCommand`** | `wsagents[nid].send({pluginaction:'getUser'}); wsagents[nid].on(...)` | ~50-200ms por agent; depende do agent responder |
| **C. Cache local do `agentInfo.users`** | popula no `hook_agentCoreIsStable`, persiste em memória | zero no request; pode stale |
| **D. Híbrido: A + refresh via hook** | `wsagents` direto + invalidação em `agentWebSocketDisconnected` | zero no request; sempre fresh |

### Restrições de design (das docs)

- **`wsagents` é a fonte canônica runtime** (`core/02-webserver-routes.md:120`)
- **`agentInfo.users` é populado pelo agent no connect** (`meshagent.js:1976-1978`, `core/12-meshagent.md:31`)
- **`hook_agentCoreIsStable` dispara quando agentInfo completo** (`MESHCENTRAL-PLUGIN-GUIDE.md:260-275`)
- **Frontend MeshCentral já mostra "Do utilizador" na device list usando `wsagents[nid].users`** — funciona há anos

---

## 2. Análise das opções

### Opção A — `wsagents` puro

```js
var ws = obj.meshServer.webserver.wsagents[nid];
var online = !!ws;
var currentUsers = ws ? (ws.users || []) : [];
```

**Latência**: O(1) in-memory. < 0.1ms para 1000 nodes.
**Confiabilidade**: 100% canônico — quando o WebSocket fecha, o agente some.
**Risco**: quando o agent reinicia ou a conexão TCP morre, o `ws.on('close')` pode levar 1-3s para propagar. Mas o MeshCentral já trata isso via `hook_agentWebSocketDisconnected`.

**Veredito**: ✅ fonte de verdade primária.

### Opção B — Round-trip ao agent em cada request

```js
obj.meshServer.webserver.wsagents[nid].send(JSON.stringify({
    action: 'plugin', plugin: 'usertracer',
    pluginaction: 'getCurrentUserInfo', sessionid: sid
}));
// agent executa query user, responde via SendCommand
// server correlaciona via sessionid, responde ao frontend
```

**Latência**: 50-200ms por agent. **Adiciona latência desnecessária** — o dado já está no server desde o connect.
**Custo**: 1 round-trip TCP por agent por request. Com 100 devices numa página = 100 round-trips.
**Confiabilidade**: depende do agent responder a tempo. Se agent travou, request falha.
**Custo de CPU no agent**: cada `query user` (Windows) ou `who` (Linux) spawna processo. Em polling de 30s × 100 devices = 100 spawns/min no endpoint.

**Veredito**: ❌ redundante, caro, latência desnecessária.

### Opção C — Cache local de `agentInfo.users`

Hook `hook_agentCoreIsStable` recebe o agentSession completo:
```js
obj.hook_agentCoreIsStable = function(myparent, gp) {
    obj._liveCache[myparent.dbNodeKey] = {
        online: true,
        currentUsers: myparent.users || [],
        currentLusers: myparent.lusers || [],
        connectTime: myparent.connectTime,
        powerState: myparent.agentInfo && myparent.agentInfo.powerState,
        updatedAt: Date.now()
    };
};
```

Hook `hook_agentWebSocketDisconnected` invalida:
```js
obj.hook_agentWebSocketDisconnected = function(meshagent) {
    if (meshagent && meshagent.dbNodeKey && obj._liveCache[meshagent.dbNodeKey]) {
        obj._liveCache[meshagent.dbNodeKey].online = false;
        obj._liveCache[meshagent.dbNodeKey].disconnectedAt = Date.now();
    }
};
```

**Latência no request**: O(1) cache lookup. < 0.1ms.
**Freshness**: atualiza em **sub-segundo** quando agent conecta/desconecta (via hooks).
**Confiabilidade**: mesma de A, mas com cache intermediário.
**Risco**: race entre `hook_agentCoreIsStable` e primeira request (raro — agent só fica "stable" depois do coreinfo completo).

**Veredito**: ✅ mesma info que A, mas com cache indexado por dbNodeKey (mais ergonômico que iterar `wsagents`).

### Opção D — Híbrido: A + hooks para invalidar/refresh

Combina:
- **A no request**: `wsagents[nid]` direto (sem cache)
- **Hook no connect**: atualiza `_liveCache[nid]` para usar depois
- **Hook no disconnect**: marca offline

Latência no request: igual a A (consulta `wsagents` direto).
Latência no broadcast: zero (hooks).
**Veredito**: ✅ máxima reatividade, sem round-trip.

---

## 3. Comparação de performance (100 devices)

| Opção | Latência/request | CPU/agent | Requests/servidor | Falha silenciosa? |
|---|---|---|---|---|
| A. wsagents puro | < 0.1ms × N | 0 | 1 | não |
| B. SendCommand polling | 100-200ms × N | 1 spawn/agent/request | 1 por agent | sim (agent travado) |
| C. Cache via hooks | < 0.1ms × N | 0 (push no connect) | 1 | não (hooks reativos) |
| D. A + hooks refresh | < 0.1ms × N | 0 | 1 | não |

**Opção B perde em todas as dimensões.**

---

## 4. Casos especiais

### 4.1 Device acabou de conectar, `agentCoreIsStable` ainda não disparou

Entre `ws.on('open')` e `hook_agentCoreIsStable` pode haver 100-500ms (agent envia agentInfo, caps, etc.). Durante essa janela:
- **A**: `wsagents[nid]` existe mas `ws.users` pode estar vazio
- **C**: `_liveCache[nid]` ainda não populado

**Mitigação**: ler `wsagents[nid].users || []` direto em C. Se hook ainda não rodou, tem fallback. Aguardar `hook_agentCoreIsStable` populou 99% dos casos em < 1s.

### 4.2 Agent reiniciou (reconnect)

- **A**: `wsagents[nid]` é NOVO objeto (MeshCentral recria). Dados frescos.
- **C**: cache é atualizado pelo hook. Se hook rodou antes da próxima request, OK. Race possível.

**Mitigação em C**: marcar `_liveCache[nid].updatedAt = Date.now()` no hook; no request, comparar com `Date.now() - 30s` para decidir se confia ou faz fallback para `wsagents`.

### 4.3 Server reiniciou (downtime)

- **A**: `wsagents` está vazio até agents reconnectarem
- **C**: cache está vazio até hooks rodarem

Ambos perdem info durante downtime. **Não há solução sem persistência externa** — e persistir live state em DB é o anti-pattern que estamos evitando.

### 4.4 Mesh federation

Cada server MeshCentral tem seu próprio `wsagents`. Plugin roda em cada server independentemente.
- **A/C/D**: cada server responde apenas sobre nodes conectados **àquele** server
- Isso é correto: a verdade é local ao server

**Documentar como limitação conhecida** — federation sync de live state exige infra extra (DB compartilhado + IPC).

---

## 5. Decisão recomendada

**Opção C com fallback para A** — cache populado via hooks, com fallback para `wsagents` direto se cache stale ou ausente.

```js
function resolveLiveState(nodeids) {
    var wsAgents = obj.meshServer.webserver.wsagents || {};
    var cache = obj._liveCache || {};
    var live = {};
    var now = Date.now();

    nodeids.forEach(function(nid) {
        // 1. Tentar cache primeiro (hooks reativos)
        var cached = cache[nid];
        if (cached && (now - cached.updatedAt) < 30000) {
            live[nid] = cached;
            return;
        }
        // 2. Fallback: wsagents runtime
        var ws = wsAgents[nid];
        if (ws) {
            live[nid] = {
                online: true,
                currentUsers: ws.users || [],
                currentLusers: ws.lusers || [],
                powerState: ws.agentInfo && ws.agentInfo.powerState,
                source: 'wsagents-fallback',
                updatedAt: now
            };
        } else {
            // 3. Offline + db fallback (mantido do design anterior)
            live[nid] = { online: false, source: 'offline' };
            // db.Get assíncrono pode popular lastSeen
        }
    });

    return live;
}
```

### Por quê esta combinação

1. **Sub-segundo freshness** via `hook_agentCoreIsStable` (push no connect)
2. **Zero polling** de agent — nenhum SendCommand para "qual user está logado"
3. **Robusto** — se hook não disparou (raro), fallback `wsagents` direto funciona igual
4. **Sem dependência de `agentInfo` estar completo** — `ws.users` no `wsagents` é populado assim que agent envia (mesmo antes de `agentCoreIsStable`)
5. **Reativo a disconnect** — `hook_agentWebSocketDisconnected` invalida cache imediatamente

### Por que NÃO opção B (poll agent)

1. **`agentInfo.users` já tem os dados** — `command.users` enviado pelo MeshAgent no connect (formato `DOMAIN\username`, mesmo do `doc.users`). O server JÁ tem.
2. **Latência**: 50-200ms × N devices por request = degrada UI admin
3. **Carga no agent**: cada "qual user" executa `query user` (Windows) — overhead nativo
4. **Falha silenciosa**: agent travado = frontend trava esperando resposta
5. **Redundância**: dados já chegaram ao server; re-pedir é desperdiçar round-trip

### Edge case: query user durante sessão RDP

Cenário: usuário A logado, abre RDP com usuário B. `query user` no Windows pode mostrar ambos. **Mas `wsagents[nid].users` (enviado pelo MeshAgent) também refletiria isso** porque o MeshAgent usa WTSAPI/WinAPI para detectar sessões ativas, não spawna `query user`.

Conclusão: ambos os métodos veem o mesmo estado real. Não há diferença de precisão entre "consultar server" e "consultar agent" para **este caso de uso**.

---

## 6. Quando **POLLING do agent SERIA** justificado?

Só se o plugin precisasse de **info que NÃO está em `agentInfo`**. Exemplos:

- Lista de **processos rodando** (não vem no agentInfo)
- **Conteúdo de arquivos** específicos (regedit, eventlog)
- **Screenshots ao vivo**
- **Métricas de performance** (CPU, RAM, network)

Para User-Device Tracer (rastreamento de user sessions), **nenhuma dessas é necessária**. Confiar no server é a abordagem correta.

---

## 7. Implementação concreta (v4.0)

### server_startup
```js
obj._liveCache = {};   // {dbNodeKey: liveState}

if (obj.parent && typeof obj.parent.wrapFunctionCall === 'function') {
    obj.parent.wrapFunctionCall(obj.meshServer, 'NotifyUserOfDeviceStateChange');
}
```

### Hooks
```js
obj.hook_afterNotifyUserOfDeviceStateChange = function(stateSet, meshid, nodeid, connectTime, connectType, powerState) {
    if (!nodeid) return stateSet;
    obj._liveCache[nodeid] = {
        online: true,
        powerState: powerState,
        connectTime: connectTime,
        currentUsers: obj.meshServer.webserver.wsagents[nodeid]?.users || [],
        source: 'hook',
        updatedAt: Date.now()
    };
    return stateSet;
};

obj.hook_agentWebSocketDisconnected = function(meshagent) {
    if (!meshagent || !meshagent.dbNodeKey) return;
    var nid = meshagent.dbNodeKey;
    if (obj._liveCache[nid]) {
        obj._liveCache[nid].online = false;
        obj._liveCache[nid].disconnectedAt = Date.now();
    } else {
        obj._liveCache[nid] = { online: false, source: 'hook-disconnect', updatedAt: Date.now() };
    }
};

obj.hook_agentCoreIsStable = function(myparent, gp) {
    if (!myparent || !myparent.dbNodeKey) return;
    obj._liveCache[myparent.dbNodeKey] = {
        online: true,
        currentUsers: myparent.users || [],
        currentLusers: myparent.lusers || [],
        powerState: myparent.agentInfo && myparent.agentInfo.powerState,
        source: 'agentCoreIsStable',
        updatedAt: Date.now()
    };
};
```

### request handler (getTimeline)
```js
function resolveLiveState(nodeids) {
    var wsAgents = obj.meshServer.webserver.wsagents || {};
    var cache = obj._liveCache || {};
    var live = {};
    var now = Date.now();

    nodeids.forEach(function(nid) {
        var cached = cache[nid];
        if (cached && (now - cached.updatedAt) < 30000) {
            live[nid] = cached;
            return;
        }
        var ws = wsAgents[nid];
        if (ws) {
            live[nid] = {
                online: true,
                currentUsers: ws.users || [],
                currentLusers: ws.lusers || [],
                powerState: ws.agentInfo && ws.agentInfo.powerState,
                source: 'wsagents',
                updatedAt: now
            };
        } else {
            live[nid] = { online: false, source: 'offline', updatedAt: now };
        }
    });

    return live;
}
```

---

## 8. Métricas esperadas (validação em produção)

Para confirmar a decisão:

| Métrica | Esperado |
|---|---|
| Latência média `getTimeline` (50 nodes) | < 5ms (era ~30ms com scanner) |
| CPU do MeshCentral (idle, 100 agents) | < 1% (era ~3% com setInterval 30s) |
| Latência entre agent disconnect → "Offline" no frontend | < 1s (era até 5min) |
| Latência entre agent connect → user correto no frontend | < 1s (era até 30s) |

Se essas métricas não baterem, rever.

---

## 9. Conclusão

**Confiar no server é a abordagem correta e mais performática.** O MeshCentral já coleta os dados do agent no connect (`agentInfo.users`) e mantém runtime em `wsagents`. Round-trips adicionais ao agent para User-Device Tracer são **desnecessários e contraproducentes**.

A escolha B (poll agent) só faria sentido se precisássemos de dados que NÃO estão em `agentInfo` — o que não é o caso aqui.

---

## 10. Migrations futuras (quando v4.0 for para prod)

Atualmente projeto em **dev (v3.5.x)** — mudanças de shape podem ser livre. Quando v4.0 for para **produção**, será indispensável:

### 10.1 Schema DB (NeDB `tracerEvents`)

| v3.5.x | v4.0 | Migration |
|---|---|---|
| sem campo `nodeState` | `nodeState: 'online'\|'offline'\|'unknown'` | backfill com default 'unknown' |
| `_pwrMap`/`_activeUsers` no response WS | `_live` | sem migration DB; só WS contract |
| sem TTL em `tracerEvents` | `expireAfterSeconds: 2592000` (30d) | `obj.db.compact()` + script que set TTL em docs existentes |

### 10.2 Plugin manifest (`config.json`)

| v3.5.x | v4.0 | Migration |
|---|---|---|
| `version: "3.5.82"` | `version: "4.0.0"` | bump major; cliente recebe notification de update |
| `meshCentralCompat: ">=1.0.0"` | mantém (mesma compat) | nada |

### 10.3 Cache in-memory (`obj._liveCache`)

Não persiste — se reiniciar server, cache reconstrói via hooks ao agent reconnect. **Não precisa migration**.

### 10.4 Frontend JS cacheado no browser

> "Reload" não dispara update do JS no browser. Usuário precisa F5.

Quando v4.0 for para prod:
1. **Forçar reload**: WebSocket message especial no login que avisa "plugin updated, please F5"
2. **Cache-busting**: appendar `?v=4.0.0` na URL do plugin JS
3. **Documentar no changelog**: "se badge Online/Offline não aparecer, F5"

### 10.5 Hooks requeridos (`hook_agentCoreIsStable`, etc.)

Disponibilidade depende do MeshCentral:
- v1.0+: `hook_agentCoreIsStable` nativo
- v1.2+: `hook_afterNotifyUserOfDeviceStateChange` (talvez precise `wrapFunctionCall` via PluginHookScheduler)
- v1.2+: `hook_agentWebSocketDisconnected` nativo

**Verificar em produção**: se hook não dispara, fazer fallback para polling via `scanNow` em TTL longo (5min).

### 10.6 Rollout strategy

```
v4.0.0-rc.1 → deploy em staging, smoke test
v4.0.0-rc.2 → fix bugs encontrados
v4.0.0     → deploy prod com changelog avisando F5 necessário
              (usuários com F5 pendente verão "_live=undefined" → fallback silencioso)
```

### 10.7 Rollback strategy

Se v4.0 falhar em prod:
1. Revert commit → servidor carrega v3.5.x do cache
2. Usuários com cache JS v4.0 verão contrato `_live` ausente → tratar com fallback no frontend:
```js
// Frontend v4.0 deve ser defensivo
var live = d._live || {
    [nid]: { online: null, currentUsers: d._activeUsers?.[nid] || [] }
};
```
**Esse fallback já é o que está no §3.1 do study doc.**

---

## 11. TL;DR

**Agora (dev)**: implementar v4.0 sem se preocupar com compat. Cortar tudo que é velho, refator limpo.

**Depois (prod)**: o frontend precisa saber lidar com `d._live === undefined` (cliente com JS antigo servindo junto com backend novo, ou vice-versa). Backend v4.0 sempre envia `_live`. Frontend v4.0 deve ter fallback para `_activeUsers` apenas como transitional safety net.