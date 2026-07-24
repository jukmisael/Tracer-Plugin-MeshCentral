/**
 * User-Device Tracer — v3.2 FULL DEBUG
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.db = null;
    obj.mdb = obj.meshServer.db;
    obj.scanTimer = null;
    obj.SCAN_INTERVAL = 30000;
    obj.userCache = {};

    console.log('=== UT DEBUG: module loaded ===');
    console.log('UT DEBUG: parent.type=' + typeof parent);
    console.log('UT DEBUG: meshServer.type=' + typeof obj.meshServer);
    console.log('UT DEBUG: mdb.type=' + typeof obj.mdb + ' mdb.Get=' + (typeof obj.mdb.Get));
    console.log('UT DEBUG: webserver=' + (obj.meshServer.webserver ? 'present' : 'null'));
    console.log('UT DEBUG: wsagents=' + (obj.meshServer.webserver && obj.meshServer.webserver.wsagents ? Object.keys(obj.meshServer.webserver.wsagents).length + ' keys' : 'null'));
    console.log('UT DEBUG: wssessions2=' + (obj.meshServer.webserver && obj.meshServer.webserver.wssessions2 ? Object.keys(obj.meshServer.webserver.wssessions2).length + ' keys' : 'null'));

    obj.server_startup = function () {
        console.log('=== UT STARTUP ===');
        console.log('UT STARTUP: calling db.CreateDB...');
        obj.meshServer.pluginHandler.usertracer_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.usertracer_db;
        console.log('UT STARTUP: db.events=' + (obj.db && obj.db.events ? 'created' : 'FAIL'));
        console.log('UT STARTUP: db.addEvent=' + (typeof obj.db.addEvent));
        console.log('UT STARTUP: db.getEvents=' + (typeof obj.db.getEvents));
        console.log('UT STARTUP: db.getEventsByNode=' + (typeof obj.db.getEventsByNode));
        obj.startScanner();
        console.log('=== UT STARTUP DONE ===');
    };

    obj.startScanner = function () {
        console.log('UT SCANNER: starting, calling scanNow...');
        obj.scanNow();
        obj.scanTimer = setInterval(obj.scanNow, obj.SCAN_INTERVAL);
        console.log('UT SCANNER: timer set interval=' + obj.SCAN_INTERVAL + 'ms');
    };

    obj.scanNow = function () {
        console.log('=== UT SCAN: START ===');
        console.log('UT SCAN: timestamp=' + new Date().toISOString());
        try {
            var ws = obj.meshServer.webserver.wsagents || {};
            var agentIds = Object.keys(ws);
            console.log('UT SCAN: wsagents count=' + agentIds.length);
            console.log('UT SCAN: agentIds=' + JSON.stringify(agentIds.map(function(s){return s.substring(0,30);})));
            for (var i = 0; i < agentIds.length; i++) {
                obj.checkNode(agentIds[i]);
            }
        } catch (e) {
            console.log('UT SCAN ERROR: ' + e.message + ' stack=' + e.stack);
        }
        console.log('=== UT SCAN: END ===');
    };

    obj.checkNode = function (nodeid) {
        console.log('UT CHECKNODE: entry nodeid=' + (nodeid ? nodeid.substring(0, 40) : 'null'));
        var tStart = Date.now();
        obj.mdb.Get(nodeid, function (err, docs) {
            var tElapsed = Date.now() - tStart;
            console.log('UT CHECKNODE: callback after ' + tElapsed + 'ms');
            console.log('UT CHECKNODE: err=' + (err ? err.message : 'null') + ' docs=' + (docs ? docs.length : 'null'));
            try {
                if (err || !docs || docs.length === 0) {
                    console.log('UT CHECKNODE: no docs, returning');
                    return;
                }
                var doc = docs[0];
                console.log('UT CHECKNODE: doc.id=' + (doc._id || '').substring(0, 30));
                console.log('UT CHECKNODE: doc.name=' + doc.name);
                console.log('UT CHECKNODE: doc.users RAW=' + JSON.stringify(doc.users));
                console.log('UT CHECKNODE: doc.lusers RAW=' + JSON.stringify(doc.lusers));
                console.log('UT CHECKNODE: doc.keys=' + Object.keys(doc).sort().join(','));

                var currentUsers = (Array.isArray(doc.users) ? doc.users : []).sort();
                var key = JSON.stringify(currentUsers);
                var prev = obj.userCache[nodeid];
                var nodeName = doc.name || nodeid;

                console.log('UT CHECKNODE: currentUsers=' + JSON.stringify(currentUsers));
                console.log('UT CHECKNODE: cache prev=' + (prev ? prev.substring(0, 100) : 'null'));
                console.log('UT CHECKNODE: cache key=' + key.substring(0, 100));

                if (!prev) {
                    console.log('UT CHECKNODE: FIRST TIME for node, populating cache');
                    obj.userCache[nodeid] = key;
                    // Check DB for existing events
                    console.log('UT CHECKNODE: checking DB for existing events...');
                    obj.db.getEventsByNode(nodeid, { limit: 1 }, function(events) {
                        console.log('UT CHECKNODE: DB events found=' + (events ? events.length : 0));
                        if (!events || events.length === 0) {
                            console.log('UT CHECKNODE: FIRST EVER - logging ' + currentUsers.length + ' initial logins');
                            currentUsers.forEach(function (u) {
                                console.log('UT CHECKNODE: initial LOGIN ' + u);
                                obj.storeEvent(nodeid, nodeName, u, 'userLogin');
                            });
                        } else {
                            console.log('UT CHECKNODE: DB already has events, skipping initial logins');
                        }
                        console.log('UT CHECKNODE: first-time done for ' + nodeName);
                    });
                    console.log('UT CHECKNODE: returning after first-time setup');
                    return;
                }

                if (prev === key) {
                    console.log('UT CHECKNODE: no change for ' + nodeName);
                    return;
                }

                // CHANGE DETECTED
                console.log('UT CHECKNODE: *** CHANGE DETECTED for ' + nodeName + ' ***');
                console.log('UT CHECKNODE: old=' + prev);
                console.log('UT CHECKNODE: new=' + key);
                obj.userCache[nodeid] = key;
                var prevUsers = JSON.parse(prev);

                currentUsers.forEach(function (u) {
                    if (prevUsers.indexOf(u) === -1) {
                        console.log('UT CHECKNODE: >>> LOGIN ' + u + ' on ' + nodeName);
                        obj.storeEvent(nodeid, nodeName, u, 'userLogin');
                    }
                });
                prevUsers.forEach(function (u) {
                    if (currentUsers.indexOf(u) === -1) {
                        console.log('UT CHECKNODE: >>> LOGOUT ' + u + ' from ' + nodeName);
                        obj.storeEvent(nodeid, nodeName, u, 'userLogout');
                    }
                });
            } catch (e) {
                console.log('UT CHECKNODE ERROR: ' + e.message + ' stack=' + e.stack);
            }
        });
    };

    obj.storeEvent = function (nodeid, nodeName, userStr, eventType) {
        console.log('UT STOREEVENT: entry node=' + nodeName + ' user=' + userStr + ' type=' + eventType);
        if (!obj.db || !obj.db.addEvent) {
            console.log('UT STOREEVENT: FAIL - db.addEvent not available');
            return;
        }
        var username = userStr;
        var domain = '';
        if (userStr.indexOf('\\') >= 0) { domain = userStr.split('\\')[0]; username = userStr.split('\\')[1]; }
        else if (userStr.indexOf('@') >= 0) { domain = userStr.split('@')[1]; username = userStr.split('@')[0]; }
        var evt = {
            nodeid: nodeid,
            nodeName: nodeName,
            username: username,
            domain: domain,
            displayUser: userStr,
            eventType: eventType,
            detectedAt: new Date().toISOString()
        };
        console.log('UT STOREEVENT: inserting=' + JSON.stringify(evt));
        obj.db.addEvent(evt);
        console.log('UT STOREEVENT: done');
    };

    obj.hook_agentCoreIsStable = function (myparent, gp) {
        var nodeid = myparent ? myparent.nodeid : null;
        console.log('=== UT HOOK: agentCoreIsStable ===');
        console.log('UT HOOK: nodeid=' + (nodeid ? nodeid.substring(0, 40) : 'null'));
        console.log('UT HOOK: myparent.type=' + typeof myparent);
        console.log('UT HOOK: myparent.keys=' + (myparent ? Object.keys(myparent).sort().join(',') : 'null'));
        if (myparent && myparent.agentInfo) {
            console.log('UT HOOK: agentInfo=' + JSON.stringify(myparent.agentInfo));
        }
        if (nodeid) {
            console.log('UT HOOK: scheduling checkNode in 2s');
            setTimeout(function () {
                console.log('UT HOOK: 2s elapsed, calling checkNode for ' + nodeid.substring(0, 40));
                obj.checkNode(nodeid);
            }, 2000);
        }
        console.log('=== UT HOOK END ===');
    };

    obj.hook_processAgentData = function (data, nodeid) {
        console.log('UT HOOKDATA: entry nodeid=' + (nodeid ? nodeid.substring(0, 30) : 'null'));
        console.log('UT HOOKDATA: data.type=' + typeof data);
        if (data && typeof data === 'object') {
            console.log('UT HOOKDATA: data.action=' + data.action + ' data.plugin=' + data.plugin);
        }
        if (!nodeid) return;
        if (obj._pendingCheck && obj._pendingCheck[nodeid]) {
            console.log('UT HOOKDATA: clearing existing pending check for ' + nodeid.substring(0, 30));
            clearTimeout(obj._pendingCheck[nodeid]);
        }
        if (!obj._pendingCheck) obj._pendingCheck = {};
        obj._pendingCheck[nodeid] = setTimeout(function () {
            console.log('UT HOOKDATA: debounce expired, calling checkNode for ' + nodeid.substring(0, 30));
            obj.checkNode(nodeid);
            delete obj._pendingCheck[nodeid];
        }, 2000);
        console.log('UT HOOKDATA: scheduled check in 2s');
    };

    obj.handleAdminReq = function (req, res, user) {
        console.log('=== UT HTTP ===');
        console.log('UT HTTP: url=' + req.url);
        console.log('UT HTTP: query=' + JSON.stringify(req.query));
        console.log('UT HTTP: user=' + (user ? user.name : 'null'));
        console.log('UT HTTP: user.siteadmin=' + (user ? user.siteadmin : 'null'));
        console.log('UT HTTP: user._id=' + (user ? user._id : 'null'));
        console.log('UT HTTP: req.session=' + (req.session ? 'present' : 'null'));
        if (req.query.user == 1) {
            console.log('UT HTTP: rendering device tab, nodeid=' + req.query.nodeid);
            return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' });
        }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
            console.log('UT HTTP: 401 UNAUTHORIZED');
            res.sendStatus(401);
            return;
        }
        console.log('UT HTTP: rendering admin panel');
        res.render('admin', {});
        console.log('=== UT HTTP DONE ===');
    };

    obj.serveraction = function (command, myparent, gp) {
        console.log('=== UT SERVERACTION ===');
        console.log('UT CMD: RAW command=' + JSON.stringify(command).substring(0, 500));
        console.log('UT CMD: action=' + command.pluginaction);
        console.log('UT CMD: plugin=' + command.plugin);
        console.log('UT CMD: nodeid=' + (command.nodeid ? command.nodeid.substring(0, 30) : 'null'));
        console.log('UT CMD: limit=' + command.limit);

        if (command.plugin !== 'usertracer') {
            console.log('UT CMD: wrong plugin, ignoring');
            return;
        }
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {
            console.log('UT CMD: failed to get sessionId: ' + e.message);
        }
        console.log('UT CMD: sid=' + (sid ? sid.substring(0, 40) : 'null'));
        console.log('UT CMD: myparent.type=' + typeof myparent);
        console.log('UT CMD: myparent.keys=' + (myparent ? Object.keys(myparent).sort().join(',').substring(0, 200) : 'null'));
        if (!sid) { console.log('UT CMD: no sid, returning'); return; }

        // --- getCurrentUsers ---
        if (command.pluginaction === 'getCurrentUsers') {
            console.log('=== UT CMD: getCurrentUsers ===');
            var result = [];
            var ws = obj.meshServer.webserver.wsagents || {};
            var ids = Object.keys(ws);
            console.log('UT CMD: wsagents keys=' + ids.length);
            console.log('UT CMD: wsagents ids=' + JSON.stringify(ids.map(function(s){return s.substring(0,20);})));

            if (ids.length === 0) {
                console.log('UT CMD: no agents, sending empty');
                obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result });
                console.log('=== UT CMD END ===');
                return;
            }

            var pending = ids.length;
            ids.forEach(function (nid) {
                console.log('UT CMD: db.Get(' + nid.substring(0, 40) + '...)');
                obj.mdb.Get(nid, function (err, docs) {
                    console.log('UT CMD: db.Get callback for ' + nid.substring(0, 30));
                    console.log('UT CMD: err=' + (err ? err.message : 'null') + ' docs=' + (docs ? docs.length : 'null'));
                    if (!err && docs && docs.length > 0) {
                        var d = docs[0];
                        console.log('UT CMD: doc.name=' + d.name + ' doc.users=' + JSON.stringify(d.users));
                        if (Array.isArray(d.users) && d.users.length > 0) {
                            result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                            console.log('UT CMD: added to result: ' + d.name + ' -> ' + JSON.stringify(d.users));
                        } else {
                            console.log('UT CMD: no users for ' + d.name);
                        }
                    } else {
                        console.log('UT CMD: no docs for ' + nid.substring(0, 30));
                    }
                    pending--;
                    console.log('UT CMD: pending=' + pending + ' result.length=' + result.length);
                    if (pending <= 0) {
                        console.log('UT CMD: ALL DONE, sending result JSON=' + JSON.stringify(result).substring(0, 500));
                        obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result });
                        console.log('=== UT CMD END ===');
                    }
                });
            });
            return;
        }

        // --- getTimeline ---
        if (command.pluginaction === 'getTimeline') {
            console.log('=== UT CMD: getTimeline ===');
            console.log('UT CMD: nodeid=' + (command.nodeid ? command.nodeid.substring(0, 30) : 'null'));
            console.log('UT CMD: startDate=' + command.startDate + ' endDate=' + command.endDate);
            console.log('UT CMD: nodeids=' + (command.nodeids ? JSON.stringify(command.nodeids).substring(0, 100) : 'null'));
            console.log('UT CMD: limit=' + command.limit);

            if (!obj.db || !obj.db.getEvents) {
                obj.send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: [] });
                return;
            }

            var opts = { limit: command.limit || 5000 };
            if (command.startDate) opts.startDate = command.startDate;
            if (command.endDate) opts.endDate = command.endDate;
            if (command.nodeids && command.nodeids.length > 0) opts.nodeids = command.nodeids;
            else if (command.nodeid) opts.nodeids = [command.nodeid];

            obj.db.getEvents({}, opts, function (docs) {
                obj.send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: docs || [] });
            });
            return;
        }

        // --- getDeviceNames ---
        if (command.pluginaction === 'getDeviceNames') {
            if (obj.db && obj.db.getDeviceNames) {
                obj.db.getDeviceNames(function(d) {
                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'deviceNames', data: d || [] });
                });
            } else {
                obj.send(sid, { action:'plugin', plugin:'usertracer', method:'deviceNames', data: [] });
            }
            return;
        }

        console.log('UT CMD: unknown action=' + command.pluginaction);
        console.log('=== UT CMD END ===');
    };

    obj.getNodeName = function (nid) {
        try { return obj.meshServer.webserver.wsagents[nid].name || nid; } catch (e) { return nid; }
    };

    obj.send = function (sid, data) {
        console.log('=== UT SEND ===');
        console.log('UT SEND: sid=' + (sid ? sid.substring(0, 40) : 'null'));
        console.log('UT SEND: data.method=' + data.method);
        console.log('UT SEND: data.data type=' + (data.data ? (Array.isArray(data.data) ? 'array[' + data.data.length + ']' : typeof data.data) : 'undefined'));
        console.log('UT SEND: data JSON=' + JSON.stringify(data).substring(0, 500));
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) {
                console.log('UT SEND: session found, sending...');
                obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data));
                console.log('UT SEND: OK');
            } else {
                console.log('UT SEND: session NOT FOUND in wssessions2');
                console.log('UT SEND: wssessions2 keys=' + Object.keys(obj.meshServer.webserver.wssessions2 || {}).length);
            }
        } catch (e) {
            console.log('UT SEND: EXCEPTION: ' + e.message + ' stack=' + e.stack);
        }
        console.log('=== UT SEND END ===');
    };

    obj.onDeviceRefreshEnd = function () {
        console.log('=== UT DEVICETAB ===');
        console.log('UT DEVICETAB: called');
        if (typeof currentNode === 'undefined' || !currentNode) {
            console.log('UT DEVICETAB: no currentNode, returning');
            return;
        }
        console.log('UT DEVICETAB: currentNode._id=' + (currentNode._id ? currentNode._id.substring(0, 30) : 'null'));
        console.log('UT DEVICETAB: currentNode.name=' + currentNode.name);
        console.log('UT DEVICETAB: currentNode.osdesc=' + currentNode.osdesc);
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) {
            console.log('UT DEVICETAB: not Windows, skipping tab');
            return;
        }
        console.log('UT DEVICETAB: registering tab...');
        pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
        QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
        console.log('UT DEVICETAB: tab registered and iframe created');
        console.log('=== UT DEVICETAB END ===');
    };

    return obj;
};
