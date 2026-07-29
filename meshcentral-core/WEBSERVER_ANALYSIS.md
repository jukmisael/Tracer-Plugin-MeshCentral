# MeshCentral `webserver.js` — Comprehensive Structured Analysis

> **Source:** `https://raw.githubusercontent.com/Ylianst/MeshCentral/master/webserver.js`
> **Total lines:** 10,924
> **Module export:** `module.exports.CreateWebServer = function (parent, db, args, certificates, doneFunc) { ... }`
> **Companion note:** The raw file content is preserved in the agent's tool-output cache (`tool_fab662ffd001mjG6wwPZaMBD3z`, 10,924 lines). The `bash` tool was unavailable in this sandbox, so the file itself could not be copied to `/tmp/analysis/meshcentral-core/webserver.js` via `cp`/`curl`. This document is the comprehensive analysis that was requested.

---

## 0. Module Header & Module-level Setup

**Lines 1–14 — header & jshint config**
```js
/**
* @description MeshCentral web server
* @author Ylian Saint-Hilaire
* @copyright Intel Corporation 2018-2022
* @license Apache-2.0
* @version v0.0.1
*/
'use strict';
```

**Lines 17–24 — `SerialTunnel` (Duplex wrapper used by AMT/CIRA relay)**
```js
function SerialTunnel(options) {
    var obj = new require('stream').Duplex(options);
    obj.forwardwrite = null;
    obj.updateBuffer = function (chunk) { this.push(chunk); };
    obj._write = function (chunk, encoding, callback) { if (obj.forwardwrite != null) { obj.forwardwrite(chunk); } ... };
    obj._read = function (size) { };
    return obj;
}
```

**Lines 30–31 — `startsWith`/`endsWith` polyfills for old Node**

**Lines 34–35 — `module.exports.CreateWebServer = function (parent, db, args, certificates, doneFunc) { var obj = {}, i = 0;`**

**Lines 38–60 — `obj.*` Modules and shared services**
```js
obj.fs = require('fs');
obj.net = require('net');
obj.tls = require('tls');
obj.path = require('path');
obj.os = require('os');
obj.bodyParser = require('body-parser');
obj.exphbs = require('express-handlebars');
obj.crypto = require('crypto');
obj.common = require('./common.js');
obj.express = require('express');
obj.meshAgentHandler = require('./meshagent.js');
obj.meshRelayHandler = require('./meshrelay.js');
obj.meshDeviceFileHandler = require('./meshdevicefile.js');
obj.meshDesktopMultiplexHandler = require('./meshdesktopmultiplex.js');
obj.meshIderHandler = require('./amt/amt-ider.js');
obj.meshUserHandler = require('./meshuser.js');
obj.interceptor = require('./interceptor');
obj.uaparser = require('ua-parser-js');
obj.uaclienthints = require('ua-client-hints-js');
const constants = (obj.crypto.constants ? obj.crypto.constants : require('constants'));
obj.webauthn = require('./webauthn.js').CreateWebAuthnModule();
```

**Lines 62–64 — HTTPS proxy agent** (only created if `HTTP_PROXY`/`HTTPS_PROXY` env vars are set).

### In-memory state declared up-front (lines 66–100)
```js
obj.args = args;            obj.parent = parent;     obj.filespath = parent.filespath;
obj.db = db;                obj.app = obj.express();
if (obj.args.agentport) { obj.agentapp = obj.express(); }
if (args.compression === true) { obj.app.use(require('compression')({ filter: ... })); }
obj.app.disable('x-powered-by');
obj.tlsServer = null;                obj.tcpServer = null;
obj.certificates = certificates;
obj.users = {};                      // UserID --> User
obj.meshes = {};                     // MeshID --> Mesh (also called device group)
obj.userGroups = {};                 // UGrpID --> User Group
obj.useNodeDefaultTLSCiphers = args.usenodedefaulttlsciphers;
obj.tlsCiphers = args.tlsciphers;
obj.userAllowedIp = args.userallowedip;
obj.agentAllowedIp = args.agentallowedip;
obj.agentBlockedIp = args.agentblockedip;
obj.tlsSniCredentials = null;
obj.dnsDomains = {};
obj.relaySessionCount = 0;
obj.relaySessionErrorCount = 0;
obj.blockedUsers = 0;
obj.blockedAgents = 0;
obj.renderPages = null;
obj.renderLanguages = [];
obj.destroyedSessions = {};          // userid/req.session.x --> destroyed session time
```

### Upload-temp safety (lines 102–131)
`safeUploadTempRoots` is built once. Allowed roots: `os.tmpdir()` and `parent.filespath/tmp`. `resolveSafeUploadTempPath()` ensures any uploaded file landed under one of these roots.

### Web relay state (lines 134–147)
```js
var webRelayNextSessionId = 1;
var webRelaySessions = {}; // UserId/SessionId/Host --> Web Relay Session
var webRelayCleanupTimer = null;
parent.AddEventDispatch(['server-shareremove'], obj);   // <-- causes obj.HandleEvent below
obj.HandleEvent = function (source, event, ids, id) {
    if (event.action == 'removedDeviceShare') {
        for (var relaySessionId in webRelaySessions) {
            if (webRelaySessions[relaySessionId].xpublicid === event.publicid) { webRelaySessions[relaySessionId].close(); }
        }
    }
}
```

### Rights constants (lines 149–190)
Bit-flag constants:
- **Mesh rights** `MESHRIGHT_*` (lines 150–174): `EDITMESH`, `MANAGEUSERS`, `MANAGECOMPUTERS`, `REMOTECONTROL`, `AGENTCONSOLE`, `SERVERFILES`, `WAKEDEVICE`, `SETNOTES`, `REMOTEVIEWONLY`, `NOTERMINAL`, `NOFILES`, `NOAMT`, `DESKLIMITEDINPUT`, `LIMITEVENTS`, `CHATNOTIFY`, `UNINSTALL`, `NODESKTOP`, `REMOTECOMMAND`, `RESETOFF`, `GUESTSHARING`, `DEVICEDETAILS`, `RELAY`, `NOREGISTRY`, `NOSOFTWARE`, `ADMIN = 0xFFFFFFFF`.
- **Site rights** `SITERIGHT_*` (lines 177–190): `SERVERBACKUP`, `MANAGEUSERS`, `SERVERRESTORE`, `FILEACCESS`, `SERVERUPDATE`, `LOCKED`, `NONEWGROUPS`, `NOMESHCMD`, `USERGROUPS`, `RECORDINGS`, `LOCKSETTINGS`, `ALLEVENTS`, `NONEWDEVICES`, `ADMIN`.

### SSPI bootstrap (lines 192–195)
If `platform == 'win32'` and any domain has `auth == 'sspi'`, lazy-attach `node-sspi`.

### Certificate hashes per domain (lines 197–247)
Builds `obj.webCertificateHashs`, `obj.webCertificateFullHashs`, `obj.webCertificateExpire`, `obj.agentCertificateHashHex`, `obj.agentCertificateHashBase64`, `obj.agentCertificateAsn1`, `obj.defaultWebCertificateHash`, `obj.defaultWebCertificateFullHash`, `obj.swarmCertificateAsn1`, `obj.swarmCertificateHash{384,256}` from the certs bag.

### Live session dictionaries (lines 249–265)
```js
obj.wsagents = {};                // NodeId --> Agent
obj.wsagentsWithBadWebCerts = {}; // NodeId --> Agent
obj.wsagentsDisconnections = {};
obj.wsagentsDisconnectionsTimer = null;
obj.duplicateAgentsLog = {};
obj.wssessions = {};              // UserId --> Array Of Sessions
obj.wssessions2 = {};             // "UserId + SessionRnd" --> Session
obj.wsPeerSessions = {};          // ServerId --> Array Of "UserId + SessionRnd"
obj.wsPeerSessions2 = {};         // "UserId + SessionRnd" --> ServerId
obj.wsPeerSessions3 = {};         // ServerId --> UserId --> [ SessionId ]
obj.sessionsCount = {};           // Merged session counters (server peering)
obj.wsrelays = {};                // Id -> Relay
obj.desktoprelays = {};           // Id -> Desktop Multiplexer Relay
obj.wsPeerRelays = {};            // Id -> { ServerId, Time }
var tlsSessionStore = {};         // TLS session resume cache
var tlsSessionStoreCount = 0;
```

### Random pools (lines 267–270)
```js
obj.crypto.randomBytes(48, ... obj.httpAuthRandom);
obj.crypto.randomBytes(16, ... obj.httpAuthRealm);
obj.crypto.randomBytes(48, ... obj.relayRandom);
```

### DNS SNI credentials (lines 276–290)
Iterates `obj.certificates.dns`, builds `obj.tlsSniCredentials` map, defaulting back to web cert. `TlsSniCallback(name, cb)` selects the right context.

### Escape helpers (lines 292–293)
`EscapeHtml(x)` returns a 5-character escape-cooked string; `EscapeHtmlBreaks` is commented-out.

### Database pre-load (lines 295–376) — *the moment the in-memory tree exists*
```js
obj.db.GetAllType('user', function (err, docs) {
    obj.common.unEscapeAllLinksFieldName(docs);
    ...
    for (i in docs) { var u = obj.users[docs[i]._id] = docs[i]; domainUserCount[u.domain]++; }
    ...
    obj.db.GetAllType('mesh', function (err, docs) {       // line 311
        for (var i in docs) { obj.meshes[docs[i]._id] = docs[i]; } // line 313
        obj.db.GetAllType('ugrp', function (err, docs) {  // line 316
            ...
            obj.userGroups[docs[i]._id] = docs[i];        // line 328
            // Cross-link users<->ugroups, mesh cleanup, user cleanup
            serverStart();                                  // line 373
        });
    });
});
```
**Cleanup performed in this pre-load:**
- `ugrp.links` → removes unknown `user/` links and `mesh/` links whose mesh is deleted.
- Reverse-links back into `user.links[ugrpId] = { rights: 1 }`.
- `mesh.links` → removes unknown `ugrp/` and `user/` links.
- `user.links` → removes unknown `ugrp/` and `mesh/` links (deleted meshes).

### `obj.cleanDevice` (lines 378–390)
Removes dangling `device.links` whose `user`/`ugrp` no longer exists.
Coalesces empty `links` object back to absent.

### `obj.getStats()` (lines 392–415)
Returns object with counts of users, meshes, dnsDomains, wsagents, wssessions, wsPeer*, sessionsCount, wsrelays, wsPeerRelays, tlsSessionStore, blocked counters.

### `obj.agentStats` (lines 418–445) — 23 counters
`createMeshAgentCount`, `agentClose`, `agentBinaryUpdate`, `agentMeshCoreBinaryUpdate`, `coreIsStableCount`, `verifiedAgentConnectionCount`, `clearingCoreCount`, `updatingCoreCount`, `recoveryCoreIsStableCount`, `meshDoesNotExistCount`, `invalidPkcsSignatureCount`, `invalidRsaSignatureCount`, `invalidJsonCount`, `unknownAgentActionCount`, `agentBadWebCertHashCount`, `agentBadSignature{1,2}Count`, `agentMaxSessionHoldCount`, `invalidDomainMesh{1,2}Count`, `invalidMeshType{1,2}Count`, `duplicateAgentCount`, `maxDomainDevicesReached`, `agentInTrouble`, `agentInBigTrouble`.

### `obj.trafficStats` (lines 449–484) + `getTrafficStats`, `getTrafficDelta`, `calcDelta`
Counts: `httpRequestCount`, `httpWebSocketCount`, `httpIn/Out`, `relayCount/In/Out`, `localRelayCount/In/Out`, `AgentCtrlIn/Out`, `LMSIn/Out`, `CIRAIn/Out`.

### `obj.setAgentIssue` / `obj.agentIssues` (lines 486–506)
Hold last 50 issues `[date, addr:port, issue]`.

### `obj.authenticate(name, pass, domain, fn)` (lines 508–831) — **see §3**

---

## 1. Authentication Subsystem

### 1.1 `obj.authenticate(name, pass, domain, fn)` — line 509

```js
obj.authenticate = function (name, pass, domain, fn) {
    if ((typeof (name) != 'string') || (typeof (pass) != 'string') || (typeof (domain) != 'object')) { fn(new Error('invalid fields')); return; }
    if (name.startsWith('~t:')) { /* Login token branch */ }
    else if (domain.auth == 'ldap') { /* LDAP branch */ }
    else { /* Local password branch */ }
};
```

**Branch A — Login token (`name.startsWith('~t:')`)**, lines 511–535
- `obj.db.Get('logintoken-' + name, ...)` looks up `logintoken-<token>` doc.
- Validates `loginToken.expire != 0 && < Date.now()`.
- Calls `require('./pass').hash(pass, loginToken.salt, ...)` (pbkdf2 SHA384).
- If hash matches → looks up user via `obj.users[loginToken.userid]`, checks locked bit (`siteadmin & 32`), returns `fn(null, user._id, null, { tokenName, tokenUser, expire? })`.

