> ⚠️ **Escopo deste repositório**: o projeto é o **plugin User-Device Tracer** (`usertracer.js` + `views/*.handlebars` + `db.js`). Os documentos em `analysis/` descrevem **APIs do MeshCentral upstream** referenciadas pelo plugin, mas os links para `core/*.md` e `plugins/<name>/*.md` apontam para arquivos de **análise que não existem neste repo**. Esses links devem ser lidos como "vide análise upstream em fonte externa" — o source real está em `C:\tmp\MeshCentral\`.
>
> **O que ESTÁ no repositório** e tem documentação prática:
> - Plugin server-side: `usertracer.js` (linhas e funções referenciadas nos docs ADR/STUDY)
> - Plugin frontend: `views/admin.handlebars`, `views/device.handlebars`
> - DB layer: `db.js` (NeDB/MongoDB/SQL delegate)
> - Guias ADR: `analysis/ADR-001-live-state-source.md`, `analysis/ADR-002-acl-native.md`
> - Estudo de heurística: `analysis/STUDY-user-online-state.md`
> - Guia de fluxo: `analysis/HOOKS-CATALOG.md` (hooks do core), `analysis/FLUXOS-E2E.md` (fluxos upstream)

# MeshCentral Plugin Development — Documentação Técnica Completa

> **HUB central** de navegação para toda a documentação dividida em `/analysis/`

## Visão geral

O **MeshCentral** é um servidor de gerenciamento remoto open-source escrito em Node.js. Seu sistema de plugins (introduzido em ~v0.4 e refinado em v1.1.x) permite estender o servidor em três eixos: **server-side logic** (manipular eventos, ACL, persistência, broadcast), **frontend UI** (injetar tabs, iframes, modais, DOM hooks via um bundle JS serializado) e **agent-side code** (injetar JavaScript no Duktape runtime dentro do binário do MeshAgent, prefixado por plataforma: `win-`, `linux-`, `amt-`). Os plugins vivem em `datapath/plugins/<shortName>/` e são carregados pelo `pluginHandler` na inicialização, expostos via um manifest `config.json` opcional e gerenciados via install/zip/git (vide [`core/01-pluginhandler.md`](core/01-pluginhandler.md)).

Esta documentação existe porque a referência canônica do MeshCentral é esparsa: o `webserver.js` upstream tem **10.924 linhas**, `meshcentral.js` tem **4.497 linhas**, `db.js` tem **4.277 linhas** e três arquivos críticos (`meshuser.js`, `meshagent.js`, `meshrelay.js`) **não estão no repositório público** — eles só existem no binário. Para construir plugins reais você precisa ler o source `meshcentral-source/`, os 12 plugins da comunidade analisados em [`plugins/`](plugins/) e reconstruir por inferência as APIs que estão no binário. Esta coleção de 16 docs core + 12 plugin docs + 4 docs de navegação cobre exatamente isso, com snippets de código original, citações `arquivo:linha` e padrões cross-referenceados.

## Índice

### 1. 📚 Documentos centrais do MeshCentral (`/analysis/core/`)

| # | Arquivo | Resumo |
|---|---------|--------|
| 01 | [`01-pluginhandler.md`](core/01-pluginhandler.md) | `pluginHandler.js` (297 linhas) — orquestrador de plugins: load, install, exports, permissões, addMeshCoreModules |
| 02 | [`02-webserver-routes.md`](core/02-webserver-routes.md) | `webserver.js` (10924 linhas, stub local) — Express + WebSocket routes, mesh handlers, dispatch |
| 03 | [`03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md) | `webserver.js` subset — `encodeCookie`/`decodeCookie`, `GetNodeWithRights`, `requireUser`/`requireAdmin`/`requireNodeRights` |
| 04 | [`04-webserver-views-render.md`](core/04-webserver-views-render.md) | `webserver.js` subset — Express+Handlebars, `default.handlebars`, helpers globais do front (`Q`/`QH`/`meshserver.send`) |
| 05 | [`05-db-api.md`](core/05-db-api.md) | `db.js` (4277 linhas) — factory multi-backend (NeDB/Mongo/Maria/MySQL/PG/AceBase/SQLite), CRUD genérico, AES-256-GCM field-level |
| 06 | [`06-db-events-power-sysinfo.md`](core/06-db-events-power-sysinfo.md) | `db.js` subset — TTL streams: `eventsFile` (20d), `powerFile` (10d), `serverStats` (30d) |
| 07 | [`07-db-pluginsystem.md`](core/07-db-pluginsystem.md) | `db.js` subset — `getPlugins`/`addPlugin`/`setPluginStatus`/`getPluginPermissions` + schema de `pluginpermissions_<shortName>` |
| 08 | [`08-meshcentral-server.md`](core/08-meshcentral-server.md) | `meshcentral.js` (4497 linhas) — orquestrador do servidor: Start, sub-servers, DispatchEvent, `updateMeshCore`, encodeCookie |
| 09 | [`09-meshcentral-event-dispatch.md`](core/09-meshcentral-event-dispatch.md) | `meshcentral.js` subset — `DispatchEvent`/`AddEventDispatch`, convenções de `ids` (`*`/`server-users`/`mesh/...`) |
| 10 | [`10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md) | `meshcentral.js` subset — `updateMeshCore` (gzip+SHA256), `addMeshCoreModules`, `signMeshAgents`, prefix routing |
| 11 | [`11-meshuser.md`](core/11-meshuser.md) | `meshuser.js` — **arquivo NÃO encontrado no repo**; análise inferida (dispatchEvent, handleUserMessage) |
| 12 | [`12-meshagent.md`](core/12-meshagent.md) | `meshagent.js` — **arquivo NÃO encontrado**; análise inferida (agentInfo, caps, hook lifecycle) |
| 13 | [`13-meshrelay.md`](core/13-meshrelay.md) | `meshrelay.js` — **arquivo NÃO encontrado**; `CreateMeshRelay`/`CreateLocalRelay`, `rauth`, `forceSrcPort` |
| 14 | [`14-common-utils.md`](core/14-common-utils.md) | `common.js` (101 linhas) — binary codec, validação, `isAlphaNumeric`, `createTaskLimiterQueue`, `escapeHtml` |
| 15 | [`15-package-deps.md`](core/15-package-deps.md) | `package.json` — `meshcentral@1.2.4`, Node ≥20, deps: `@seald-io/nedb`, `express`, `express-handlebars`, `ws`, `yauzl` |
| 16 | [`16-pass-password.md`](core/16-pass-password.md) | `pass.js` — **arquivo NÃO encontrado**; PBKDF2-SHA-512 + AES-256-GCM inferido |

### 2. 🔌 Plugins da comunidade (`/analysis/plugins/<name>/`)

| # | Plugin | Resumo (2 linhas) |
|---|--------|-------------------|
| 1 | [`agentname2servername/`](plugins/agentname2servername/) | Sincroniza `--agentName` (CLI arg do MeshAgent) com `meshagent.agentInfo.computerName`. Usa `hook_afterCreateMeshAgent` via PluginHookScheduler. |
| 2 | [`devtools/`](plugins/devtools/) | Utilitários para devs: install/delete/edit plugin config via JSON, refresh do pluginHandler, restart server (`process.exit(123)`). |
| 3 | [`eventlog/`](plugins/eventlog/) | Captura Windows Event Logs em agentes; tem **Live** stream (WebRTC via `CreateAgentRedirect`) e **History** (TTL 30 dias no MongoDB/NeDB local). |
| 4 | [`filedist/`](plugins/filedist/) | Distribui arquivos do servidor para agentes: mappings `serverpath→clientpath`, integrity check a cada 20min, streaming hex chunks. |
| 5 | [`pluginhookexample/`](plugins/pluginhookexample/) | Template educacional: 11 hooks backend + 2 hooks custom via `wrapFunctionCall`; auto-gera 2 sub-plugins (`_1` e `_2`). |
| 6 | [`pluginhookscheduler/`](plugins/pluginhookscheduler/) | **Infraestrutura para outros plugins**: substitui `pluginHandler.callHook` por scheduler ordenável e adiciona API `wrapFunctionCall` para AOP. |
| 7 | [`printercontrol/`](plugins/printercontrol/) | Gerencia impressoras Windows (inventory, jobs, drivers, spooler) via PowerShell in-memory; 5 permissions granulares, request/response via `requestId` 36-hex. |
| 8 | [`regedit/`](plugins/regedit/) | Windows Registry Explorer/Editor remoto (HKLM/HKCU/HKCR/HKU/HKCC); request/response via `sessionid`; 11 ops + search + import/export. |
| 9 | [`routeplus/`](plugins/routeplus/) | TCP port-forwarding multi-mapping entre nodes com `forceSrcPort` e `remotetarget`; injeta link "RoutePlus RDP" no device page. |
| 10 | [`sample/`](plugins/sample/) | Plugin **mínimo absoluto**: 1 export (`onDesktopDisconnect`), 1 hook (frontend), sem DB nem UI — ideal template para hooks client-side. |
| 11 | [`scripttask/`](plugins/scripttask/) | Scripts PowerShell/Batch/Bash sob demanda + agendamento (once/minutes/hourly/daily/weekly); sistema de variáveis `#var#` multi-escopo. |
| 12 | [`workfromhome/`](plugins/workfromhome/) | RDP-relay single-user: cada user tem 1 laptop (`fromNode`) que faz relay para uma workstation; download `.rdp`, support AAD/NLA. |

### 3. Guias de referência rápida

- ❓ **[`PERGUNTA-RESPOSTA-NATIVA.md`](PERGUNTA-RESPOSTA-NATIVA.md)** — quando você precisa saber **COMO pegar X** ("Como pego todos agentes online?", "Como checo ACL do user?", "Como abro WebRTC?"). 40+ perguntas com caminho mais nativo + fallback, código de 5-15 linhas, localização `arquivo:linha` e suporte por backend.

- ⚙️ **[`HOOKS-CATALOG.md`](HOOKS-CATALOG.md)** — lista **exhaustiva** de hooks: server-side (chamados pelo core), frontend (via `obj.exports`), e `wrapFunctionCall`-derived (injetados em funções arbitrárias).

- 🔄 **[`FLUXOS-E2E.md`](FLUXOS-E2E.md)** — diagramas ASCII de **9 fluxos end-to-end**: Browser→Plugin, Browser→Plugin→Agent→Browser, broadcast, login, install plugin, connect agent, permission check, updateMeshCore.

## Como usar esta documentação

**Por task ("estou tentando fazer X"):** Comece pelo [`PERGUNTA-RESPOSTA-NATIVA.md`](PERGUNTA-RESPOSTA-NATIVA.md) — ele indexa a pergunta humana para o caminho mais nativo da API MeshCentral. Cada Q&A cita o arquivo core ou plugin onde o padrão está documentado com snippet completo. Se a pergunta é sobre "quando X dispara", vá para [`HOOKS-CATALOG.md`](HOOKS-CATALOG.md). Se é sobre "como dados fluem entre browser/agente/server", vá para [`FLUXOS-E2E.md`](FLUXOS-E2E.md).

**Por plugin pattern ("estou clonando a lógica de Y"):** Vá direto em [`plugins/<name>/01-overview.md`](plugins/) — cada overview documenta o **propósito**, **estrutura de arquivos**, **componentes principais** (server-side/agent-side/frontend), **request/response correlation**, **config schema** e **cruzamentos**. Depois mergulhe nos `02-*.md` (server), `03-*.md` (agent), `04-*.md` (views) conforme o aspecto que você quer reproduzir. Os plugins mais "full-stack" são [`eventlog/`](plugins/eventlog/) (6 arquivos, 3 modos, WebRTC) e [`printercontrol/`](plugins/printercontrol/) (permissions granulares, requestId correlation, PowerShell gzip-embedded).

**Por objeto do MeshCentral ("o que é `meshserver`?" / "como `webserver.wssessions2` funciona?"):** Comece nos core docs:
- `meshserver` → [`core/08-meshcentral-server.md`](core/08-meshcentral-server.md)
- `pluginHandler` → [`core/01-pluginhandler.md`](core/01-pluginhandler.md)
- `webserver` (rotas) → [`core/02-webserver-routes.md`](core/02-webserver-routes.md)
- `webserver` (auth/ACL) → [`core/03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md)
- `webserver` (views/front) → [`core/04-webserver-views-render.md`](core/04-webserver-views-render.md)
- `db` (CRUD) → [`core/05-db-api.md`](core/05-db-api.md)
- `db` (TTL streams) → [`core/06-db-events-power-sysinfo.md`](core/06-db-events-power-sysinfo.md)
- `db` (plugin metadata) → [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md)
- `DispatchEvent` → [`core/09-meshcentral-event-dispatch.md`](core/09-meshcentral-event-dispatch.md)
- `updateMeshCore`/agent signing → [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md)
- `MeshUser` (classe browser-side) → [`core/11-meshuser.md`](core/11-meshuser.md)
- `MeshAgent` (classe agent-side server) → [`core/12-meshagent.md`](core/12-meshagent.md)
- `MeshRelay`/`LocalRelay` → [`core/13-meshrelay.md`](core/13-meshrelay.md)
- `common` (utils) → [`core/14-common-utils.md`](core/14-common-utils.md)

## Quick links para perguntas comuns

| Pergunta | Vá para |
|----------|---------|
| "Como pego todos agentes online?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 1`](PERGUNTA-RESPOSTA-NATIVA.md#1-agentes-conectados) |
| "Como checo ACL de um user em um node?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 4`](PERGUNTA-RESPOSTA-NATIVA.md#4-meshesdevice-groups) + [`core/03-webserver-auth-acl.md`](core/03-webserver-auth-acl.md) |
| "Como registro permissões do meu plugin?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 6`](PERGUNTA-RESPOSTA-NATIVA.md#6-permissões) + [`core/07-db-pluginsystem.md`](core/07-db-pluginsystem.md) |
| "Como mando um comando pro agente e recebo resposta?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 5`](PERGUNTA-RESPOSTA-NATIVA.md#5-comunicação) + [`plugins/printercontrol/02-server.md`](plugins/printercontrol/02-server.md) (requestId pattern) |
| "Como adiciono uma tab no device page?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 10`](PERGUNTA-RESPOSTA-NATIVA.md#10-frontend) + [`plugins/eventlog/02-eventlog-server.md`](plugins/eventlog/02-eventlog-server.md) |
| "Como intercepto agent connect?" | [`HOOKS-CATALOG.md § PluginHookScheduler`](HOOKS-CATALOG.md) + [`plugins/pluginhookscheduler/01-overview.md`](plugins/pluginhookscheduler/01-overview.md) |
| "Como faço broadcast pra todos os browsers?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 5`](PERGUNTA-RESPOSTA-NATIVA.md#5-comunicação) + [`core/09-meshcentral-event-dispatch.md`](core/09-meshcentral-event-dispatch.md) |
| "Como injeto código no MeshAgent?" | [`PERGUNTA-RESPOSTA-NATIVA.md § 11`](PERGUNTA-RESPOSTA-NATIVA.md#11-agent-side) + [`core/10-meshcentral-meshcore-agent.md`](core/10-meshcentral-meshcore-agent.md) |
| "Como fluxo de dados entre browser→server→agente?" | [`FLUXOS-E2E.md § 1-4`](FLUXOS-E2E.md) |
| "Como plugin é instalado e carregado?" | [`FLUXOS-E2E.md § 6`](FLUXOS-E2E.md) |