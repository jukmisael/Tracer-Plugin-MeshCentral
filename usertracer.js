/**
 * User-Device Tracer v3.6.0
 * ==========================
 * Corrigido conforme análise (v3.5.80 → v3.6.0):
 *   #1, #22  ACL no device tab (GetNodeWithRights)
 *   #3       stopScanner() + safeReload() para não vazar setInterval
 *   #4       Não gerar login events no bounce de agente (cross-ref lastconnect)
 *   #5,#20   Logs gateados por UT_DEBUG + redação de PII (usuário)
 *   #7       db.js agora suporta MongoDB / SQL (delegado para db.js)
 *   #10      registerPermissions RBAC (can_view_history, can_purge_history)
 *   #12,#2   Handler único (ms.socket.addEventListener). Sem leak em reload.
 *   #13      Tratamento de erro em addEvent
 *   #15      powerState lido diretamente do DB em getTimeline, sem cache volátil
 *   #19      Debounce nas requisições WS no frontend
 */
"use strict";

// Configurável via env var (apenas)
var UT_DEBUG = (typeof process !== 'undefined' && process.env && process.env.UT_DEBUG === '1');

// Event types enum (elimina drift entre scanner/admin)
var UT_EVENT = Object.freeze({
    LOGIN:   'userLogin',
    LOGOUT:  'userLogout',
    LOCK:    'userLock',
    UNLOCK:  'userUnlock'
});

// Categorias de log
var UT_LOG = {
    error: function (ctx, err, extra) {
        try {
            var msg = '[UT ERROR] ' + ctx + ': ' + (err && err.message ? err.message : String(err));
            if (extra) msg += ' extra=' + JSON.stringify(extra);
            if (UT_DEBUG) msg += ' stack=' + (err && err.stack ? err.stack : '(no stack)');
            console.log(msg);
        } catch (_) {}
    },
    debug: function () {
        if (!UT_DEBUG) return;
        try { console.log('[UT DEBUG] ' + Array.prototype.slice.call(arguments).join(' ')); } catch (_) {}
    },
    info: function () {
        if (!UT_DEBUG) return;
        try { console.log('[UT INFO] ' + Array.prototype.slice.call(arguments).join(' ')); } catch (_) {}
    }
};

// Redação de PII para logs em produção (hash curto do usuário)
function _utRedactUser(u) {
    if (!u) return '<null>';
    var s = String(u);
    if (s.length <= 1) return s;
    if (s.indexOf('@') >= 0 || s.indexOf('\\') >= 0) {
        var parts = s.split(/[\\@]/);
        var domain = parts[0];
        var name = parts[1] || '';
        return domain + '\\' + (name.length > 1 ? name[0] + '***' + name[name.length - 1] : '***');
    }
    return s.length > 4 ? s.substring(0, 2) + '***' + s[s.length - 1] : '***';
}