**Branch B — LDAP (`domain.auth == 'ldap'`)**, lines 536–796
- Sub-cases:
  - `domain.ldapoptions.url == 'test'` → reads user from `domain.ldapoptions[name]` (either as JSON file path or literal object).
  - Otherwise → uses `ldapauth-fork`, `new LdapAuth(domain.ldapoptions)` with `includeRaw: true`.
- Computes `userid = 'user/' + domain.id + '/' + shortname` where `shortname` is derived from `domain.ldapuserbinarykey`, `domain.ldapuserkey`, or fallback (`objectSid`, `objectGUID`, `name`, `cn`).
- Helper `assembleStringFromObject(format, o)` (line 10817) — fills `{{{var}}}` placeholders.
- LDAP attributes decoupled: `domain.ldapusername`, `domain.ldapuseremail`, `domain.ldapuserrealname`, `domain.ldapuserphonenumber`, `domain.ldapuserimage` (jpeg/PNG converted to base64 data URLs).
- `domain.ldapusergroups` (default `memberOf`) → requires group membership check.
- `domain.ldapuserrequiredgroupmembership` → denies login if none match.
- `domain.ldapsiteadmingroups` → grants `siteadmin = 0xFFFFFFFF`.
- `domain.ldapsyncwithusergroups` (object/true/false) → optional sync filter list of LDAP DNs into local user-groups.
- `domain.newaccountsusergroups` (object) → auto-join new accounts to listed user groups (`ugrp/<domain>/<name>`).
- `syncExternalUserGroups(domain, user, userMemberships, 'ldap')` (line 10827) — creates/updates `ugrp/<domain>/<sha384-of-dn>` groups, dispatching `usergroupchange` events.
- If a new user is created and the domain has no users yet, the user becomes site admin (line 669) — `user.siteadmin = 4294967295`.
- New user saved via `obj.db.SetUser(user)` + `DispatchEvent('accountcreate')`.

**Branch C — Local user**, lines 797–830
```js
var user = obj.users['user/' + domain.id + '/' + name.toLowerCase()];
if (!user) { fn(new Error('cannot find user')); return; }
if (user.salt == null) { fn(new Error('invalid password')); }
else {
    if (user.passtype != null) {
        // IIS legacy SHA-1 weak hash, re-hash to pbkdf2 on success
        require('./pass').iishash(user.passtype, pass, user.salt, function (err, hash) { ... });
    } else {
        // Default strong password hashing (pbkdf2 SHA384)
        require('./pass').hash(pass, user.salt, function (err, hash, tag) { ... }, 0);
    }
}
```
Locked-out check at two points: `(user.siteadmin & 32) != 0` returns `fn('locked')`.

### 1.2 Express session integration (lines 7006–7070)

```js
obj.app.engine('handlebars', obj.exphbs.engine({ defaultLayout: false }));
obj.app.set('view engine', 'handlebars');
// trust proxy if configured
const keygrip = require('keygrip')((typeof obj.args.sessionkey == 'string') ? [obj.args.sessionkey] : obj.args.sessionkey, 'sha384', 'base64');
const sessionOptions = {
    name: 'xid',            // override default 'connect.sid'
    httpOnly: true,
    keys: keygrip,
    secure: (obj.args.tlsoffload == null),
    sameSite: (obj.args.sessionsamesite ? obj.args.sessionsamesite : 'lax')
};
if (obj.args.sessiontime != null) { sessionOptions.maxAge = (obj.args.sessiontime * 60000); }
obj.app.use(require('cookie-session')(sessionOptions));
// passport 0.6.0 patch (regenerate/save shims)
obj.app.use(function (request, response, next) { /* ... */ });
```

The session cookie name is **always `xid`**, signed via `keygrip(SHA384, base64)`. `args.sessiontime` (minutes) caps `maxAge`.

### 1.3 `PerformWSSessionAuth(ws, req, noAuthOk, func)` — line 8984

```js
function PerformWSSessionAuth(ws, req, noAuthOk, func) {
    // 1. Session expiry check
    if ((req.session != null) && (typeof req.session.expire == 'number') && (req.session.expire <= Date.now())) { ... ws.close(); }
    // 2. Banned-IP check (bad login throttling)
    if (obj.checkAllowLogin(req) == false) { ... }
    // 3. Pause socket
    ws._socket.pause();
    // 4. Domain resolution
    if (noAuthOk == true) { domain = getDomain(req); if (domain == null) { ... } }
    else { domain = checkUserIpAddress(ws, req); if (domain == null) { ... } }
    // 5. Trust inner auth: req.headers['x-meshauth'] === '*' → func(ws, req, domain, null)
    if (req.headers['x-meshauth'] === '*') { func(ws, req, domain, null); return; }
    // 6. Inline ?user=&pass= (EWS-login style)
    if ((req.query.user != null) && (req.query.pass != null)) { obj.authenticate(...) → 2FA → finish with func(ws, req, domain, user, null, authData) }
    // 7. Encrypted cookie auth ?auth=<encrypted>
    if ((req.query.auth != null) && (req.query.auth != '')) {
        var cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.loginCookieEncryptionKey, 60);
        if ((cookie == null) && (obj.parent.multiServer != null)) { cookie = obj.parent.decodeCookie(req.query.auth, obj.parent.serverKey, 60); }
        // ... cookie.ip ↔ req.clientIp check via checkCookieIp
        // Cookie shapes accepted:
        //   { userid, domainid }           → func(ws, req, domain, users[userid], cookie)
        //   { a: 3, u: 'user/...' }        → same
        //   { nouser: 1 }                  → func(ws, req, domain, null, cookie)  // agent self-sharing
    }
    // 8. Header auth (x-meshauth base64-decoded)
    if (req.headers['x-meshauth'] != null) { obj.authenticate(s[0], s[1], domain, ...) }
    // 9. Express session cookie (req.session.userid)
    if (req.session.userid != null) { var user = obj.users[req.session.userid]; if (user) func(ws, req, domain, user, null); }
    // 10. Default user fallback if args.user configured
    if (obj.args.user && obj.users['user/' + domain.id + '/' + obj.args.user.toLowerCase()]) { func(ws, req, domain, obj.users[ ... ]); }
    // 11. Else close with { action: 'close', cause: 'noauth', msg: 'noauth-...' }
}
```

Decoded cookie shapes consumed (key references):
- `userid`, `domainid`, `ip`, `x`
- `a: 3` + `u`
- `nouser: 1` (agent self-sharing)
- `r: 8` (peer-relay cookie), `guserid`, `pid`, `nid`, `addr`, `port`, `appid`, `expire` (used in `webRelayRouter` flow at line 7934).

### 1.4 Cookie handling

Cookies are encrypted via `parent.encodeCookie(obj, parent.loginCookieEncryptionKey)` and `parent.decodeCookie(string, key, timeoutMinutes)` (defined in `common.js` / mesh parent). The two key cookies are:

| Cookie | Purpose | Lifetime |
|---|---|---|
| `authCookie` (line 3234) | `{ userid, domainid, ip }` — used for one-shot HTTPS<->HTTP relay auth (e.g. `webrelay.ashx`) | 60 min |
| `authRelayCookie` (line 3235) | `{ ruserid, x }` — web relay session container (webSessionId = `userId + '/' + sessionRnd`) | 60 min |

Other cookie authorities:
- `parent.invitationLinkEncryptionKey` → device-share cookies (`a: 5` legacy, `a: 6` pointer-based via `deviceshare-<pid>`).
- `domain.mailserver.mailCookieEncryptionKey` → email verification (`a: 1`) and reset (`a: 2`).
- `obj.webauthn` (from `webauthn.js`) used for FIDO2/WebAuthn (`a: 'waitAuth'`, `a: 'checkAuth'`).

### 1.5 Two-factor helpers
- `checkUserOneTimePasswordSkip(domain, user, req, loginOptions)` (line 962) — skip if token/no-2FA/ipaddr cookie.
- `checkUserOneTimePasswordRequired(domain, user, req, loginOptions)` (called at line 9032) — decides if 2FA gate is needed.
- `checkUserOneTimePassword(req, domain, user, token, ...)` (line 9080) — validates the token.
- `setbadLogin`, `setbad2Fa`, `checkAllowLogin`, `checkAllow2Fa`, `cleanBadLoginTable`, `cleanBad2faTable` (lines 10613–10717) — throttle bad IPs.

When 2FA is required the WS auth flow sends a sentinel close reason:
```
{ action: 'close', cause: 'noauth', msg: 'tokenrequired', email2fa, sms2fa, msg2fa, twoFactorCookieDays }
```
…and the browser replays the `?token=...` query to satisfy it.

### 1.6 `setSessionRandom(req)` (line 10746)
```js
function setSessionRandom(req) {
    if (req.session.x == null) { req.session.x = Buffer.from(obj.crypto.randomBytes(6), 'binary').toString('base64'); }
    req.session.x = req.session.x.split('/')[0]; // Strip any stray /
}
```
The session-id (`x`) is what `wssessions2[userid + '/' + x]` keys into.

---

## 2. Express Setup

### 2.1 View engine (lines 7007–7008)
```js
obj.app.engine('handlebars', obj.exphbs.engine({ defaultLayout: false }));
obj.app.set('view engine', 'handlebars');
```
**No `defaultLayout`**, so each `.handlebars` file is a complete page. `express-handlebars` is the only engine.

### 2.2 Body parsing
Global `body-parser.urlencoded({ extended: false })` is **applied per-route**:
```js
obj.app.post(url + 'login', obj.bodyParser.urlencoded({ extended: false }), handleRootPostRequest);
...
obj.app.post(url + 'pluginadmin.ashx', obj.bodyParser.urlencoded({ extended: false }), obj.handlePluginAdminPostReq);
```
Multipart for file uploads uses `require('multiparty')` (no body-parser):
```js
const multiparty = require('multiparty');
const form = new multiparty.Form();
form.parse(req, function (err, fields, files) { ... });
```
Used in `handleUploadFile` (line 4979) and `handleUploadFileBatch` (line 5088).

### 2.3 ESLint / Compression
- `compression` middleware (lines 73–79) — skips `/devicefile.ashx` and `relaydns` hostnames.
- `obj.app.disable('x-powered-by')` (line 80).
- `app.set('trust proxy', ...)` from `obj.args.trustedproxy` or `obj.args.tlsoffload` (lines 7009–7030).

### 2.4 Static file serving (lines 8128–8129)
```js
obj.app.use(url, obj.express.static(obj.parent.webPublicPath));
```
Three layers are tried, in order:
1. `obj.app.use(url, ...)` **theme-pack override** (line 8099) — `datapath/theme-pack/<themepack>/public/<req.path>`.
2. `obj.app.use(url, ...)` **domain override** (line 8118) — `domain.webpublicpath` or `obj.parent.webPublicOverridePath`.
3. `obj.app.use(url, obj.express.static(obj.parent.webPublicPath))` — `default public path` (line 8129).

Additional mounts:
- Sharing/public domain static root: `obj.app.use(parent.config.domains[i].url, obj.express.static(parent.config.domains[i].share))` (line 7315).
- `.well-known` per domain: `obj.app.use(url + '.well-known', obj.express.static(p))` (line 7887).

**`/scripts/`, `/images/`, `/stylesheets/`** are *not* explicitly mounted — they live under `obj.parent.webPublicPath` (typically `public/`), and the static middleware above serves them. Custom-domain themes can override them via `domain.webpublicpath`.

### 2.5 404 handler (lines 8139–8150)
```js
obj.app.use(function (req, res, next) {
    var domain = getDomain(req);
    if ((domain == null) || (domain.auth == 'sspi')) { res.sendStatus(404); return; }
    if ((domain.loginkey != null) && (domain.loginkey.indexOf(req.query.key) == -1)) { res.sendStatus(404); return; }
    const cspNonce = obj.crypto.randomBytes(15).toString('base64');
    res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'nonce-" + cspNonce + "'; ..." });
    res.status(404).render(getRenderPage((domain.sitestyle >= 2) ? 'error4042' : 'error404', req, domain), getRenderArgs({ cspNonce }, req, domain));
});
```

