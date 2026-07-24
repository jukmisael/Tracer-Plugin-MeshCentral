/**
 * User-Device Tracer — v3.2
 * Rastreia usuários ativos + timeline de login/logout persistente.
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.db = null;           // db.js (plugin events)
    obj.mdb = obj.meshServer.db;  // MeshCentral DB
    obj.scanTimer = null;
    obj.SCAN_INTERVAL = 30000; // 30s
    obj.userCache = {}; // { nodeid: JSON.stringify([users]) }

    console.log('UT INIT: usertracer v3.2 loaded');

    // -----------------------------------------------------------------------
    // Server startup — init DB + start scanner
    // -----------------------------------------------------------------------
    obj.server_startup = function () {
        console.log('UT STARTUP: initializing DB...');
        obj.meshServer.pluginHandler.usertracer_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.usertracer_db;
        console.log('UT STARTUP: DB ready, starting scanner');
        obj.startScanner();
    };

    // -----------------------------------------------------------------------
    // Periodic scanner — detect user changes across all agents
    // -----------------------------------------------------------------------
    obj.startScanner = function () {
        obj.scanNow();
        obj.scanTimer = setInterval(obj.scanNow, obj.SCAN_INTERVAL);
        console.log('UT SCANNER: started (interval=' + obj.SCAN_INTERVAL + 'ms)');
    };

    obj.scanNow = function () {
        try {
            var ws = obj.meshServer.webserver.wsagents || {};
            for (var nid in ws) {
                obj.checkNode(nid);
            }
        } catch (e) {
            console.log('UT SCAN: error: ' + e.message);
        }
    };

    obj.checkNode = function (nodeid) {
        obj.mdb.Get(nodeid, function (err, docs) {
            try {
                if (err || !docs || docs.length === 0) return;
                var doc = docs[0];
                var currentUsers = (Array.isArray(doc.users) ? doc.users : []).sort();
                var key = JSON.stringify(currentUsers);
                var prev = obj.userCache[nodeid];

                if (prev === key) return; // no change

                obj.userCache[nodeid] = key;
                var nodeName = doc.name || nodeid;

                if (!prev) {
                    // First time: log all current users
                    console.log('UT SCAN: initial users for ' + nodeName + ': ' + JSON.stringify(currentUsers));
                    currentUsers.forEach(function (u) { obj.storeEvent(nodeid, nodeName, u, 'userLogin'); });
                } else {
                    var prevUsers = JSON.parse(prev);
                    // Logins: in current but not in prev
                    currentUsers.forEach(function (u) {
                        if (prevUsers.indexOf(u) === -1) {
                            console.log('UT SCAN: LOGIN ' + u + ' on ' + nodeName);
                            obj.storeEvent(nodeid, nodeName, u, 'userLogin');
                        }
                    });
                    // Logouts: in prev but not in current
                    prevUsers.forEach(function (u) {
                        if (currentUsers.indexOf(u) === -1) {
                            console.log('UT SCAN: LOGOUT ' + u + ' from ' + nodeName);
                            obj.storeEvent(nodeid, nodeName, u, 'userLogout');
                        }
                    });
                }
            } catch (e) {
                console.log('UT SCAN: checkNode error: ' + e.message);
            }
        });
    };

    obj.storeEvent = function (nodeid, nodeName, userStr, eventType) {
        if (!obj.db || !obj.db.addEvent) return;
        var username = userStr;
        var domain = '';
        if (userStr.indexOf('\\') >= 0) { domain = userStr.split('\\')[0]; username = userStr.split('\\')[1]; }
        else if (userStr.indexOf('@') >= 0) { domain = userStr.split('@')[1]; username = userStr.split('@')[0]; }
        obj.db.addEvent({
            nodeid: nodeid,
            nodeName: nodeName,
            username: username,
            domain: domain,
            displayUser: userStr,
            eventType: eventType,
            detectedAt: new Date().toISOString()
        });
    };

    // -----------------------------------------------------------------------
    // Hook: agent connected — check immediately
    // -----------------------------------------------------------------------
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        var nodeid = myparent ? myparent.nodeid : null;
        if (nodeid) {
            console.log('UT HOOK: agentCoreIsStable ' + nodeid.substring(0, 40) + '...');
            setTimeout(function () { obj.checkNode(nodeid); }, 2000);
        }
    };

    // -----------------------------------------------------------------------
    // Hook: agent data received — check for user changes
    // -----------------------------------------------------------------------
    obj.hook_processAgentData = function (data, nodeid) {
        if (!nodeid) return;
        // Debounce: schedule check after 2s
        if (obj._pendingCheck && obj._pendingCheck[nodeid]) clearTimeout(obj._pendingCheck[nodeid]);
        if (!obj._pendingCheck) obj._pendingCheck = {};
        obj._pendingCheck[nodeid] = setTimeout(function () {
            obj.checkNode(nodeid);
            delete obj._pendingCheck[nodeid];
        }, 2000);
    };

    // -----------------------------------------------------------------------
    // HTTP: admin panel & device tab
    // -----------------------------------------------------------------------
    obj.handleAdminReq = function (req, res, user) {
        console.log('UT HTTP: user=' + (user ? user.name : 'null'));
        if (req.query.user == 1) {
            return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' });
        }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    // -----------------------------------------------------------------------
    // WebSocket commands
    // -----------------------------------------------------------------------
    obj.serveraction = function (command, myparent, gp) {
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        if (!sid) return;
        console.log('UT CMD: ' + command.pluginaction + ' sid=' + sid.substring(0, 30) + '...');

        if (command.pluginaction === 'getCurrentUsers') {
            // Current users from MeshCentral DB (same as before)
            var result = [];
            var ws = obj.meshServer.webserver.wsagents || {};
            var ids = Object.keys(ws);
            if (ids.length === 0) { obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result }); return; }

            var pending = ids.length;
            ids.forEach(function (nid) {
                obj.mdb.Get(nid, function (err, docs) {
                    if (!err && docs && docs.length > 0) {
                        var d = docs[0];
                        if (Array.isArray(d.users) && d.users.length > 0) {
                            result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                        }
                    }
                    pending--;
                    if (pending <= 0) {
                        obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result });
                    }
                });
            });
            return;
        }

        if (command.pluginaction === 'getTimeline') {
            // Timeline from plugin DB
            if (!obj.db || !obj.db.getEventsByNode) { obj.send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: [] }); return; }

            if (command.nodeid) {
                // Timeline for specific device
                obj.db.getEventsByNode(command.nodeid, command.limit || 200, function (docs) {
                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: docs || [] });
                });
            } else {
                // Timeline all devices
                obj.db.getEvents({}, command.limit || 500, function (docs) {
                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: docs || [] });
                });
            }
            return;
        }

        if (command.pluginaction === 'scanNow') {
            obj.scanNow();
            obj.send(sid, { action:'plugin', plugin:'usertracer', method:'scanDone', data: { status: 'ok' } });
            return;
        }
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    obj.getNodeName = function (nid) {
        try { return obj.meshServer.webserver.wsagents[nid].name || nid; } catch (e) { return nid; }
    };

    obj.send = function (sid, data) {
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid])
                obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data));
        } catch (e) {}
    };

    // -----------------------------------------------------------------------
    // Device tab
    // -----------------------------------------------------------------------
    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;
        pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
        QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
    };

    return obj;
};