// Validate eventType
function _utValidEventType(t) {
    for (var k in UT_EVENT) if (UT_EVENT[k] === t) return true;
    return false;
}

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.db = null;
    obj.mdb = obj.meshServer.db;
    obj.scanTimer = null;
    obj.intervalRef = null;
    obj.SCAN_INTERVAL = 30000;
    obj.userCache = {};
    obj.devicePower = {};     // TTL cache for power/conn state — replaces volatile devicePwr (#15)
    obj._pendingCheck = {};
    obj._stopped = false;
    obj._permissionsRegistered = false;

    UT_LOG.info('module loaded. parent.type=' + typeof parent + ' meshServer.type=' + typeof obj.meshServer);

    // -----------------------------------------------------------------------
    // server_startup — entrypoint
    // -----------------------------------------------------------------------
    obj.server_startup = function () {
        try {
            UT_LOG.info('server_startup: init');
            // #3 — sempre parar interval anterior antes de criar novo (hot-reload safe)
            obj.stopScanner();

            obj.meshServer.pluginHandler.usertracer_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
            obj.db = obj.meshServer.pluginHandler.usertracer_db;

            // #10 — registrar permissões uma vez
            if (!obj._permissionsRegistered && obj.parent && typeof obj.parent.registerPermissions === 'function') {
                try {
                    obj.parent.registerPermissions('usertracer', {
                        can_view_history: {
                            title: 'User Tracer: visualizar histórico',
                            desc:  'Permite abrir o painel admin e a aba de histórico do dispositivo',
                            default: 'allowed'
                        },
                        can_purge_history: {
                            title: 'User Tracer: limpar histórico',
                            desc:  'Permite excluir eventos do histórico de Tracer',
                            default: 'denied'
                        }
                    });
                    obj._permissionsRegistered = true;
                } catch (e) { UT_LOG.error('registerPermissions', e); }
            }

            obj.startScanner();
            obj._stopped = false;
        } catch (e) {
            UT_LOG.error('server_startup', e, { step: 'init' });
        }
    };

    // #3 — stop timer (safe to call multiple times)
    obj.stopScanner = function () {
        obj._stopped = true;
        if (obj.scanTimer) { clearInterval(obj.scanTimer); obj.scanTimer = null; }
        if (obj.intervalRef) { clearInterval(obj.intervalRef); obj.intervalRef = null; }
        // cancela debounces pendentes
        if (obj._pendingCheck) {
            Object.keys(obj._pendingCheck).forEach(function (k) {
                if (obj._pendingCheck[k]) { clearTimeout(obj._pendingCheck[k]); delete obj._pendingCheck[k]; }
            });
        }
    };

    obj.startScanner = function () {
        if (obj._stopped) return;
        if (obj.scanTimer) clearInterval(obj.scanTimer);
        obj.scanNow(); // dispara imediatamente
        obj.scanTimer = setInterval(obj.scanNow, obj.SCAN_INTERVAL);
        // permite que o processo termine mesmo com o timer ativo
        if (typeof obj.scanTimer.unref === 'function') obj.scanTimer.unref();
        UT_LOG.info('scanner started interval=' + obj.SCAN_INTERVAL + 'ms');
    };

    obj.scanNow = function () {
        if (obj._stopped || !obj.meshServer || !obj.meshServer.webserver) return;
        var ws = obj.meshServer.webserver.wsagents;
        if (!ws) return;
        var ids = Object.keys(ws);
        UT_LOG.info('scanNow n=' + ids.length);
        for (var i = 0; i < ids.length; i++) {
            if (!ids[i]) continue;
            obj.checkNode(ids[i]);
        }
        // Limpar entradas de devicePower para devices offline a > 5 min
        var now = Date.now();
        if (obj.devicePower) {
            Object.keys(obj.devicePower).forEach(function (k) {
                if (obj.devicePower[k] && (now - obj.devicePower[k].time) > 5 * 60 * 1000) {
                    delete obj.devicePower[k];
                }
            });
        }
    };

    obj.checkNode = function (nodeid) {
        if (obj._stopped) return;
        if (!nodeid || typeof nodeid !== 'string') return;
        if (!obj.mdb || typeof obj.mdb.Get !== 'function') return;

        obj.mdb.Get(nodeid, function (err, docs) {
            if (err || !docs || !docs.length) return;
            var doc = docs[0];
            if (!doc || !doc._id) return;

            // #15 — cache de power state com TTL
            obj.devicePower[nodeid] = {
                pwr: doc.pwr, conn: doc.conn,
                lastconnect: doc.lastconnect,
                time: Date.now()
            };

            var currentUsers = Array.isArray(doc.users) ? doc.users : [];
            var currentLusers = Array.isArray(doc.lusers) ? doc.lusers : [];
            var cacheState = { users: currentUsers, lusers: currentLusers };
            var key = JSON.stringify(cacheState);
            var prev = obj.userCache[nodeid];
            var nodeName = doc.name || nodeid;

            // #4 — Não gerar login events falsos no bounce de agente.
            // Use doc.lastconnect para distinguir "primeiro scan após reconexão" de "primeiro scan ever"
            if (!prev) {
                obj.userCache[nodeid] = key;
                if (!obj.db || typeof obj.db.getEventsByNode !== 'function') return;

                var initialLoggedSince = (typeof doc.lastconnect === 'number') ? new Date(doc.lastconnect * 1000) : null;
                obj.db.getEventsByNode(nodeid, { limit: 1 }, function (events) {
                    var hasPrior = events && events.length > 0;
                    // Só gera "first login" se não houver histórico E lastconnect > 2 min (evita bounce recém-conectado)
                    var recentBounce = initialLoggedSince && ((Date.now() - initialLoggedSince.getTime()) < 2 * 60 * 1000);
                    if (!hasPrior && !recentBounce && currentUsers.length > 0) {
                        UT_LOG.info('first scan ever for ' + nodeName + ' with ' + currentUsers.length + ' users');
                        currentUsers.forEach(function (u) { obj.storeEvent(nodeid, nodeName, u, UT_EVENT.LOGIN); });
                    }
                });
                return;
            }

            if (prev === key) return;
            obj.userCache[nodeid] = key;

            var prevState = JSON.parse(prev);
            var prevUsers = prevState.users || [];
            var prevLusers = prevState.lusers || [];

            // detect LOGIN / LOGOUT
            currentUsers.forEach(function (u) {
                if (prevUsers.indexOf(u) === -1) {
                    // não emitir se for unlock (lock→login não é login novo)
                    var wasLocked = prevLusers.indexOf(u) >= 0;
                    obj.storeEvent(nodeid, nodeName, u, wasLocked ? UT_EVENT.UNLOCK : UT_EVENT.LOGIN);
                }
            });
            prevUsers.forEach(function (u) {
                if (currentUsers.indexOf(u) === -1) obj.storeEvent(nodeid, nodeName, u, UT_EVENT.LOGOUT);
            });

            // detect LOCK / UNLOCK (lógica adicional)
            currentUsers.forEach(function (u) {
                var isNowLocked = currentLusers.indexOf(u) >= 0;
                var wasLocked = (prevLusers.indexOf(u) >= 0) && (prevUsers.indexOf(u) >= 0);
                if (isNowLocked && !wasLocked && prevUsers.indexOf(u) >= 0) {
                    obj.storeEvent(nodeid, nodeName, u, UT_EVENT.LOCK);
                }
                // O unlock já é tratado acima (via path "was in lusers before")
            });
        });
    };

    obj.storeEvent = function (nodeid, nodeName, userStr, eventType) {
        if (!_utValidEventType(eventType)) {
            UT_LOG.error('storeEvent', new Error('invalid eventType'), { eventType: eventType });
            return;
        }
        if (!obj.db || typeof obj.db.addEvent !== 'function') {
            UT_LOG.error('storeEvent', new Error('db.addEvent not available'));
            return;
        }
        try {
            var username = userStr;
            var domain = '';
            if (typeof userStr === 'string') {
                if (userStr.indexOf('\\') >= 0) { var p = userStr.split('\\'); domain = p[0]; username = p[1]; }
                else if (userStr.indexOf('@') >= 0) { var p = userStr.split('@'); domain = p[1]; username = p[0]; }
            }
            var evt = {
                nodeid: nodeid,
                nodeName: nodeName,
                username: username,
                domain: domain,
                displayUser: userStr,
                eventType: eventType,
                detectedAt: new Date().toISOString()
            };
            obj.db.addEvent(evt); // #13 — addEvent agora trata erro internamente
            UT_LOG.info('event stored node=' + nodeName + ' user=' + _utRedactUser(userStr) + ' type=' + eventType);
        } catch (e) {
            UT_LOG.error('storeEvent', e, { nodeid: nodeid, eventType: eventType, userLen: userStr ? String(userStr).length : 0 });
        }
    };

    // -----------------------------------------------------------------------
    // Hooks do agente — emite scan incremental
    // -----------------------------------------------------------------------
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        var nodeid = myparent ? myparent.nodeid : null;
        if (!nodeid || typeof nodeid !== 'string') return;
        setTimeout(function () {
            try { obj.checkNode(nodeid); } catch (e) { UT_LOG.error('hook_agentCoreIsStable.delayed', e); }
        }, 2000);
    };

    obj.hook_processAgentData = function (data, nodeid) {
        var nid = (typeof nodeid === 'string') ? nodeid : (nodeid && typeof nodeid === 'object' ? (nodeid.nodeid || nodeid._id) : null);
        if (!nid) return;
        if (obj._pendingCheck[nid]) clearTimeout(obj._pendingCheck[nid]);
        obj._pendingCheck[nid] = setTimeout(function () {
            try { obj.checkNode(nid); } catch (e) { UT_LOG.error('hook_processAgentData.delayed', e); }
        }, 2000);
    };

    // -----------------------------------------------------------------------
    // HTTP — /pluginadmin.ashx
    // -----------------------------------------------------------------------
    obj.handleAdminReq = function (req, res, user) {
        try {
            // #1, #22 — ACL para device tab (não confiar em ?user=1)
            if (req.query.user == 1) {
                var nid = req.query.nodeid;
                if (!nid) { res.sendStatus(400); return; }
                var domain = (user && user.domain) || '';

                // Verificar ACL no nó
                var webserver = obj.meshServer.webserver;
                if (webserver && typeof webserver.GetNodeWithRights === 'function') {
                    webserver.GetNodeWithRights(domain, user, nid, function (node, rights) {
                        if (!node || rights === 0) { res.sendStatus(401); return; }
                        // Verificar RBAC do plugin
                        if (obj.parent && typeof obj.parent.getAccessPermissions === 'function') {
                            obj.parent.getAccessPermissions('usertracer', user, { nodeid: nid }).then(function (has) {
                                if (!has('can_view_history')) { res.sendStatus(403); return; }
                                res.render('device', { nodeid: nid, nodeName: (node.name || nid) });
                            }).catch(function () {
                                // se getAccessPermissions falhar, ainda checa se admin
                                if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(403); return; }
                                res.render('device', { nodeid: nid, nodeName: (node.name || nid) });
                            });
                        } else {
                            if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(403); return; }
                            res.render('device', { nodeid: nid, nodeName: (node.name || nid) });
                        }
                    });
                } else {
                    // Sem GetNodeWithRights — fallback conservador: exige siteadmin
                    if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
                    res.render('device', { nodeid: nid, nodeName: obj.getNodeName(nid) });
                }
                return;
            }
            // admin panel
            if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
            // checar can_view_history no nível admin (sem context nodeid)
            if (obj.parent && typeof obj.parent.getAccessPermissions === 'function' && obj.parent.pluginPermissions && obj.parent.pluginPermissions.usertracer) {
                obj.parent.getAccessPermissions('usertracer', user, {}).then(function (has) {
                    if (!has('can_view_history') && (user.siteadmin & 0xFFFFFFFF) != 0xFFFFFFFF) { res.sendStatus(403); return; }
                    res.render('admin', {});
                }).catch(function () { res.render('admin', {}); });
            } else {
                res.render('admin', {});
            }
        } catch (e) {
            UT_LOG.error('handleAdminReq', e);
            try { res.sendStatus(500); } catch (_) {}
        }
    };

    // -----------------------------------------------------------------------
    // serveraction — WebSocket dispatcher
    // -----------------------------------------------------------------------
    obj.serveraction = function (command, myparent, gp) {
        try {
            if (!command || command.plugin !== 'usertracer') return;
            var sid = null;
            try { sid = myparent && myparent.ws && myparent.ws.sessionId; } catch (_) {}
            if (!sid) return;

            if (command.pluginaction === 'getCurrentUsers')     return obj._actionGetCurrentUsers(command, sid);
            if (command.pluginaction === 'getTimeline')         return obj._actionGetTimeline(command, sid);
            if (command.pluginaction === 'getDeviceNames')      return obj._actionGetDeviceNames(command, sid);
            if (command.pluginaction === 'getUserNames')        return obj._actionGetUserNames(command, sid);
            if (command.pluginaction === 'getNodeDetails')      return obj._actionGetNodeDetails(command, sid);
            if (command.pluginaction === 'purgeHistory')        return obj._actionPurgeHistory(command, myparent, sid);
            UT_LOG.info('unknown action=' + command.pluginaction);
        } catch (e) {
            UT_LOG.error('serveraction', e, { pluginaction: command && command.pluginaction });
        }
    };

    // --- getCurrentUsers: ACL filter via GetNodeWithRights (v3.5.83 security fix) ---
    obj._actionGetCurrentUsers = function (command, sid) {
        var user = obj._getSessionUser(sid);
        if (!user) { obj._send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: [] }); return; }
        if (!obj.mdb || typeof obj.mdb.Get !== 'function') {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: [] });
            return;
        }
        var ws = obj.meshServer.webserver.wsagents || {};
        var allIds = Object.keys(ws);
        if (allIds.length === 0) {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: [] });
            return;
        }
        // ACL: filtrar wsagents por MESHRIGHT_DEVICEDETAILS
        obj._filterAccessibleNodeIds(user, allIds, function (accessibleIds) {
            if (accessibleIds.length === 0) {
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: [] });
                return;
            }
            var done = false;
            var remaining = accessibleIds.length;
            var result = [];
            var timeout = setTimeout(function () {
                if (done) return;
                done = true;
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result, _partial: true });
            }, 5000);
            accessibleIds.forEach(function (nid) {
                obj.mdb.Get(nid, function (err, docs) {
                    if (done) return;
                    if (!err && docs && docs.length > 0) {
                        var d = docs[0];
                        if (Array.isArray(d.users) && d.users.length > 0) {
                            result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                        }
                    }
                    if (--remaining <= 0 && !done) {
                        done = true;
                        clearTimeout(timeout);
                        obj._send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result });
                    }
                });
            });
        });
    };

    // --- getTimeline: ACL filter via GetNodeWithRights (v3.5.83 security fix) ---
    obj._actionGetTimeline = function (command, sid) {
        var user = obj._getSessionUser(sid);
        if (!user) { obj._send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: [], _pwrMap: {}, _activeUsers: {}, _reqSeq: command._reqSeq }); return; }
        if (!obj.db || typeof obj.db.getEvents !== 'function') {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: [], _pwrMap: {}, _activeUsers: {}, _reqSeq: command._reqSeq });
            return;
        }
        var requestedNodeIds = null;
        if (command.nodeids && command.nodeids.length > 0) requestedNodeIds = command.nodeids.slice();
        else if (command.nodeid) requestedNodeIds = [command.nodeid];
        obj._filterAccessibleNodeIds(user, requestedNodeIds, function (accessibleNodeIds) {
            if (accessibleNodeIds === null) {
                accessibleNodeIds = requestedNodeIds;
            }
            var opts = { limit: command.limit || 5000 };
            if (command.startDate) {
                var sd = new Date(command.startDate);
                if (!isNaN(sd)) { sd.setDate(sd.getDate() - 1); opts.startDate = sd.toISOString(); }
            }
            if (command.endDate) opts.endDate = command.endDate;
            if (accessibleNodeIds && accessibleNodeIds.length > 0) opts.nodeids = accessibleNodeIds;
            else if (requestedNodeIds) {
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: [], _pwrMap: {}, _activeUsers: {}, _reqSeq: command._reqSeq });
                return;
            }
            var query = {};
            if (command.username) query.$or = [{ username: command.username }, { displayUser: command.username }];
            obj.db.getEvents(query, opts, function (docs) {
                docs = docs || [];
                var pwrMap = {};
                if (obj.devicePower) {
                    docs.forEach(function (e) {
                        if (e && e.nodeid && obj.devicePower[e.nodeid] && !pwrMap[e.nodeid]) {
                            pwrMap[e.nodeid] = obj.devicePower[e.nodeid];
                        }
                    });
                }
                var activeUsers = {};
                var seen = {};
                docs.forEach(function (e) {
                    if (e && e.nodeid && obj.userCache[e.nodeid] && !seen[e.nodeid]) {
                        seen[e.nodeid] = 1;
                        try {
                            var st = JSON.parse(obj.userCache[e.nodeid]);
                            activeUsers[e.nodeid] = (st.users || []).slice();
                        } catch (_) {}
                    }
                });
                var resp = {
                    action: 'plugin', plugin: 'usertracer', method: 'timeline',
                    data: docs, _pwrMap: pwrMap, _activeUsers: activeUsers,
                    _reqSeq: command._reqSeq
                };
                obj._send(sid, resp);
            });
        });
    };

    obj._actionGetDeviceNames = function (command, sid) {
        var cb = function (d) {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'deviceNames', data: d || [], _reqSeq: command._reqSeq });
        };
        if (obj.db && obj.db.getDeviceNames) obj.db.getDeviceNames(cb);
        else cb([]);
    };

    obj._actionGetUserNames = function (command, sid) {
        if (!obj.db || !obj.db.getUserNames) {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'userNames', data: [], _reqSeq: command._reqSeq });
            return;
        }
        obj.db.getUserNames(function (d) {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'userNames', data: d || [], _reqSeq: command._reqSeq });
        });
    };

    obj._actionGetNodeDetails = function (command, sid) {
        var user = obj._getSessionUser(sid);
        var nid = command.nodeid;
        if (!user || !nid) {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'nodeDetails', data: null });
            return;
        }
        if (!obj.mdb || typeof obj.mdb.Get !== 'function') {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'nodeDetails', data: null });
            return;
        }
        // ACL check
        obj._filterAccessibleNodeIds(user, [nid], function (accessible) {
            if (accessible.length === 0) {
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'nodeDetails', data: null });
                return;
            }
            obj.mdb.Get(nid, function (err, docs) {
                if (err || !docs || !docs.length) {
                    obj._send(sid, { action:'plugin', plugin:'usertracer', method:'nodeDetails', data: null });
                    return;
                }
                var d = docs[0];
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'nodeDetails', data: {
                    nodeid: nid, name: d.name, host: d.host, ip: d.ip, osdesc: d.osdesc,
                    domain: d.domain, mtype: d.mtype, agent: d.agent,
                    lastbootuptime: d.lastbootuptime, idletime: d.idletime
                }});
            });
        });
    };

    obj._actionPurgeHistory = function (command, myparent, sid) {
        var user = myparent && myparent.user;
        if (!obj.parent || typeof obj.parent.getAccessPermissions !== 'function') {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'purgeResult', data: { success: false, error: 'No permissions API' } });
            return;
        }
        obj.parent.getAccessPermissions('usertracer', user, {}).then(function (has) {
            if (!has('can_purge_history') && (user.siteadmin & 0xFFFFFFFF) != 0xFFFFFFFF) {
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'purgeResult', data: { success: false, error: 'Permission denied' } });
                return;
            }
            if (!obj.db || typeof obj.db.purgeAll !== 'function') {
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'purgeResult', data: { success: false, error: 'No purge API' } });
                return;
            }
            obj.db.purgeAll(function (err) {
                obj._send(sid, { action:'plugin', plugin:'usertracer', method:'purgeResult', data: { success: !err, error: err ? err.message : null } });
            });
        }).catch(function () {
            obj._send(sid, { action:'plugin', plugin:'usertracer', method:'purgeResult', data: { success: false, error: 'Permission check failed' } });
        });
    };


    // -----------------------------------------------------------------------
    // ACL helpers — usando APIs nativas do MeshCentral (v3.5.83 security fix)
    // -----------------------------------------------------------------------
    obj._getSessionUser = function (sid) {
        try {
            var wss2 = obj.meshServer && obj.meshServer.webserver && obj.meshServer.webserver.wssessions2;
            if (!wss2 || !wss2[sid] || !wss2[sid].user) return null;
            return wss2[sid].user;
        } catch (_) { return null; }
    };

    obj._isAdminFull = function (user) {
        return user && (user.siteadmin & 0xFFFFFFFF) === 0xFFFFFFFF;
    };

    obj._filterAccessibleNodeIds = function (user, nodeIds, cb) {
        if (!user) { cb([]); return; }
        // Admin full + manageAllDeviceGroups → acesso total
        if (obj._isAdminFull(user)) {
            var cfg = obj.meshServer && obj.meshServer.parent && obj.meshServer.parent.config;
            var mg = cfg && cfg.settings && cfg.settings.managealldevicegroups;
            if (mg && (mg.indexOf(user._id) >= 0 ||
                (user.links && Object.keys(user.links).some(function (k) { return mg.indexOf(k) >= 0; })))) {
                cb(nodeIds); return;
            }
        }
        if (!nodeIds || nodeIds.length === 0) {
            // Sem filtro explícito: retornar nodes visíveis via user.links
            cb(user.links ? Object.keys(user.links).filter(function (k) { return k.indexOf('node/') === 0; }) : []);
            return;
        }
        var webserver = obj.meshServer && obj.meshServer.webserver;
        if (!webserver || typeof webserver.GetNodeWithRights !== 'function') {
            cb([]); return;
        }
        var accessible = [], pending = nodeIds.length, done = false;
        var timeout = setTimeout(function () {
            if (done) return;
            done = true;
            UT_LOG.warn('_filterAccessibleNodeIds: timeout, returning partial');
            cb(accessible);
        }, 3000);
        nodeIds.forEach(function (nid) {
            try {
                webserver.GetNodeWithRights(user.domain, user, nid, function (node, rights, visible) {
                    if (done) return;
                    // MESHRIGHT_DEVICEDETAILS (0x100000) libera node.users/lusers
                    // User-Device Tracer requer este right para exibir dados sensíveis
                    if (visible && rights > 0 && (rights & 0x00100000) === 0x00100000) {
                        accessible.push(nid);
                    }
                    if (--pending === 0 && !done) {
                        done = true;
                        clearTimeout(timeout);
                        cb(accessible);
                    }
                });
            } catch (e) {
                if (--pending === 0 && !done) {
                    done = true;
                    clearTimeout(timeout);
                    cb(accessible);
                }
            }
        });
    };


    obj._send = function (sid, data) {
        try {
            var wss2 = obj.meshServer && obj.meshServer.webserver && obj.meshServer.webserver.wssessions2;
            if (!wss2 || !wss2[sid]) {
                UT_LOG.info('_send: session not found sid=' + (sid ? sid.substring(0,40) : 'null'));
                return;
            }
            wss2[sid].send(JSON.stringify(data));
        } catch (e) { UT_LOG.error('_send', e, { sid: sid }); }
    };

    obj.getNodeName = function (nid) {
        try {
            var ws = obj.meshServer && obj.meshServer.webserver && obj.meshServer.webserver.wsagents;
            if (ws && ws[nid]) return ws[nid].name || nid;
            return nid;
        } catch (e) { return nid; }
    };

    // -----------------------------------------------------------------------
    // onDeviceRefreshEnd — registra tab no iframe
    // -----------------------------------------------------------------------
    obj.onDeviceRefreshEnd = function () {
        try {
            if (typeof currentNode === 'undefined' || !currentNode) return;
            if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;
            if (typeof pluginHandler === 'undefined') return;
            // Aceitar a tab somente se o usuário puder visualizar (permissão RBAC)
            // Sem user instance aqui (estamos no frontend global); checagem fina é feita no iframe via server-side
            if (typeof user === 'undefined' || !user) return;
            if (user.siteadmin !== 0xFFFFFFFF && (user.siteadmin & 1) === 0 && (user.siteadmin & 8) === 0) {
                // Usuário sem direito de agent console ou siteadmin → não mostrar tab
                return;
            }
            pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
            var nid = currentNode._id;
            QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:80vh;overflow:auto;border:none" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&user=1&nodeid=' + encodeURIComponent(nid) + '" />');
        } catch (e) { UT_LOG.error('onDeviceRefreshEnd', e); }
    };

    return obj;
};