### 2.6 Security headers (added globally, lines 7226–7244)
```js
const headers = {
    'Referrer-Policy': 'no-referrer',
    'X-XSS-Protection': '1; mode=block',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': cspBase
};
if (req.headers['user-agent'] && (req.headers['user-agent'].indexOf('Chrome') >= 0)) { headers['Permissions-Policy'] = 'interest-cohort=()'; }
if (hasAllowedFramingOrigins) { /* X-Frame-Options or CSP frame-ancestors */ }
else if ((parent.config.settings.allowframing !== true) && (typeof parent.config.settings.allowframing !== 'string')) { headers['X-Frame-Options'] = 'sameorigin'; }
if ((parent.config.settings.stricttransportsecurity === true) || ((parent.config.settings.stricttransportsecurity !== false) && (obj.isTrustedCert(domain)))) { headers['Strict-Transport-Security'] = 'max-age=63072000'; }
if (domain.httpheaders) { for (var i in domain.httpheaders) headers[i] = domain.httpheaders[i]; }
res.set(headers);
```
`cspBase` is built at lines 7192–7225 — includes `connect-src 'self' wss://<host>`, `frame-src 'self' blob: mcrouter:`, `form-action 'self' <duoSrc>`, `img-src 'self' blob: data:`, etc.

### 2.7 IP-binding session check (lines 7247–7250)
```js
if ((req.session.ip != null) && (req.clientIp != null) && !checkCookieIp(req.session.ip, req.clientIp)) { req.session = {}; }
if (req.session.userid != null) { req.session.t = Math.floor(Date.now() / 60e3); } else { delete req.session.t; }
```

`checkCookieIp(cookieip, ip)` (line 10809) — respects `obj.args.cookieipcheck` (`'none'`, `'strict'`, `'lax'`, IP/24 subnet, or private+private).

### 2.8 `obj.cleanupBadLogin` and `obj.cleanupBad2fa` are only triggered manually; the conn-track timer is `obj.wsagentsDisconnectionsTimer` (line 8132).

---

## 3. Express Routes (`app.get`, `app.post`, `app.ws`)

All routes are registered inside `setupHTTPHandlers()` (line 7337) which runs after Express/Express-ws is initialized and Session middleware is mounted. Routes are typically namespaced with `domain.url` (default `''`, otherwise `'subdomain/'`).

### 3.1 Global / cross-domain middleware (lines 7046–7078)
| Method | Pattern | Handler | Notes |
|---|---|---|---|
| `app.use` | – | `require('cookie-session')(sessionOptions)` | line 7046 |
| `app.use` | – | `function(request, response, next)` | passport 0.6.0 patch + sec-CH headers (line 7047) |
| `app.ws` | `/*` | `function(ws, req, next)` | Web-relay routing decision (line 7073) |
| `app.use` | – | `async function (req, res, next)` | big security-headers middleware (line 7081) |
| `app.use` | – | `function (req, res, next)` (agentapp) | agent-port IP + domain attach (line 7281) |
| `app.use` | `<domain.url>` | `obj.express.static(parent.config.domains[i].share)` | sharing-domain static (line 7315) |

### 3.2 Server-level WebSocket (mesh peering) — line 7342
```js
if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', function (ws, req) { parent.multiServer.CreatePeerInServer(parent.multiServer, ws, req, obj.args.tlsoffload == null); }); }
```

### 3.3 Public / domain root
| Line | Method | URL | Handler | Description |
|---|---|---|---|---|
| 7349 | GET | `url` | `handleRootRedirect` | static domain redirect |
| 7352 | GET | `url` | `handleRootRequest` | render login or user page |
| 7353 | POST | `url` | `handleRootPostRequest` | alias of login POST |
| 7355 | GET | `refresh.ashx` | inline `res.sendStatus(200)` | load-balancer liveness |
| 7356 | GET | `backup.zip` | `handleBackupRequest` | server backup download |
| 7357 | POST | `restoreserver.ashx` | `handleRestoreRequest` | server restore |
| 7358 | GET | `terms` | `handleTermsRequest` | Terms of Service |
| 7359 | GET | `xterm` | `handleXTermRequest` | XTerm helper page |
| 7360 | GET | `login` | `handleRootRequest` | login page |
| 7361 | POST | `login` | `handleRootPostRequest` | login submit |
| 7362 | POST | `tokenlogin` | `handleLoginRequest` | login-token auth |
| 7363 | GET | `logout` | `handleLogoutRequest` | logout (line 911) |
| 7364 | GET | `MeshServerRootCert.cer` | `handleRootCertRequest` | agent cert download |
| 7365 | GET | `manifest.json` | `handleManifestRequest` | PWA manifest |
| 7366 | POST | `changepassword` | `handlePasswordChangeRequest` | password change |
| 7367 | POST | `deleteaccount` | `handleDeleteAccountRequest` | account deletion |
| 7368 | POST | `createaccount` | `handleCreateAccountRequest` | self-service account |
| 7369 | POST | `resetpassword` | `handleResetPasswordRequest` | email reset |
| 7370 | POST | `resetaccount` | `handleResetAccountRequest` | account reset |
| 7371 | GET | `checkmail` | `handleCheckMailRequest` | email verification |
| 7372 | GET | `agentinvite` | `handleAgentInviteRequest` | agent invite page |
| 7373 | GET | `userimage.ashx` | `handleUserImageRequest` | user avatar |
| 7374 | POST | `amtevents.ashx` | `obj.handleAmtEventRequest` | AMT CIRA events |
| 7375 | GET | `meshagents` | `obj.handleMeshAgentRequest` | agent binaries manifest |
| 7376 | GET | `messenger` | `handleMessengerRequest` | messenger install |
| 7377 | GET | `messenger.png` | `handleMessengerImageRequest` | messenger icon |
| 7378 | GET | `meshosxagent` | `obj.handleMeshOsxAgentRequest` | macOS agent manifest |
| 7379 | GET | `meshsettings` | `obj.handleMeshSettingsRequest` | agent install settings |
| 7380 | GET | `devicepowerevents.ashx` | `obj.handleDevicePowerEvents` | power events |
| 7381 | GET | `downloadfile.ashx` | `handleDownloadFile` | user file download |
| 7382 | GET | `commander.ashx` | `handleMeshCommander` | MeshCommander helper |
| 7383 | POST | `uploadfile.ashx` | `handleUploadFile` | file upload to agent |
| 7384 | POST | `uploadfilebatch.ashx` | `handleUploadFileBatch` | batch upload |
| 7385 | POST | `customiconupload.ashx` | `handleCustomIconUpload` | upload custom icon |
| 7386 | POST | `customicondelete.ashx` | `handleCustomIconDelete` | delete custom icon |
| 7387 | GET | `icons/custom/*` | `handleCustomIconDownload` | custom icons |
| 7388 | POST | `uploadmeshcorefile.ashx` | `handleUploadMeshCoreFile` | upload mesh agent core |
| 7389 | POST | `oneclickrecovery.ashx` | `handleOneClickRecoveryFile` | one-click recovery |
| 7390 | GET | `userfiles/*` | `handleDownloadUserFiles` | user/mesh files |
| 7391 | WS | `echo.ashx` | `handleEchoWebSocket` | debug echo |
| 7392 | WS | `2fahold.ashx` | `handle2faHoldWebSocket` | 2FA pending push |
| 7393 | WS | `apf.ashx` | `parent.mpsserver.onWebSocketConnection` | AMT/PortForward |
| 7394 | GET | `webrelay.ashx` | inline `res.send('Websocket connection expected')` | warn GET on ws route |
| 7395 | GET | `health.ashx` | inline `res.send('ok')` | health check |
| 7396 | WS | `webrelay.ashx` | `PerformWSSessionAuth(..., false, handleRelayWebSocket)` | web relay |
| 7397 | WS | `webider.ashx` | `PerformWSSessionAuth(..., false, meshIderHandler.CreateAmtIderSession)` | IDER |
| 7398 | WS | `control.ashx` | inline `PerformWSSessionAuth(..., true, meshUserHandler.CreateMeshUser)` | user browser |
| 7425 | WS | `devicefile.ashx` | `CreateMeshDeviceFile` | device file transfer |
| 7426 | GET | `devicefile.ashx` | `handleDeviceFile` | streamed device file download |
| 7427 | GET | `agentdownload.ashx` | `handleAgentDownloadFile` | agent tmp file |
| 7428 | GET | `logo.png` | `handleLogoRequest` | title logo |
| 7429 | GET | `loginlogo.png` | `handleLoginLogoRequest` | login logo |
| 7430 | GET | `pwalogo.png` | `handlePWALogoRequest` | PWA icon |
| 7431 | POST | `translations` | `handleTranslationsRequest` | translate |
| 7432 | GET | `welcome.jpg`/`welcome.png` | `handleWelcomeImageRequest` | welcome image |
| 7434 | GET | `recordings.ashx` | `handleGetRecordings` | recording download |
| 7435 | WS | `recordings.ashx` | `handleGetRecordingsWebSocket` | recording stream |
| 7436 | GET | `player.htm`/`player` | `handlePlayerRequest` | player shell |
| 7438 | GET | `sharing` | `handleSharingRequest` | guest sharing |
| 7439 | WS | `agenttransfer.ashx` | `handleAgentFileTransfer` | agent<->server file tunnel |
| 7440 | WS | `meshrelay.ashx` | inline `PerformWSSessionAuth(..., true, (ws,req,domain,user,cookie,authData) => meshRelayHandler.CreateMeshRelay OR meshDesktopMultiplexHandler.CreateMeshRelay)` | mesh relay |
| 7450 | WS | `localrelay.ashx` | inline `PerformWSSessionAuth(..., true, meshRelayHandler.CreateLocalRelay)` | LAN-only local relay |
| 7460 | GET | `invite` | `handleInviteRequest` | invite validation |
| 7461 | POST | `invite` | `handleInviteRequest` | invite submit |

### 3.4 Plugin subsystem (lines 7463–7467) — only if `parent.pluginHandler != null`
```js
if (parent.pluginHandler != null) {
    obj.app.get(url + 'pluginadmin.ashx', obj.handlePluginAdminReq);                  // line 7464
    obj.app.post(url + 'pluginadmin.ashx', obj.bodyParser.urlencoded({ extended: false }), obj.handlePluginAdminPostReq); // line 7465
    obj.app.get(url + 'pluginHandler.js', obj.handlePluginJS);                         // line 7466
}
```
**Handler bodies**, lines 6893–6921:
```js
obj.handlePluginAdminReq = function (req, res) {
    const domain = checkUserIpAddress(req, res);
    if (domain == null) { return; }
    if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
    var user = obj.users[req.session.userid];
    if (user == null) { res.sendStatus(401); return; }
    parent.pluginHandler.handleAdminReq(req, res, user, obj);
}
obj.handlePluginAdminPostReq = function (req, res) {
    const domain = checkUserIpAddress(req, res);
    if (domain == null) { return; }
    if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
    var user = obj.users[req.session.userid];
    if (user == null) { res.sendStatus(401); return; }
    parent.pluginHandler.handleAdminPostReq(req, res, user, obj);
}
obj.handlePluginJS = function (req, res) {
    const domain = checkUserIpAddress(req, res);
    if (domain == null) { return; }
    if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
    var user = obj.users[req.session.userid];
    if (user == null) { res.sendStatus(401); return; }
    parent.pluginHandler.refreshJS(req, res);
}
```
All three gate on `req.session.userid` and forward to `parent.pluginHandler`. The actual admin UI is served as `pluginadmin.ashx` (GET), the POST endpoint ingests form submissions, and `pluginHandler.js` is a concatenated JS bundle.

### 3.5 CAPTCHA (lines 7469–7478)
```js
if ((domain.newaccountscaptcha != null) && (domain.newaccountscaptcha !== false)) {
    obj.app.get(url + 'newAccountCaptcha.ashx', handleNewAccountCaptchaRequest);
}
if (parent.crowdSecBounser != null) {
    obj.app.get(url + 'captcha.ashx', handleCaptchaGetRequest);
    obj.app.post(url + 'captcha.ashx', obj.bodyParser.urlencoded({ extended: false }), handleCaptchaPostRequest);
}
```

### 3.6 IP-KVM (lines 7480–7492)
```js
if (domain.ipkvm) {
    obj.app.ws(url + 'ipkvm.ashx/*', function (ws, req) {
        const domain = getDomain(req);
        if (domain == null) { ... try { ws.close(); } catch (ex) { } return; }
        parent.ipKvmManager.handleIpKvmWebSocket(domain, ws, req);
    });
    obj.app.get(url + 'ipkvm.ashx/*', function (req, res, next) {
        const domain = getDomain(req);
        if (domain == null) return;
        parent.ipKvmManager.handleIpKvmGet(domain, req, res, next);
    });
}
```

### 3.7 MSTSC / SSH (lines 7494–7526)
```js
if (domain.mstsc !== false) {
    obj.app.get(url + 'mstsc.html', function (req, res) { handleMSTSCRequest(req, res, 'mstsc'); });
    obj.app.ws(url + 'mstscrelay.ashx', function (ws, req) {
        const domain = getDomain(req);
        if (domain == null) { ... }
        if ((req.session.userid == null) && (typeof obj.args.user == 'string') && ...)) { req.session.userid = '...'; }
        try { require('./apprelays.js').CreateMstscRelay(obj, obj.db, ws, req, obj.args, domain); } catch (ex) { console.log(ex); }
    });
}
if (domain.ssh === true) {
    obj.app.get(url + 'ssh.html', function (req, res) { handleMSTSCRequest(req, res, 'ssh'); });
    obj.app.ws(url + 'sshrelay.ashx', function (ws, req) { ... CreateSshRelay(obj, obj.db, ws, req, obj.args, domain); });
    obj.app.ws(url + 'sshterminalrelay.ashx', function (ws, req) {
        PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
            require('./apprelays.js').CreateSshTerminalRelay(obj, obj.db, ws1, req1, domain, user, cookie, obj.args);
        });
    });
    obj.app.ws(url + 'sshfilesrelay.ashx', function (ws, req) {
        PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
            require('./apprelays.js').CreateSshFilesRelay(obj, obj.db, ws1, req1, domain, user, cookie, obj.args);
        });
    });
}
```

### 3.8 Firebase push (lines 7528–7532)
```js
if ((obj.parent.firebase != null) && (obj.parent.config.firebase)) {
    if (obj.parent.config.firebase.pushrelayserver) { obj.app.post(url + 'firebaserelay.aspx', obj.bodyParser.urlencoded({ extended: false }), handleFirebasePushOnlyRelayRequest); }
    if (obj.parent.config.firebase.relayserver) { obj.app.ws(url + 'firebaserelay.aspx', handleFirebaseRelayRequest); }
}
```

### 3.9 SSO auth strategies (lines 7536–7687, gated by `domain.authstrategies.authStrategyFlags`)
| Provider | URL | Method | Line |
|---|---|---|---|
| Twitter | `auth-twitter` | GET | 7539 |
| Twitter callback | `auth-twitter-callback` | GET | 7544 |
| Google | `auth-google` | GET | 7561 |
| Google callback | `auth-google-callback` | GET | 7566 |
| GitHub | `auth-github` | GET | 7575 |
| GitHub callback | `auth-github-callback` | GET | 7580 |
| Azure | `auth-azure` | GET | 7589 |
| Azure callback | `auth-azure-callback` | GET | 7594 |
| OIDC | `auth-oidc` (configurable) | GET | 7617 |
| OIDC callback | `auth-oidc-callback` (configurable) | GET | 7631 |
| SAML | `auth-saml` | GET | 7645 |
| SAML callback | `auth-saml-callback` | POST | 7654 |
| Intel SAML | `auth-intel` | GET | 7663 |
| Intel SAML callback | `auth-intel-callback` | POST | 7668 |
| JumpCloud SAML | `auth-jumpcloud` | GET | 7677 |
| JumpCloud SAML callback | `auth-jumpcloud-callback` | POST | 7682 |

### 3.10 Duo 2FA (lines 7690–7827)
```js
if ((typeof domain.duo2factor == 'object') && (typeof domain.duo2factor.integrationkey == 'string') /* +secretkey+apihostname*/) {
    obj.app.get(url + 'auth-duo', function (req, res) { /* Duo callback */ });
    obj.app.get(url + 'add-duo', function (req, res) { /* enroll Duo */ });
}
```

### 3.11 Domain redirects (line 7830)
```js
if (parent.config.domains[i].redirects) { for (var j in parent.config.domains[i].redirects) { if (j[0] != '_') { obj.app.get(url + j, obj.handleDomainRedirect); } } }
```

### 3.12 Server picture (line 7833)
`obj.app.get(url + 'serverpic.ashx', function (req, res) { ... })`

### 3.13 Agent connect (line 7861)
```js
obj.app.ws(url + 'agent.ashx', function (ws, req) {
    var domain = checkAgentIpAddress(ws, req);
    if (domain == null) { parent.debug('web', 'Got agent connection with bad domain or blocked IP address ' + req.clientIp + ', holding.'); return; }
    if (domain.agentkey && ((req.query.key == null) || (domain.agentkey.indexOf(req.query.key) == -1))) { return; }
    try { obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain); } catch (ex) { console.log(ex); }
});
```
**Line 7866 is the single `CreateMeshAgent` call that populates `obj.wsagents[node._id]`** (the mesh agent module then writes to `obj.wsagents` via its `obj` reference).

### 3.14 MQTT broker (line 7870)
```js
if (obj.parent.mqttbroker != null) {
    obj.app.ws(url + 'mqtt.ashx', function (ws, req) { /* SerialTunnel wrapper */ });
}
```

### 3.15 `.well-known` (line 7887)
```js
if (obj.parent.fs.existsSync(p)) { obj.app.use(url + '.well-known', obj.express.static(p)); }
```

### 3.16 Agent-only port (`obj.agentapp`) — lines 7890–7926
```js
if (obj.agentapp) {
    obj.agentapp.ws(url + 'agent.ashx', ...);                  // line 7892
    obj.agentapp.ws(url + 'meshrelay.ashx', ...);              // line 7900
    obj.agentapp.ws(url + 'devicefile.ashx', ...);              // line 7911
    obj.agentapp.ws(url + 'agenttransfer.ashx', ...);          // line 7914
    obj.agentapp.get(url + 'meshagents', obj.handleMeshAgentRequest);     // line 7917
    obj.agentapp.get(url + 'agentdownload.ashx', handleAgentDownloadFile); // line 7920
    if (obj.parent.mpsserver != null) { obj.agentapp.ws(url + 'apf.ashx', ...); } // line 7924
}
```

### 3.17 Web relay router (lines 7930–8096) — only when `obj.args.relaydns != null`
```js
obj.webRelayRouter = require('express').Router();
obj.webRelayRouter.get('/control-redirect.ashx', function (req, res, next) { /* complex URL → authCookie → redirect to DN */ });
obj.webRelayRouter.get('/*',    function (req, res) { try { handleWebRelayRequest(req, res); } catch (ex) { console.log(ex); } });
obj.webRelayRouter.post('/*',   function (req, res) { try { handleWebRelayRequest(req, res); } catch (ex) { console.log(ex); } });
obj.webRelayRouter.put('/*',    function (req, res) { try { handleWebRelayRequest(req, res); } catch (ex) { console.log(ex); } });
obj.webRelayRouter.delete('/*', function (req, res) { try { handleWebRelayRequest(req, res); } catch (ex) { console.log(ex); } });
obj.webRelayRouter.options('/*',function (req, res) { try { handleWebRelayRequest(req, res); } catch (ex) { console.log(ex); } });
obj.webRelayRouter.head('/*',   function (req, res) { try { handleWebRelayRequest(req, res); } catch (ex) { console.log(ex); } });
```
The router is hooked at line 7181: when the request hostname matches `args.relaydns`, it's passed through `obj.webRelayRouter(req, res)`.

### 3.18 Theme pack + static mount (lines 8099–8129)
```js
obj.app.use(url, function (req, res, next) { /* theme pack */ });
obj.app.use(url, function(req, res, next){ /* override path */ });
obj.app.use(url, obj.express.static(obj.parent.webPublicPath));
```

### 3.19 Disconnection flush timer (line 8132)
```js
obj.wsagentsDisconnectionsTimer = setInterval(function () { obj.wsagentsDisconnections = {}; }, 120000);
```

### 3.20 Sub-routes not on `app` but on `webRelayRouter`
- `GET /control-redirect.ashx` (line 7934) — entry point for guest sharing. Resolves `authCookieData` (re-auth), looks for free/exact relay host, calls `parent.webserver.GetNodeWithRights(domain, userid, nodeid, ...)` to verify `MESHRIGHT_REMOTECONTROL | MESHRIGHT_RELAY`, then `require('./apprelays.js').CreateWebRelaySession(...)`.

---

## 4. Agent / User Session Lifecycle

### 4.1 `obj.wsagents` (NodeId → Agent) — populated via `meshagent.js`
**Single create call at line 7866** (and symmetrically at 7896 for `agentapp`):
```js
// Line 7861-7867
obj.app.ws(url + 'agent.ashx', function (ws, req) {
    var domain = checkAgentIpAddress(ws, req);
    if (domain == null) { ...; return; }
    if (domain.agentkey && ((req.query.key == null) || (domain.agentkey.indexOf(req.query.key) == -1))) { return; }
    try { obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain); } catch (ex) { console.log(ex); }
});
```
The `meshAgentHandler.CreateMeshAgent(...)` (in `meshagent.js`) — invoked with `obj` as the first arg — stores the resulting agent object as `obj.wsagents[node._id]`. From then on `obj.wsagents[nodeid]` is the live agent reference. (Handlers downstream use e.g. `obj.wsagents[node._id]` directly at line 9362, 9376, 5186.)

### 4.2 `obj.wssessions` (UserId → [Session]) & `obj.wssessions2` (UserId + SessionRnd → Session)
These are populated by the user-side `meshuser.js` module (`obj.meshUserHandler.CreateMeshUser(...)`) which is invoked from the `control.ashx` WebSocket route (line 7420). The MeshCentral user WS handler writes into `obj.wssessions[userid]` and `obj.wssessions2[userid + '/' + x]` using `obj` as the coordinating object.

Reading patterns (from this file):
- `obj.wssessions2[command.sessionid]` (line 10207) — used by `obj.routeAgentCommand` to deliver agent messages back to a specific browser tab.
- `obj.wssessions[command.userid]` (line 10230) — for fan-out to all of a user's sessions.
- `obj.wssessions[userid]` (line 10248) — iterate every connected user.
- `obj.wssessions[userid].length` (line 9485) — for the `wssessioncount` event.

### 4.3 `obj.sessionsCount` updates (lines 9439–9502)
When `wssessions` changes, `obj.UpdateSessionCount(...)` is invoked (line 9439) to recompute per-user counts and emit `wssessioncount` events with `setInterval` flushed via `setInterval(function () { obj.wsagentsDisconnections = {}; }, 120000)` (line 8132).

### 4.4 `obj.users`, `obj.meshes`, `obj.userGroups` in-memory caches
Loaded from DB at startup (lines 295–376, see §0):
```js
obj.db.GetAllType('user', function (err, docs) { ... obj.users[_id] = doc; ... })   // line 295
obj.db.GetAllType('mesh', function (err, docs) { ... obj.meshes[_id] = doc; ... }) // line 311
obj.db.GetAllType('ugrp', function (err, docs) { ... obj.userGroups[_id] = doc; ... }) // line 316
```
After load, `serverStart()` is called (line 373).

### 4.5 Session cleanup
- `obj.destroyedSessions` (line 100) — `userid + '/' + x → Date.now()`, populated on logout (line 929) and validated on every request (line 7085).
- `obj.wsagentsDisconnections = {}` is flushed every 120s (line 8132).
- Web-relay sessions cleanup: `webRelayCleanupTimer = setInterval(checkWebRelaySessionsTimeout, 10000)` (line 8062) — created when `webRelaySessions` becomes non-empty, cleared when empty.
- `clearDestroyedSessions()` (line 10754) — purges `obj.destroyedSessions` entries older than 1 hour.

### 4.6 Logout (line 911)
```js
function handleLogoutRequest(req, res) {
    ...
    if (req.session.userid) {
        var user = obj.users[req.session.userid];
        if (user != null) { obj.parent.authLog('https', 'User ' + user.name + ' logout from ' + req.clientIp + ' port ' + req.connection.remotePort, ...); }
        if (req.session.x) { clearDestroyedSessions(); obj.destroyedSessions[req.session.userid + '/' + req.session.x] = Date.now(); }
    }
    req.session = null;
    ...
}
```
Also handles SSO logout URLs (OIDC, Twitter, etc.) — `req.session.userid` is parsed for `~strategy:...` to find the matching logout URL.

---

## 5. ACL Helpers Exposed on `webserver`

> `obj.GetMesh`, `obj.GetUser`, `obj.GetNode` are **not** exposed as `obj.*` methods. The code accesses in-memory caches via `obj.users[userid]`, `obj.meshes[meshid]`, `obj.db.Get(nodeid, ...)` directly.

### 5.1 `obj.GetNodeWithRights(domain, user, nodeid, func)` — line 9548
```js
obj.GetNodeWithRights = function (domain, user, nodeid, func) {
    // User pre-validation
    if ((user == null) || (nodeid == null)) { func(null, 0, false); return; }
    if (typeof user == 'string') { user = obj.users[user]; }
    if (user == null) { func(null, 0, false); return; }
    // Nodeid shape
    if (obj.common.validateString(nodeid, 0, 128) == false) { func(null, 0, false); return; }
    const snode = nodeid.split('/');
    if ((snode.length != 3) || (snode[0] != 'node')) { func(null, 0, false); return; }
    if ((domain != null) && (snode[1] != domain.id)) { func(null, 0, false); return; }
    db.Get(nodeid, function (err, nodes) {
        if ((nodes == null) || (nodes.length != 1)) { func(null, 0, false); return; }
        // Super user branch
        if ((user.siteadmin == 0xFFFFFFFF) && ((parent.config.settings.managealldevicegroups.indexOf(user._id) >= 0) || (user.links && Object.keys(user.links).some(key => parent.config.settings.managealldevicegroups.indexOf(key) >= 0))) && (nodes[0].domain == user.domain)) {
            func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return;
        }
        if (user.links == null) { func(null, 0, false); return; }
        // 1. Direct device link
        var rights = 0, visible = false, r = user.links[nodeid];
        if (r != null) { if (r.rights == 0xFFFFFFFF) { func(nodes[0], removeUserRights(0xFFFFFFFF, user), true); return; } rights |= r.rights; visible = true; }
        // 2. Direct mesh link
        r = user.links[nodes[0].meshid];
        if (r != null) { ... rights |= r.rights; visible = true; }
        // 3. User-group links
        for (var i in user.links) {
            if (i.startsWith('ugrp/')) {
                const g = obj.userGroups[i];
                if (g && (g.links != null)) {
                    r = g.links[nodes[0].meshid]; if (r != null) { ... rights |= r.rights; visible = true; }
                    r = g.links[nodeid];      if (r != null) { ... rights |= r.rights; visible = true; }
                }
            }
        }
        rights = removeUserRights(rights, user);
        func(nodes[0], rights, visible);
    });
}
```
**Rights computation**: union of direct `node/id` link rights + `mesh/id` link rights + every user-group link that references either node or mesh. `removeUserRights` (line 9507) strips user-level prohibitions (`removeRights`) and applies default admin permission set when rights is `0xFFFFFFFF`.

### 5.2 `obj.GetNodesWithRights(domain, user, nodeids, func)` — line 9537
Parallel variant that aggregates `r[node._id] = { node, rights }` for visible nodes.

### 5.3 `obj.GetMeshRights(user, mesh)` — line 9687
Returns rights on a mesh (string id or object). Handles user-group inheritance. Returns `removeUserRights(...)`.

### 5.4 `obj.GetAllMeshWithRights(user, rights)` — line 9618
Returns meshes (objects) the user has any rights to. `rights` parameter optionally filters links requiring a specific bit.

### 5.5 `obj.GetAllMeshIdWithRights(user, rights)` — line 9650
Same as above but returns an array of mesh IDs.

### 5.6 `obj.IsMeshViewable(user, mesh)` — line 9732
Boolean check (no rights integer).

### 5.7 `obj.GetNodeRights(user, mesh, nodeid)` — line 9765
Synchronous, cached. Cache is `GetNodeRightsCache[userId][meshId][nodeid] = { t: Date.now() + 10000, o: rights }`. TTL 10 s. Auto-flush when `GetNodeRightsCacheCount > 2000`.

### 5.8 `obj.InvalidateNodeCache(user, mesh, nodeid)` — line 9815
Pointer-based cache invalidation at user/mesh/node granularity.

### 5.9 `obj.FlushGetNodeRightsCache()` — line 9842
Reset.

### 5.10 `obj.CreateMeshDispatchTargets(mesh, addedTargets)` — line 9849
```js
obj.CreateMeshDispatchTargets = function (mesh, addedTargets) {
    var targets = (addedTargets != null) ? addedTargets : [];
    if (targets.indexOf('*') == -1) { targets.push('*'); }
    if (typeof mesh == 'string') { mesh = obj.meshes[mesh]; }
    if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
    return targets;
}
```
Returns `['*', meshId, meshUgrp1, meshUgrp2, ...]` plus any extra.

### 5.11 `obj.CreateNodeDispatchTargets(mesh, nodeid, addedTargets)` — line 9859
Adds node id and every user-group that links to this node:
```js
var targets = (addedTargets != null) ? addedTargets : [];
targets.push(nodeid);
if (targets.indexOf('*') == -1) { targets.push('*'); }
if (typeof mesh == 'string') { mesh = obj.meshes[mesh]; }
if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
for (var i in obj.userGroups) { const g = obj.userGroups[i]; if ((g != null) && (g.links != null) && (g.links[nodeid] != null)) { targets.push(i); } }
return targets;
```

### 5.12 `obj.CloneSafeUser(user)` — line 9870
```js
obj.CloneSafeUser = function (user) {
    if (typeof user != 'object') { return user; }
    var user2 = Object.assign({}, user); // shallow
    delete user2.hash; delete user2.passhint; delete user2.salt; delete user2.type;
    delete user2.domain; delete user2.subscriptions; delete user2.passtype;
    delete user2.otpsms; delete user2.otpmsg;
    // Reduce 2FA state to booleans / counts
    if ((typeof user2.otpekey == 'object') && (user2.otpekey != null)) { user2.otpekey = 1; }
    if ((typeof user2.otpduo == 'object') && (user2.otpduo != null)) { user2.otpduo = 1; }
    if ((typeof user2.otpsecret == 'string') && (user2.otpsecret != null)) { user2.otpsecret = 1; }
    if ((typeof user2.otpkeys == 'object') && (user2.otpkeys != null)) { user2.otpkeys = 0; if (user.otpkeys != null) { for (var i = 0; i < user.otpkeys.keys.length; i++) { if (user.otpkeys.keys[i].u == true) { user2.otpkeys = 1; } } } }
    if ((typeof user2.otphkeys == 'object') && (user2.otphkeys != null)) { user2.otphkeys = user2.otphkeys.length; }
    if ((typeof user2.otpdev == 'string') && (user2.otpdev != null)) { user2.otpdev = 1; }
    if ((typeof user2.webpush == 'object') && (user2.webpush != null)) { user2.webpush = user2.webpush.length; }
    return user2;
}
```
Used everywhere user objects are sent to the browser (`DispatchEvent('accountcreate', ...)` etc.).

### 5.13 `obj.CloneSafeNode(node)` — line 9893
Same idea for nodes: replaces `pmt`, `ssh`, `rdp`, `intelamt.pass`, `intelamt.mpspass` with `1`.

### 5.14 `obj.CloneSafeMesh(mesh)` — line 9921
Replaces `mesh.amt.password` and `mesh.kvm.pass` with `1`.

### 5.15 `obj.cleanDevice(device)` — line 379
Removes dangling `user/`/`ugrp/` links before `db.Set`.

### 5.16 `obj.subscribe(userid, target)` — line 5199
Removes previous subscriptions and re-subscribes:
```js
const subscriptions = [userid, 'server-allusers'];
if (user.siteadmin != null) {
    if ((user.siteadmin == 0xFFFFFFFF) || ((user.siteadmin & 2048) != 0)) { subscriptions.push('*'); }
    else if ((user.siteadmin & 2) != 0) {
        if ((user.groups == null) || (user.groups.length == 0)) { subscriptions.push('server-users'); }
        else { for (var i in user.groups) { subscriptions.push('server-users:' + i); } }
    }
}
if (user.links != null) { for (var i in user.links) { subscriptions.push(i); } }
obj.parent.RemoveAllEventDispatch(target);
obj.parent.AddEventDispatch(subscriptions, target);
```
Flags: `2048 = SITERIGHT_ALLEVENTS`, `2 = SITERIGHT_MANAGEUSERS`.

### 5.17 `obj.routeAgentCommand(command, domainid, nodeid, meshid)` — line 10195
Routes a command from an agent to:
- A specific session: `obj.wssessions2[command.sessionid]`.
- A specific user: every entry in `obj.wssessions[command.userid]`.
- All users with `MESHRIGHT_AGENTCONSOLE` on the node (fanned out via `obj.wssessions`).

### 5.18 `obj.CheckWebServerOriginName(domain, req)` — line 6622
Compares `Origin` header hostname to `obj.getWebServerName(domain, req)`.

### 5.19 `obj.getWebServerName(domain, req)` — line 6615
Returns `domain.dns` or `req.headers.host` (sans port).

### 5.20 `obj.generateBaseURL(domain, req)` — line 6606
Returns `'https://' + getWebServerName(domain, req) + ':' + aliasport-or-port + url`.

### 5.21 `obj.isTrustedCert(domain)` — line 3732
Returns `true` if the cert matches a known root (`trustedCerts`) or matches any of the certs in the configured CA store.

### 5.22 `obj.getUserAgentInfo(req)` — line 10520
Returns `{ browserStr, osStr, browserVersion, browser, os }` using `ua-parser-js` and `ua-client-hints-js`.

### 5.23 `obj.getLanguageCodes(req)` — line 10267
Returns `[user.lang] || [req.query.lang] || parsed-accept-language`. Falls back to `user.llang`.

### 5.24 `obj.handleDomainRedirect(req, res)` — line 4512
Looks up `domain.redirects[<urlname>]` and redirects. `redirects['~showversion']` returns the version string.

### 5.25 `obj.handleMeshAgentRequest`, `obj.handleMeshOsxAgentRequest`, `obj.handleMeshSettingsRequest`, `obj.handleDevicePowerEvents`, `obj.handleAmtEventRequest`
- `obj.handleMeshAgentRequest = function (req, res)` — line 6116
- `obj.handleMeshOsxAgentRequest` — line 6633
- `obj.handleMeshSettingsRequest` — line 6813
- `obj.handleDevicePowerEvents` — line 6830
- `obj.handleAmtEventRequest` — line 5974

### 5.26 `obj.checkUserPassword(domain, user, password, func)` — line 2569
Hashes `password` with `user.salt` (IIS SHA-1 or pbkdf2 SHA384) and verifies.

### 5.27 `obj.checkOldUserPasswords(...)` — line 2598
Used by handlePasswordChangeRequest to reject recent passwords (and optionally common passwords via `wildleek`).

### 5.28 `obj.getServerFilePath(user, domain, path)` — line 4530
Sanitizes a `user/<domain>/<id>/...` or `mesh/<domain>/<id>/...` path under `filespath/domain[-<domain>]/<type>-<id>/...`. Validates with `IsFilenameValid` on each segment.

### 5.29 `obj.getQuota(objid, domain)` — line 4543
Resolves effective quota (user/mesh/domain).

### 5.30 `obj.getServerRootFilePath(user)` / `obj.deleteFolderRec(p)` — referenced at line 2550–2551.

---

## 6. Rendering Subsystem

### 6.1 `getRenderPage(pagename, req, domain)` — line 9970
Resolution order (with `mobile` / `minify` permutations):
1. Domain-specific views: `domain.webviewspath/{name}{-mobile}{-min}.handlebars`
2. Override views: `obj.parent.webViewsOverridePath/...`
3. Default: `obj.parent.webViewsPath/...`

### 6.2 `getRenderArgs(xargs, req, domain, page)` — line 10137
Decorates `xargs` with:
- `xargs.min` ('-min' or '')
- `xargs.titlehtml`, `xargs.title`, `xargs.title1`, `xargs.title2` (with placeholder substitution for `serverversion`, `servername`, `agentsessions`, `connectedusers`, `userssessions`, `relaysessions`, `relaycount`).
- `xargs.domainurl`, `xargs.autocomplete`, `xargs.hide`
- `xargs.randomlength` — 0–255 random bytes (BREACH mitigation).
- `xargs.customCSSTags`, `xargs.customJSTags` from `xargs.customFiles` (JSON-decoded custom-file directives).
- `generateThemePackCSSTags` / `generateThemePackJSTags` — if `domain.themepack` and `sitestyle === 3`.

### 6.3 `render(req, res, filename, args, user)` — line 10292
Wrapper that picks a localized handlebars file based on `obj.renderPages[domain.id][basename]`. Logic:
- English (`en` or `en-*`) → render original filename.
- Otherwise iterates `obj.getLanguageCodes(req)` to find a matching translation file (`name_lang.handlebars` in `views/translations`).
- Writes `user.llang` to DB so the same language is reused next time.

### 6.4 `getRenderList()` — line 10338
Scans `views/translations/` (default) and `meshcentral-web-<domain>/views/translations/` (overrides + per-domain overrides). Builds `obj.renderPages[domain][baseFilename] = { lang: fullpath }`.

### 6.5 `getEmailLanguageList()` — line 10404
Same translation scan but for email templates.

### 6.6 Active view files used
The handlebars templates live in `views/` — not in this file. The names referenced include:
- `login`, `login2`, `message`, `message2`, `error404`, `error4042`, `agentinvite`, `invite`, `xterm`, `player`, `sharing`, `default`, `default2`, `default3`, `admin`, `user`, `terms`.

The `user` (regular user mesh UI) and `admin` (site admin UI) views are performed by `meshuser.js` (which calls `res.render` through `obj.userRenderPage(...)` not shown here directly). The `default*` views are the frame layout.

---

## 7. Event Subscriptions and Dispatch

### 7.1 `AddEventDispatch` subscriptions (lines 139, 5910, 10864, 10903)
The webserver subscribes to:
- `server-shareremove` (line 139) — to close web relay sessions.
- `2fadev-<sessioncode>` (line 5910) — push-2FA handshake.
- `userid` (line 10864, 10903) — for resubscribe events tied to user-group membership changes.

### 7.2 `parent.DispatchEvent(targets, obj, event)` calls
Prominent emitters in this file:
- `parseAllowedFramingOrigins` (line 898) — not an event.
- Account create/login/change/logout (`handleLogoutRequest` line 927, `handleRootRequestLogin` 1522, `handleResetAccountRequest` 1955, `handleCreateAccountRequest` 1740, `handlePasswordChangeRequest` 2710, `handleDeleteAccountRequest` 2559, `handleUserImageRequest` 2069, `handleCheckMailRequest` 2131, `handleResetAccountRequest` 2169, `handleLoginRequest` 2872, `handleLoginRequest` 2924).
- User-group membership changes (lines 689, 2846, 10852, 10870, 10879, 10898, 10900, 10915).
- File-system operations (upload, batch upload, one-click recovery): `handleUploadFile` line 5030 / 5036 / 5065 / 5069 / 5074 / 5081, `handleUploadFileBatch` line 5180, `handleOneClickRecoveryFile` line 4676.
- Relay events: `handleRelayWebSocket` lines 5466, 5499, 5518, 5551, 5601, 5627, 5643, 5669; `handleUserImageRequest` 5770.
- `wssessioncount` events: `UpdateSessionCount` 9458, 9472, 9497.
- Duo 2FA success: line 7725.
- Account change caused by LDAP sync: line 716 (new), 765 (existing).

### 7.3 `obj.HandleEvent` (line 140)
```js
obj.HandleEvent = function (source, event, ids, id) {
    if (event.action == 'removedDeviceShare') {
        for (var relaySessionId in webRelaySessions) {
            if (webRelaySessions[relaySessionId].xpublicid === event.publicid) { webRelaySessions[relaySessionId].close(); }
        }
    }
}
```

---

## 8. Remote Services / Server Peering

### 8.1 `/meshserver.ashx` (line 7342)
```js
if (parent.multiServer != null) { obj.app.ws('/meshserver.ashx', function (ws, req) { parent.multiServer.CreatePeerInServer(parent.multiServer, ws, req, obj.args.tlsoffload == null); }); }
```
**Note:** there is no `app.get('/meshserver.ashx', ...)` in this file; the peering is websocket-only.

### 8.2 `/meshrelay.ashx` (line 7440)
```js
obj.app.ws(url + 'meshrelay.ashx', function (ws, req) {
    PerformWSSessionAuth(ws, req, true, function (ws1, req1, domain, user, cookie, authData) {
        if (((parent.config.settings.desktopmultiplex === true) || (domain.desktopmultiplex === true)) && (req.query.p == 2)) {
            obj.meshDesktopMultiplexHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); // 1-to-n
        } else {
            obj.meshRelayHandler.CreateMeshRelay(obj, ws1, req1, domain, user, cookie); // 1-to-1
        }
    });
});
```
This is the **remote relay** endpoint. Connection types: `?p=1` (HTTP), `?p=2` (KVM/Redirection), `?p=4` (Local-relay), `?p=...` (Intel AMT variants).

### 8.3 `PerformPeerLogin` (not in this file)
> `PerformPeerLogin` is **not** a function defined in `webserver.js`. The peer-login flow is handled inside `meshrelay.js` (`obj.meshRelayHandler.CreateMeshRelay`). The webserver only delegates to it via `PerformWSSessionAuth`.

### 8.4 Peer session tracking
`obj.wsPeerSessions`, `obj.wsPeerSessions2`, `obj.wsPeerSessions3`, `obj.sessionsCount` (lines 257–260) are populated by `meshuser.js` and read in `obj.routeAgentCommand` (line 10214) for cross-server routing.

---

## 9. Device-File Subsystem

### 9.1 WebSocket endpoint (lines 7425, 7911)
```js
obj.app.ws(url + 'devicefile.ashx', function (ws, req) { obj.meshDeviceFileHandler.CreateMeshDeviceFile(obj, ws, null, req, domain); });
```
Pipes a binary file stream between the agent and the browser.

### 9.2 HTTP endpoint (line 7426)
```js
obj.app.get(url + 'devicefile.ashx', handleDeviceFile);
```
`handleDeviceFile` (line 4045) requires:
- `req.query.c` — encrypted cookie `{ userid, domainid, usages: [10], nid, ... }`.
- `req.query.f` — filename.
- Optionally `req.query.n` — nodeid short form.
- Calls `obj.GetNodeWithRights(domain, user, 'node/' + domain.id + '/' + req.query.n, ...)` and requires `MESHRIGHT_REMOTECONTROL`.
- Then `obj.meshDeviceFileHandler.CreateMeshDeviceFile(obj, null, res, req, domain, user, node.meshid, node._id)`.

### 9.3 Agent download (`agentdownload.ashx`)
`handleAgentDownloadFile` (line 4075) — uses a 5-minute cookie `a: 'tmpdl'`, `d: domain.id`, `nid`, `f`. Serves `filespath/tmp/<f>` with `res.sendFile`.

---

## 10. AMT / IP-KVM Endpoints

### 10.1 `/ider.ashx` (no in-file mention)
> `app.ws('/ider.ashx', ...)` is **not** present in `webserver.js`. The Intel AMT IDE-Redirection endpoint is registered as `webider.ashx` at line 7397:
```js
obj.app.ws(url + 'webider.ashx', function (ws, req) { PerformWSSessionAuth(ws, req, false, function (ws1, req1, domain, user, cookie, authData) { obj.meshIderHandler.CreateAmtIderSession(obj, obj.db, ws1, req1, obj.args, domain, user); }); });
```

### 10.2 `/kvm.ashx` (no in-file mention)
> `app.ws('/kvm.ashx', ...)` is **not** present in `webserver.js`. The KVM-over-IP routing is handled via `meshrelay.ashx` with `?p=2` (Intel AMT Redirection) and the `handleRelayWebSocket` flow in `meshrelay.js`.

### 10.3 `/mstsc.html` (line 7496) → `handleMSTSCRequest(req, res, 'mstsc')`
- `handleMSTSCRequest` returns the page that opens a `wss://...` `mstscrelay.ashx` connection.
- Generates a 1-hour cookie `{ userid, domainid, nodeid, tcpport }` (line 2338).
- WebSocket relay: `app.ws(url + 'mstscrelay.ashx', ...)` → `require('./apprelays.js').CreateMstscRelay(obj, obj.db, ws, req, obj.args, domain)` (line 7502).

### 10.4 `/ssh.html` (line 7508) → `handleMSTSCRequest(req, res, 'ssh')`
- Three WebSocket routes (lines 7509, 7516, 7521):
  - `sshrelay.ashx` → `CreateSshRelay`.
  - `sshterminalrelay.ashx` → `CreateSshTerminalRelay` (after `PerformWSSessionAuth`).
  - `sshfilesrelay.ashx` → `CreateSshFilesRelay` (after `PerformWSSessionAuth`).

### 10.5 `/ipkvm.ashx/*` (lines 7482, 7487)
WebSocket + GET handler, both routed to `parent.ipKvmManager.handleIpKvmWebSocket` / `parent.ipKvmManager.handleIpKvmGet`.

---

## 11. Public Endpoints

| Endpoint | Handler | Line |
|---|---|---|
| `/favicon.ico` | *No explicit handler — falls through to `obj.express.static(obj.parent.webPublicPath)` (line 8129)* | — |
| `/stylesheets/*`, `/scripts/*`, `/images/*` | Served by `obj.express.static(obj.parent.webPublicPath)` (line 8129) | — |
| `/invite` (GET/POST) | `handleInviteRequest` (line 2199) | 7460/7461 |
| `/login` (GET/POST) | `handleRootRequest` / `handleRootPostRequest` | 7360/7361 |
| `/login-confirm*` | not in this file — handled by `meshuser.js` `CreateMeshUser` via `?login=` cookie | — |
| `/logout` | `handleLogoutRequest` (line 911) | 7363 |
| `/locales` | not registered in this file | — |
| `/captcha.ashx` (GET/POST) | `handleCaptchaGetRequest` / `handleCaptchaPostRequest` (lines 3799/3807) | 7476/7477 |
| `/webcert.ashx` | not in this file — typically served by `meshagent.js` via `userimage`-style endpoint | — |
| `/refresh.ashx` | inline `res.sendStatus(200)` | 7355 |
| `/health.ashx` | inline `res.send('ok')` | 7395 |
| `/userimage.ashx` | `handleUserImageRequest` (line 2432) | 7373 |
| `/serverpic.ashx` | inline anonymous | 7833 |

### 11.1 `handleUserImageRequest` (line 2432)
- Requires active session.
- Preloads `db.Get('im' + user._id)` doc with base64 image.
- Dispatches `image/png` or `image/jpeg` with `Cache-Control: no-store`.

### 11.2 `handleCaptchaGetRequest`/`handleCaptchaPostRequest` (lines 3799/3807)
- Require `parent.crowdSecBounser`.
- Engage the CrowdSec captcha workflow.

### 11.3 `handleNewAccountCaptchaRequest` (line 3788)
- Available if `domain.newaccountscaptcha` is set.
- Generates a `svg-captcha` image with cache cookie.

---

## 12. Helper Functions

### 12.1 `checkIpAddressEx(req, res, ipList, closeIfThis, redirectUrl)` — line 847
Generic IP match against an `ipcheck` list. `closeIfThis === true` causes `res.sendStatus(401)` or `res.redirect(redirectUrl)`.

### 12.2 `checkUserIpAddress(req, res)` — line 864
1. `getDomain(req)`.
2. Reject if `domain.userallowedip` set and IP not in list.
3. Reject if `domain.userblockedip` set and IP in list.
4. Bump `obj.blockedUsers` and return `null` on rejection.

### 12.3 `checkAgentIpAddress(req, res)` — line 876
Same, but reads `domain.agentallowedip` / `domain.agentblockedip`.

### 12.4 `getDomain(req)` — line 887
```js
function getDomain(req) {
    if (req.xdomain != null) { return req.xdomain; }
    if ((req.hostname == 'localhost') && (req.query.domainid != null)) { const d = parent.config.domains[req.query.domainid]; if (d != null) return d; }
    if (req.hostname != null) { const d = obj.dnsDomains[req.hostname.toLowerCase()]; if (d != null) return d; }
    const x = req.url.split('/');
    if (x.length < 2) return parent.config.domains[''];
    const y = parent.config.domains[x[1].toLowerCase()];
    if ((y != null) && (y.dns == null)) { return parent.config.domains[x[1].toLowerCase()]; }
    return parent.config.domains[''];
}
```
Resolution order: explicit `req.xdomain` → `localhost?domainid` → DNS hostname map → first URL path segment as domain name → default `''` domain.

### 12.5 `getUserAgentDomain` (not in this file)
The `getUserAgentInfo` function (line 10520) produces ua strings; the `domain` resolution above uses `req.hostname` from the `Host` header, not a UA-derived domain.

### 12.6 `createDeviceGroup` / `createDevice` (not in this file)
Neither is defined in `webserver.js`. They live in `meshagent.js` (the agent handler) and are invoked through the `meshAgentHandler.CreateMeshAgent(...)` callback.

### 12.7 `EscapeHtml` — line 292
`&`, `>`, `<`, `"`, `'` → entities.

### 12.8 `assembleStringFromObject(format, o)` — line 10817
Expands `{{{key}}}` placeholders from object `o`.

### 12.9 `syncExternalUserGroups(domain, user, userMemberships, userMembershipType)` — line 10827
Creates / updates / removes user-group memberships based on external (LDAP / OIDC) memberships. SHA-384 of the membership identifier is used as the user-group id.

### 12.10 `setSessionRandom(req)` — line 10746
Generates a 6-byte base64 random `req.session.x` if missing.

### 12.11 `isIPMatch(ip, matchList)` — line 10597
Calls `require('ipcheck').match(ip, entry)` for each entry.

### 12.12 `checkCookieIp(cookieip, ip)` — line 10809
`args.cookieipcheck` modes: `'none'`, `'strict'`, `'lax'` (default — IP/24 or both-private).

### 12.13 `isPrivateAddress(ip_addr)` — line 10783
Returns `true` for IPv4 RFC1918 / loopback / link-local and IPv6 unique-local / link-local / multicast prefixes.

### 12.14 `cleanRemoteAddr(addr)` — line 10579
Strips `::ffff:` prefix.

### 12.15 `getRandomPassword` / `getRandomLowerCase` / `getRandomSixDigitInteger` / `getRandomEightDigitInteger` — lines 10571–10576
Random password (9 bytes base64-URL-safe), lowercase string, 6/8-digit integer.

### 12.16 `getRandomAmtPassword` / `checkAmtPassword` — line 10569–10570
Generates a password that satisfies AMT complexity rules (≥8 chars, digit, lower, upper, special).

### 12.17 `setContentDispositionHeader(res, type, name, size, altname)` — line 10583
`Content-Disposition: attachment; filename="<urlencoded-name>"` with strict sanitization.

### 12.18 `getQueryPortion(req)` — line 10547
Returns the URL query string, but strips `duo_code` and `state` keys.

### 12.19 `getWebsocketArgs(ws, req, func)` — line 10721
If `req.query.moreargs == '1'`, waits for a JSON control message `{ action: 'urlargs', args: { ... } }` and merges into `req.query` before calling `func`.

### 12.20 `badLogin* / bad2fa*` (lines 10604–10717)
Throttling of IPs with too many bad-login / bad-2FA attempts.

### 12.21 `clearDestroyedSessions()` — line 10754
Purges `obj.destroyedSessions` entries older than 1 hour.

### 12.22 `parseAllowedFramingOrigins(val)` — line 898
Splits `allowedframingorigins` (string or array) into a normalized URL list.

### 12.23 `CheckListenPort(port, addr, func)` — line 9288
Pre-checks if a port is free before letting `StartWebServer`/`StartAltWebServer` bind.

### 12.24 `StartWebServer(port, addr)` — line 9297
Binds `obj.tlsServer.listen(...)` (or `obj.tcpServer` for tlsoffload).

### 12.25 `StartAltWebServer(port, addr)` — line 9337
Binds `obj.tlsAltServer` / `obj.tcpAltServer` for the agent-only port.

### 12.26 `tryUpload` / `cleanupUploads` (not separately traced)
`handleUploadFile` and `handleUploadFileBatch` use `resolveSafeUploadTempPath` to guard tmp-file origins.

---

## 13. Periodic Timers (`setInterval` / `setTimeout`)

| Timer | Line | Purpose |
|---|---|---|
| `setTimeout(checkWebRelaySessionsTimeout, …)` indirectly via `setInterval(checkWebRelaySessionsTimeout, 10000)` | 8062 | Cleanup inactive web relay sessions every 10s |
| `setInterval(function () { obj.wsagentsDisconnections = {}; }, 120000)` | 8132 | Flush agent disconnect-rate map every 2 min |
| `setTimeout(... 5000)` inside `handleRelayWebSocket` | 5481, 5533, 5609, 5651 | Wait 5s then finalize recording files |
| `setTimeout(resolve, 5000)` in OIDC discovery retry | 8452 | 5 s back-off between OIDC discovery attempts |

There are no other `setInterval` calls in the file. Most concurrency is event-driven (WebSocket events, db callbacks, event dispatch).

---

## 14. MeshCentral UI Files (Views, referenced)

These are not in `webserver.js` itself but are referenced via `getRenderPage(...).handlebars`:

- `views/default.handlebars` — top-level layout for the user UI (rendered by `meshuser.js`).
- `views/default2.handlebars` / `views/default3.handlebars` — alternates (controlled by `domain.sitestyle`).
- `views/login.handlebars` — login page (rendered by `handleRootRequest` when `req.session.userid` is null).
- `views/login2.handlebars` — modern login (sitestyle ≥ 2).
- `views/nav.handlebars` — partial included by `default.handlebars` (sidebar nav).
- `views/admin.handlebars` — admin UI (rendered by `meshuser.js` when user is site admin).
- `views/user.handlebars` — main user frame.
- `views/message.handlebars` / `views/message2.handlebars` — generic message pages.
- `views/error404.handlebars` / `views/error4042.handlebars` — 404 pages.
- `views/agentinvite.handlebars` — agent invite page.
- `views/invite.handlebars` — invite code entry page.
- `views/xterm.handlebars` — helper that opens the xterm.js relay (MSTSC/SSH).
- `views/player.handlebars` — recording player shell.
- `views/sharing.handlebars` — guest sharing page.
- `views/terms.handlebars` — terms of service.
- `views/translations/*.handlebars` — language variants (`<name>_<lang>.handlebars`).

The `default.handlebars` is the umbrella layout that includes nav and renders the panel based on the URL hash. `nav.handlebars` is the left-hand sidebar with device groups, etc.

---

## 15. End-to-End Maps

### 15.1 Login → Session → Render
```
User → POST /login (handleRootPostRequest)
  → obj.authenticate(name, pass, domain, fn)
  → 2FA gate (checkUserOneTimePasswordRequired)
  → req.session.userid = user._id; req.session.ip = req.clientIp; setSessionRandom(req);
  → render('user'|'admin'|...)

User → POST /tokenlogin (handleLoginRequest)
  → obj.authenticate('~t:<token>', pass, domain, fn)
  → ...
```

### 15.2 Agent Connection
```
Mesh Agent → WS /agent.ashx?key=...
  → checkAgentIpAddress(ws, req)
  → if domain.agentkey set, check req.query.key
  → obj.meshAgentHandler.CreateMeshAgent(obj, obj.db, ws, req, obj.args, domain)
    → populates obj.wsagents[nodeid]
    → registers meshAgentHandler.HandleEvent
```

### 15.3 User Browser → Control
```
Browser → WS /<domain>/control.ashx (after HTTP login)
  → getWebsocketArgs(ws, req, function(ws, req) { ... })
  → CheckWebServerOriginName(domain, req)
  → PerformWSSessionAuth(ws, req, true, (ws, req, domain, user, cookie, authData) => {
        if (user == null) { PerformWSSessionInnerAuth(...) }  // x-meshauth=* branch
        else { obj.meshUserHandler.CreateMeshUser(obj, obj.db, ws, req, args, domain, user, authData) }
    })
  → meshUser adds itself to obj.wssessions[userid] and obj.wssessions2[userid/x]
```

### 15.4 Web Relay
```
Browser → GET /<domain>/meshrelay.ashx?auth=<authCookie>&host=nodeid&p=2
  → PerformWSSessionAuth(..., false, handleRelayWebSocket)
  → handleRelayWebSocket(ws, req, domain, user, cookie)
    → db.Get(host) → node
    → GetNodeRights(user, node.meshid, node._id) & MESHRIGHT_REMOTECONTROL
    → optional peer-relay routing
    → optional session recording
    → opens TCP/TLS or CIRA channel to AMT
    → forwards ws ↔ tcp
```

### 15.5 Guest Sharing
```
Owner → POST /<domain>/meshsettings (creates deviceshare doc)
Get link → GET /<domain>/sharing?c=<cookie>
  → handleSharingRequest → handleSharingRequestEx
  → authCookie constructed; redirect to /control-redirect.ashx on a relay DNS
  → webRelayRouter resolves to a free relay host, calls CreateWebRelaySession
```

---

## 16. Notable Code Excerpts (with line numbers)

### 16.1 The Express boot & session middleware (lines 7007–7070)
```js
obj.app.engine('handlebars', obj.exphbs.engine({ defaultLayout: false }));
obj.app.set('view engine', 'handlebars');
...
const keygrip = require('keygrip')((typeof obj.args.sessionkey == 'string') ? [obj.args.sessionkey] : obj.args.sessionkey, 'sha384', 'base64');
const sessionOptions = {
    name: 'xid',
    httpOnly: true,
    keys: keygrip,
    secure: (obj.args.tlsoffload == null),
    sameSite: (obj.args.sessionsamesite ? obj.args.sessionsamesite : 'lax')
}
if (obj.args.sessiontime != null) { sessionOptions.maxAge = (obj.args.sessiontime * 60000); }
obj.app.use(require('cookie-session')(sessionOptions));
obj.app.use(function (request, response, next) { /* passport patch */ });
```

### 16.2 Global security headers middleware (lines 7192–7244)
```js
const cspBase = "default-src 'none'; font-src 'self' fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' " + extraScriptSrc + "; connect-src 'self'" + geourl + selfurl + "; img-src 'self' blob: data:" + geourl + extraImgSrc + " data:; style-src 'self' 'unsafe-inline' fonts.googleapis.com; frame-src 'self' blob: mcrouter:" + extraFrameSrc + "; media-src 'self'; form-action 'self' " + duoSrc + "; manifest-src 'self'";
if (hasAllowedFramingOrigins) {
    var frameAncestors = "'self'" + (framingOrigins.length > 0 ? ' ' + framingOrigins.join(' ') : '');
    cspBase += "; frame-ancestors " + frameAncestors;
}
const headers = {
    'Referrer-Policy': 'no-referrer',
    'X-XSS-Protection': '1; mode=block',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': cspBase
};
if (req.headers['user-agent'] && (req.headers['user-agent'].indexOf('Chrome') >= 0)) { headers['Permissions-Policy'] = 'interest-cohort=()'; }
...
res.set(headers);
```

### 16.3 Plugin admin handlers (lines 6893–6921)
```js
obj.handlePluginAdminReq = function (req, res) {
    const domain = checkUserIpAddress(req, res);
    if (domain == null) { return; }
    if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
    var user = obj.users[req.session.userid];
    if (user == null) { res.sendStatus(401); return; }
    parent.pluginHandler.handleAdminReq(req, res, user, obj);
}
obj.handlePluginAdminPostReq = function (req, res) {
    const domain = checkUserIpAddress(req, res);
    if (domain == null) { return; }
    if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
    var user = obj.users[req.session.userid];
    if (user == null) { res.sendStatus(401); return; }
    parent.pluginHandler.handleAdminPostReq(req, res, user, obj);
}
obj.handlePluginJS = function (req, res) {
    const domain = checkUserIpAddress(req, res);
    if (domain == null) { return; }
    if ((!req.session) || (req.session == null) || (!req.session.userid)) { res.sendStatus(401); return; }
    var user = obj.users[req.session.userid];
    if (user == null) { res.sendStatus(401); return; }
    parent.pluginHandler.refreshJS(req, res);
}
```

### 16.4 Rights computation & ACL helpers (lines 9507–9615)
```js
function removeUserRights(rights, user) {
    if (user.removeRights == null) return rights;
    var add = 0, substract = 0;
    if ((user.removeRights & 0x00000008) != 0) { substract += 0x00000008; } // No Remote Control
    ...
    if (rights != 0xFFFFFFFF) { rights |= add; rights &= (0xFFFFFFFF - substract); }
    else { rights = 1+2+4+8+32+64+128+16384+32768+131072+262144+524288+1048576; rights |= add; rights &= (0xFFFFFFFF - substract); }
    return rights;
}

obj.GetNodeWithRights = function (domain, user, nodeid, func) {
    ...
    db.Get(nodeid, function (err, nodes) {
        ...
        // direct device link
        var r = user.links[nodeid]; if (r != null) { rights |= r.rights; visible = true; }
        // direct mesh link
        r = user.links[nodes[0].meshid]; if (r != null) { rights |= r.rights; visible = true; }
        // user-group links
        for (var i in user.links) {
            if (i.startsWith('ugrp/')) {
                const g = obj.userGroups[i];
                if (g && (g.links != null)) {
                    r = g.links[nodes[0].meshid]; if (r != null) { rights |= r.rights; visible = true; }
                    r = g.links[nodeid];      if (r != null) { rights |= r.rights; visible = true; }
                }
            }
        }
        rights = removeUserRights(rights, user);
        func(nodes[0], rights, visible);
    });
}
```

### 16.5 `CreateNodeDispatchTargets` (line 9859)
```js
obj.CreateNodeDispatchTargets = function (mesh, nodeid, addedTargets) {
    var targets = (addedTargets != null) ? addedTargets : [];
    targets.push(nodeid);
    if (targets.indexOf('*') == -1) { targets.push('*'); }
    if (typeof mesh == 'string') { mesh = obj.meshes[mesh]; }
    if (mesh != null) { targets.push(mesh._id); for (var i in mesh.links) { if (i.startsWith('ugrp/')) { targets.push(i); } } }
    for (var i in obj.userGroups) { const g = obj.userGroups[i]; if ((g != null) && (g.links != null) && (g.links[nodeid] != null)) { targets.push(i); } }
    return targets;
}
```

### 16.6 `CloneSafeUser` (line 9870)
```js
obj.CloneSafeUser = function (user) {
    if (typeof user != 'object') { return user; }
    var user2 = Object.assign({}, user);
    delete user2.hash; delete user2.passhint; delete user2.salt; delete user2.type;
    delete user2.domain; delete user2.subscriptions; delete user2.passtype;
    delete user2.otpsms; delete user2.otpmsg;
    if ((typeof user2.otpekey == 'object') && (user2.otpekey != null)) { user2.otpekey = 1; }
    if ((typeof user2.otpduo == 'object') && (user2.otpduo != null)) { user2.otpduo = 1; }
    if ((typeof user2.otpsecret == 'string') && (user2.otpsecret != null)) { user2.otpsecret = 1; }
    if ((typeof user2.otpkeys == 'object') && (user2.otpkeys != null)) { user2.otpkeys = 0; if (user.otpkeys != null) { for (var i = 0; i < user.otpkeys.keys.length; i++) { if (user.otpkeys.keys[i].u == true) { user2.otpkeys = 1; } } } }
    if ((typeof user2.otphkeys == 'object') && (user2.otphkeys != null)) { user2.otphkeys = user2.otphkeys.length; }
    if ((typeof user2.otpdev == 'string') && (user2.otpdev != null)) { user2.otpdev = 1; }
    if ((typeof user2.webpush == 'object') && (user2.webpush != null)) { user2.webpush = user2.webpush.length; }
    return user2;
}
```

### 16.7 `getRenderPage` (lines 9970–10022)
```js
function getRenderPage(pagename, req, domain) {
    var mobile = isMobileBrowser(req), minify = (domain.minify == true), p;
    if (req.query.mobile == '1') { mobile = true; } else if (req.query.mobile == '0') { mobile = false; }
    ...
    if (mobile) {
        if ((domain != null) && (domain.webviewspath != null)) { /* domain + mobile */ }
        if (obj.parent.webViewsOverridePath != null) { /* override + mobile */ }
        if (minify) { ... } /* default + mobile + min */
        p = obj.path.join(obj.parent.webViewsPath, pagename + '-mobile');
        if (obj.fs.existsSync(p + '.handlebars')) { return p; }
    }
    /* desktop path... */
    return null;
}
```

### 16.8 `getDomain` (line 887)
```js
function getDomain(req) {
    if (req.xdomain != null) { return req.xdomain; }
    if ((req.hostname == 'localhost') && (req.query.domainid != null)) { const d = parent.config.domains[req.query.domainid]; if (d != null) return d; }
    if (req.hostname != null) { const d = obj.dnsDomains[req.hostname.toLowerCase()]; if (d != null) return d; }
    const x = req.url.split('/');
    if (x.length < 2) return parent.config.domains[''];
    const y = parent.config.domains[x[1].toLowerCase()];
    if ((y != null) && (y.dns == null)) { return parent.config.domains[x[1].toLowerCase()]; }
    return parent.config.domains[''];
}
```

### 16.9 `PerformWSSessionAuth` opening (line 8984)
```js
function PerformWSSessionAuth(ws, req, noAuthOk, func) {
    if ((req.session != null) && (typeof req.session.expire == 'number') && (req.session.expire <= Date.now())) { ... ws.close(); }
    if (obj.checkAllowLogin(req) == false) { ... }
    try {
        ws._socket.pause();
        var domain = null;
        if (noAuthOk == true) { domain = getDomain(req); if (domain == null) { ... } }
        else { domain = checkUserIpAddress(ws, req); if (domain == null) { ... } }
        if (req.headers['x-meshauth'] === '*') { func(ws, req, domain, null); return; }
        ...
    }
}
```

### 16.10 `isTrustedCert` (line 3732)
```js
obj.isTrustedCert = function (domain) {
    // Walks the certificate chain against a built-in trusted-roots list.
    ...
}
```

### 16.11 `subscribe` (line 5199)
```js
obj.subscribe = function (userid, target) {
    const user = obj.users[userid];
    if (user == null) return;
    const subscriptions = [userid, 'server-allusers'];
    if (user.siteadmin != null) {
        if ((user.siteadmin == 0xFFFFFFFF) || ((user.siteadmin & 2048) != 0)) { subscriptions.push('*'); }
        else if ((user.siteadmin & 2) != 0) {
            if ((user.groups == null) || (user.groups.length == 0)) { subscriptions.push('server-users'); }
            else { for (var i in user.groups) { subscriptions.push('server-users:' + i); } }
        }
    }
    if (user.links != null) { for (var i in user.links) { subscriptions.push(i); } }
    obj.parent.RemoveAllEventDispatch(target);
    obj.parent.AddEventDispatch(subscriptions, target);
    return subscriptions;
};
```

### 16.12 `syncExternalUserGroups` (line 10827)
```js
function syncExternalUserGroups(domain, user, userMemberships, userMembershipType) {
    var userChanged = false;
    if (user.links == null) { user.links = {}; }
    var existingUserMemberships = {};
    for (var i in user.links) {
        if (i.startsWith('ugrp/') && (obj.userGroups[i] != null) && (obj.userGroups[i].membershipType == userMembershipType)) { existingUserMemberships[i] = obj.userGroups[i]; }
    }
    for (var i in userMemberships) {
        const membership = userMemberships[i];
        var ugrpid = 'ugrp/' + domain.id + '/' + obj.crypto.createHash('sha384').update(membership).digest('base64').replace(/\+/g, '@').replace(/\//g, '$');
        var ugrp = obj.userGroups[ugrpid];
        if (ugrp == null) {
            ugrp = { type: 'ugrp', _id: ugrpid, name: membership, domain: domain.id, membershipType: userMembershipType, links: {} };
            db.Set(ugrp);
            if (db.changeStream == false) { obj.userGroups[ugrpid] = ugrp; }
            var event = { etype: 'ugrp', ugrpid, name: ugrp.name, action: 'createusergroup', links: ugrp.links, ... };
            parent.DispatchEvent(['*', ugrpid, user._id], obj, event);
        }
        if (existingUserMemberships[ugrpid] == null) {
            user.links[ugrp._id] = { rights: 1 };
            userChanged = true;
            db.SetUser(user);
            parent.DispatchEvent([user._id], obj, 'resubscribe');
            ...
        } else { delete existingUserMemberships[ugrpid]; }
    }
    for (var ugrpid in existingUserMemberships) { /* remove the user from the group */ }
    return userChanged;
}
```

### 16.13 Theme-pack + static mount (lines 8099–8129)
```js
obj.app.use(url, function (req, res, next) {
    if (req.method !== 'GET') return next();
    var domain = getDomain(req);
    if (domain && domain.themepack) {
        var themeFilePath = obj.path.join(obj.parent.datapath, 'theme-pack', domain.themepack, 'public', req.path);
        if (themeFilePath.indexOf('..') >= 0) return next();
        obj.fs.stat(themeFilePath, function (err, stats) {
            if (err || !stats.isFile()) return next();
            res.sendFile(themeFilePath);
        });
    } else { next(); }
});

obj.app.use(url, function(req, res, next){
    var domain = getDomain(req);
    if (domain.webpublicpath != null) { obj.express.static(domain.webpublicpath)(req, res, next); }
    else if (obj.parent.webPublicOverridePath != null) { obj.express.static(obj.parent.webPublicOverridePath)(req, res, next); }
    else { next(); }
});

obj.app.use(url, obj.express.static(obj.parent.webPublicPath));

obj.wsagentsDisconnectionsTimer = setInterval(function () { obj.wsagentsDisconnections = {}; }, 120000);
```

---

## 17. Summary of Counts

- **Total lines:** 10,924
- **`app.get` registrations:** 39 (across main app + agentapp + webRelayRouter)
- **`app.post` registrations:** 24
- **`app.ws` registrations:** 24 (counting `agentapp` variants)
- **`app.use` middleware:** 13 (compression, cookie-session, passport patch, agentapp auth, big security headers, theme-pack, two static fallbacks, well-known, .well-known, error 404)
- **Rights constants:** 25 mesh + 13 site
- **Event-Dispatch subscriptions on `obj`:** 3 (`server-shareremove`, `2fadev-<code>`, `userid` resubscribe)
- **`setInterval` timers:** 2 (web relay every 10s, agent disconnect flush every 120s)
- **`setTimeout` calls:** ~12 (mostly 5 s recording-file finalizers and OIDC discovery 5 s back-off)
- **Helper functions written in this file:** ~80 (handle*Request, render helpers, ACL helpers, BAD-account throttling, etc.)

---

## 18. Companion Files Referenced

`webserver.js` is the *router*; business logic is in companion modules:

| Module | Purpose |
|---|---|
| `meshagent.js` | `meshAgentHandler.CreateMeshAgent` (line 7866 consumer). |
| `meshuser.js` | `meshUserHandler.CreateMeshUser` (line 7420), `meshUserHandler.CreateMeshUserHandleEvent` (line 5218). |
| `meshrelay.js` | `meshRelayHandler.CreateMeshRelay` (line 7445), `CreateLocalRelay` (line 7455), `recordingEntry` (line 5322). |
| `meshdesktopmultiplex.js` | `meshDesktopMultiplexHandler.CreateMeshRelay` (line 7443). |
| `meshdevicefile.js` | `meshDeviceFileHandler.CreateMeshDeviceFile` (lines 7425, 7911). |
| `amt/amt-ider.js` | `meshIderHandler.CreateAmtIderSession` (line 7397). |
| `apprelays.js` | `CreateMstscRelay` (line 7502), `CreateSshRelay` (line 7514), `CreateSshTerminalRelay` (line 7518), `CreateSshFilesRelay` (line 7523), `CreateWebRelaySession` (line 8049). |
| `webauthn.js` | `obj.webauthn` (line 60). |
| `pass.js` | `hash`, `iishash` (lines 520, 808, 812, 820, 2154, 2584, 2625, 2635). |
| `common.js` | `obj.common` (line 46); helpers like `unEscapeAllLinksFieldName`, `validateStrArray`, `validateObject`, `validateString`, `validateEmail`, `validateUrl`, `validateRemoteImage`, `makeFilename`, `replacePlaceholders`, `IsFilenameValid`, `convertStrArray`, `joinPath`, `zeroPad`, `copyFile`, `translationsToJson`. |
| `interceptor.js` | `interceptor.CreateHttpInterceptor` / `CreateRedirInterceptor` (line 5737). |
| `multiparty` | Form parsing for `handleUploadFile*` (line 5093). |
| `compression` | gzip middleware (line 74). |
| `express-ws` | WebSocket plumbing (lines 6929, 6979, 6991, 7002). |
| `mqttbroker` (loaded by `parent`) | Optional MQTT over WS (line 7870). |
| `mpsserver` (loaded by `parent`) | Intel AMT CIRA / APF (line 7393, 7874). |
| `pluginHandler` (loaded by `parent`) | Plugin subsystem (lines 7340, 6893, 7463). |
| `multiServer` (loaded by `parent`) | Server peering (lines 7342, 5252, 10212). |
| `webrelayserver` (loaded by `parent`) | Out-of-process web relay (e.g. for ports other than 443). |
| `crowdSecBounser` (loaded by `parent`) | Optional CrowdSec enforcement (lines 7253, 7475). |
| `firebase` (loaded by `parent`) | Push notifications (lines 7530, 7531). |
| `smsserver`, `msgserver`, `mailserver` (loaded by `parent`) | 2FA delivery and account email. |

---

## 19. Permissions Audit Highlights

- **Cookie name:** `xid` (overridden to avoid `connect.sid`).
- **Cookie key-grip:** SHA-384, base64.
- **CSP:** very strict default, expanded per-domain via `domain.httpheaders` and `allowedframingorigins`.
- **HSTS:** on by default if cert is trusted.
- **X-Frame-Options:** `sameorigin` unless `allowedframingorigins` is set.
- **Session IP binding:** enforced by `checkCookieIp` (default `'lax'`, `/24` IPv4 or both-private).
- **Bad-login throttling:** `obj.args.maxinvalidlogin` (default `{ time: 10, count: 10 }`).
- **Bad-2FA throttling:** `obj.args.maxinvalid2fa` (default `{ time: 10, count: 10 }`).
- **Lockout:** `user.siteadmin & 32` ⇒ `SITERIGHT_LOCKED`.
- **Account-settings lockout:** `user.siteadmin & 1024` ⇒ `SITERIGHT_LOCKSETTINGS`.
- **`captureStackTrace` patch on `res.render` / `res.send`** (lines 7256–7273) for cleaner error reporting.
- **Path traversal guards:** `themeFilePath.indexOf('..') >= 0` → `next()` (line 8106); `resolveSafeUploadTempPath` (line 119) for file uploads; `IsFilenameValid` for filenames.

---

## 20. File-Save Note

The `webserver.js` source file was fetched into the agent's tool-result cache as
`/home/agent_fb4269e5-3b42-4144-ad55-577f44cce5d3/.local/share/kilo/tool-output/tool_fab662ffd001mjG6wwPZaMBD3z`
(10,924 lines, ~700 KB). The bash tool was unavailable in this sandbox, so a direct
`cp` into `/tmp/analysis/meshcentral-core/webserver.js` could not be performed.
This document constitutes the structured analysis that was requested.

---

*End of analysis. All line numbers refer to the file as fetched from `https://raw.githubusercontent.com/Ylianst/MeshCentral/master/webserver.js`.*
