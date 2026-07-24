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
    // -----------------------------------------------------------------------
    // Error helper — logs raw error, stack, and context
    // -----------------------------------------------------------------------
    function utError(context, err, extra) {
        console.log('UT ERROR: context=' + context);
        console.log('UT ERROR: type=' + (typeof err) + (err && err.constructor ? ' constructor=' + err.constructor.name : ''));
        console.log('UT ERROR: message=' + (err && err.message ? err.message : String(err)));
        console.log('UT ERROR: stack=' + (err && err.stack ? err.stack : '(no stack)'));
        if (extra) console.log('UT ERROR: extra=' + JSON.stringify(extra));
        try { console.log('UT ERROR: err.raw=' + JSON.stringify(err).substring(0, 400)); } catch (e2) {}
        try { console.dir(err); } catch(e2) {}
    }

    console.log('=== UT DEBUG: module loaded ===');
    console.log('UT DEBUG: parent.type=' + typeof parent);
    console.log('UT DEBUG: meshServer.type=' + typeof obj.meshServer);
    console.log('UT DEBUG: mdb.type=' + typeof obj.mdb + ' mdb.Get=' + (typeof obj.mdb.Get));
    console.log('UT DEBUG: webserver=' + (obj.meshServer.webserver ? 'present' : 'null'));
    console.log('UT DEBUG: wsagents=' + (obj.meshServer.webserver && obj.meshServer.webserver.wsagents ? Object.keys(obj.meshServer.webserver.wsagents).length + ' keys' : 'null'));
    console.log('UT DEBUG: wssessions2=' + (obj.meshServer.webserver && obj.meshServer.webserver.wssessions2 ? Object.keys(obj.meshServer.webserver.wssessions2).length + ' keys' : 'null'));

    obj.server_startup = function () {
        try {
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
        } catch (e) {
            utError('server_startup', e, { step: 'db init + scanner start' });
        }
    };

    obj.startScanner = function () {
        try {
            console.log('UT SCANNER: starting, calling scanNow...');
            obj.scanNow();
            obj.scanTimer = setInterval(obj.scanNow, obj.SCAN_INTERVAL);
            console.log('UT SCANNER: timer set interval=' + obj.SCAN_INTERVAL + 'ms');
        } catch (e) {
            utError('startScanner', e, { SCAN_INTERVAL: obj.SCAN_INTERVAL });
        }
    };

    obj.scanNow = function () {
        console.log('=== UT SCAN: START ===');
        console.log('UT SCAN: timestamp=' + new Date().toISOString());
        try {
            var ws = obj.meshServer.webserver.wsagents;
            if (!ws) {
                console.log('UT SCAN: FATAL — wsagents is null. meshServer.webserver keys=' + Object.keys(obj.meshServer.webserver).sort().join(','));
                return;
            }
            var agentIds = Object.keys(ws);
            console.log('UT SCAN: wsagents count=' + agentIds.length);
            console.log('UT SCAN: agentIds=' + JSON.stringify(agentIds.map(function(s){return s.substring(0,30);})));
            for (var i = 0; i < agentIds.length; i++) {
                if (!agentIds[i]) {
                    console.log('UT SCAN: null agentId at index ' + i + ' raw=' + agentIds[i]);
                    continue;
                }
                obj.checkNode(agentIds[i]);
            }
        } catch (e) {
            utError('scanNow', e, { wsagents: typeof obj.meshServer.webserver.wsagents });
        }
        console.log('=== UT SCAN: END ===');
    };

    obj.checkNode = function (nodeid) {
        var tStart = Date.now();
        if (!nodeid) {
            console.log('UT CHECKNODE: null nodeid — full args=' + JSON.stringify(Array.prototype.slice.call(arguments)));
            return;
        }
        console.log('UT CHECKNODE: entry nodeid=' + (typeof nodeid === 'string' ? nodeid.substring(0, 40) : 'type=' + typeof nodeid + ' raw=' + JSON.stringify(nodeid)));
        if (typeof nodeid !== 'string') {
            console.log('UT CHECKNODE: nodeid not string, skipping — typeof=' + typeof nodeid);
            return;
        }
        if (!obj.mdb || typeof obj.mdb.Get !== 'function') {
            console.log('UT CHECKNODE: FATAL — mdb.Get not available. mdb=' + typeof obj.mdb + ' typeof Get=' + (obj.mdb ? typeof obj.mdb.Get : 'N/A'));
            return;
        }
        obj.mdb.Get(nodeid, function (err, docs) {
            try {
                var tElapsed = Date.now() - tStart;
                console.log('UT CHECKNODE: callback after ' + tElapsed + 'ms');
                if (err) {
                    console.log('UT CHECKNODE: err message=' + err.message + ' raw=' + JSON.stringify(err));
                    return;
                }
                if (!docs || docs.length === 0) {
                    console.log('UT CHECKNODE: no docs for nodeid=' + (nodeid ? nodeid.substring(0, 40) : 'null') + ' docs raw=' + JSON.stringify(docs));
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
                    console.log('UT CHECKNODE: checking DB for existing events...');
                    if (!obj.db || typeof obj.db.getEventsByNode !== 'function') {
                        console.log('UT CHECKNODE: db.getEventsByNode not available, skipping initial logins');
                        return;
                    }
                    obj.db.getEventsByNode(nodeid, { limit: 1 }, function(events) {
                        console.log('UT CHECKNODE: DB events found=' + (events ? events.length : 0));
                        if (events != null && events.length > 0) {
                            console.log('UT CHECKNODE: DB already has ' + events.length + ' events, skipping initial logins');
                        } else {
                            console.log('UT CHECKNODE: FIRST EVER - logging ' + currentUsers.length + ' initial logins');
                            currentUsers.forEach(function (u) {
                                console.log('UT CHECKNODE: initial LOGIN ' + u);
                                obj.storeEvent(nodeid, nodeName, u, 'userLogin');
                            });
                        }
                        console.log('UT CHECKNODE: first-time done for ' + nodeName);
                    });
                    return;
                }

                if (prev === key) {
                    console.log('UT CHECKNODE: no change for ' + nodeName);
                    return;
                }

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
                utError('checkNode_callback', e, { nodeid: nodeid, nodeName: typeof doc !== 'undefined' ? doc.name : 'N/A' });
            }
        });
    };

    obj.storeEvent = function (nodeid, nodeName, userStr, eventType) {
        try {
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
        } catch (e) {
            utError('storeEvent', e, { nodeid: nodeid, nodeName: nodeName, userStr: userStr, eventType: eventType });
        }
    };

    obj.hook_agentCoreIsStable = function (myparent, gp) {
        try {
            var nodeid = myparent ? myparent.nodeid : null;
            console.log('=== UT HOOK: agentCoreIsStable ===');
            console.log('UT HOOK: nodeid=' + (typeof nodeid === 'string' ? nodeid.substring(0, 40) : JSON.stringify(nodeid)));
            console.log('UT HOOK: myparent.type=' + typeof myparent);
            console.log('UT HOOK: myparent.keys=' + (myparent ? Object.keys(myparent).sort().join(',') : 'null'));
            if (myparent && myparent.agentInfo) {
                console.log('UT HOOK: agentInfo=' + JSON.stringify(myparent.agentInfo));
            }
            if (nodeid && typeof nodeid === 'string') {
                console.log('UT HOOK: scheduling checkNode in 2s');
                setTimeout(function () {
                    try {
                        console.log('UT HOOK: 2s elapsed, calling checkNode for ' + nodeid.substring(0, 40));
                        obj.checkNode(nodeid);
                    } catch (e) { utError('hook_agentCoreIsStable_delayed', e, { nodeid: nodeid }); }
                }, 2000);
            }
            console.log('=== UT HOOK END ===');
        } catch (e) {
            utError('hook_agentCoreIsStable', e, { myparent_type: typeof myparent });
        }
    };

    obj.hook_processAgentData = function (data, nodeid) {
        try {
            var nid = (typeof nodeid === 'string') ? nodeid : (nodeid && typeof nodeid === 'object' ? nodeid.nodeid || nodeid._id : null);
            console.log('UT HOOKDATA: entry nodeid=' + nid);
            console.log('UT HOOKDATA: data.type=' + typeof data + ' data.keys=' + (data && typeof data === 'object' ? Object.keys(data).sort().join(',') : 'N/A'));
            if (data && typeof data === 'object') {
                console.log('UT HOOKDATA: data.action=' + data.action + ' data.plugin=' + data.plugin + ' data.nodeid=' + data.nodeid);
                console.log('UT HOOKDATA: data.raw=' + JSON.stringify(data).substring(0, 400));
            }
            if (!nid) {
                console.log('UT HOOKDATA: WARN - no nodeid resolved. nodeid param=' + (typeof nodeid) + ' raw=' + JSON.stringify(nodeid) + ' data.nodeid=' + (data ? data.nodeid : 'N/A'));
                return;
            }
            if (obj._pendingCheck && obj._pendingCheck[nid]) {
                console.log('UT HOOKDATA: clearing existing pending check for ' + nid);
                clearTimeout(obj._pendingCheck[nid]);
            }
            if (!obj._pendingCheck) obj._pendingCheck = {};
            obj._pendingCheck[nid] = setTimeout(function () {
                try {
                    console.log('UT HOOKDATA: debounce expired, calling checkNode for ' + nid);
                    obj.checkNode(nid);
                } catch (e) { utError('hook_processAgentData_delayed', e, { nid: nid }); }
            }, 2000);
            console.log('UT HOOKDATA: scheduled check in 2s');
        } catch (e) {
            utError('hook_processAgentData', e, { data_type: typeof data, nodeid_type: typeof nodeid, nodeid_raw: nodeid });
        }
    };

    obj.handleAdminReq = function (req, res, user) {
        try {
            console.log('=== UT HTTP ===');
            console.log('UT HTTP: url=' + req.url);
            console.log('UT HTTP: query=' + JSON.stringify(req.query));
            if (user) {
                console.log('UT HTTP: user.name=' + user.name + ' user.siteadmin=' + user.siteadmin + ' user._id=' + user._id);
            } else {
                console.log('UT HTTP: user=NULL — raw=' + JSON.stringify(user) + ' typeof=' + typeof user);
            }
            console.log('UT HTTP: req.session=' + (req.session ? 'present' : 'null'));
            if (!req.session) {
                console.log('UT HTTP: req.session RAW=' + JSON.stringify(req.session) + ' req.keys=' + Object.keys(req).sort().join(','));
            }
            if (req.query.user == 1) {
                console.log('UT HTTP: rendering device tab, nodeid=' + req.query.nodeid);
                return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' });
            }
            if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
                console.log('UT HTTP: 401 UNAUTHORIZED — user=' + JSON.stringify(user) + ' siteadmin=' + (user ? user.siteadmin : 'N/A'));
                res.sendStatus(401);
                return;
            }
            console.log('UT HTTP: rendering admin panel');
            res.render('admin', {});
            console.log('=== UT HTTP DONE ===');
        } catch (e) {
            utError('handleAdminReq', e, { url: req.url, user: user ? user.name : null });
        }
    };

    obj.serveraction = function (command, myparent, gp) {
        try {
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
                console.log('UT CMD: myparent raw=' + (myparent ? Object.keys(myparent).sort().join(',').substring(0, 400) : 'NULL'));
            }
            console.log('UT CMD: sid=' + (sid ? sid.substring(0, 40) : 'null'));
            console.log('UT CMD: myparent.type=' + typeof myparent);
            console.log('UT CMD: myparent.keys=' + (myparent ? Object.keys(myparent).sort().join(',').substring(0, 200) : 'null'));
            if (!sid) {
                console.log('UT CMD: no sid — myparent raw=' + JSON.stringify(myparent).substring(0, 300));
                return;
            }

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
                    return;
                }
                var pending = ids.length;
                ids.forEach(function (nid) {
                    try {
                        console.log('UT CMD: db.Get(' + nid.substring(0, 40) + '...)');
                        obj.mdb.Get(nid, function (err, docs) {
                            try {
                                console.log('UT CMD: db.Get callback for ' + (nid ? nid.substring(0, 30) : 'null nodeid'));
                                console.log('UT CMD: err=' + (err ? err.message : 'null') + ' docs=' + (docs ? docs.length : 'null'));
                                if (err) { console.log('UT CMD: FULL err raw=' + JSON.stringify(err)); }
                                if (!docs) { console.log('UT CMD: FULL docs raw=' + JSON.stringify(docs)); }
                                if (!err && docs && docs.length > 0) {
                                    var d = docs[0];
                                    console.log('UT CMD: doc.name=' + d.name + ' doc.users=' + JSON.stringify(d.users));
                                    if (Array.isArray(d.users) && d.users.length > 0) {
                                        result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                                        console.log('UT CMD: added to result: ' + d.name + ' -> ' + JSON.stringify(d.users));
                                    } else {
                                        console.log('UT CMD: no users for ' + d.name + ' doc.users raw=' + JSON.stringify(d.users) + ' doc.keys=' + Object.keys(d).join(','));
                                    }
                                } else {
                                    console.log('UT CMD: no docs for ' + (nid ? nid.substring(0, 30) : 'null') + ' err=' + JSON.stringify(err) + ' docs=' + JSON.stringify(docs));
                                }
                                pending--;
                                console.log('UT CMD: pending=' + pending + ' result.length=' + result.length);
                                if (pending <= 0) {
                                    console.log('UT CMD: ALL DONE, sending');
                                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result });
                                }
                            } catch (e) { utError('getCurrentUsers_callback', e, { nid: nid }); }
                        });
                    } catch (e) { utError('getCurrentUsers_iteration', e, { nid: nid }); }
                });
                return;
            }

            // --- getTimeline ---
            if (command.pluginaction === 'getTimeline') {
                console.log('=== UT CMD: getTimeline ===');
                console.log('UT CMD: startDate=' + command.startDate + ' endDate=' + command.endDate);
                console.log('UT CMD: nodeids=' + (command.nodeids ? JSON.stringify(command.nodeids).substring(0, 100) : 'null'));
                if (!obj.db || !obj.db.getEvents) {
                    console.log('UT CMD: db.getEvents not available, db=' + typeof obj.db + ' getEvents=' + (obj.db ? typeof obj.db.getEvents : 'N/A'));
                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'timeline', data: [] });
                    return;
                }
                var opts = { limit: command.limit || 5000 };
                if (command.startDate) opts.startDate = command.startDate;
                if (command.endDate) opts.endDate = command.endDate;
                if (command.nodeids && command.nodeids.length > 0) opts.nodeids = command.nodeids;
                else if (command.nodeid) opts.nodeids = [command.nodeid];
                var query = {};
                if (command.username) query.$or = [{ username: command.username }, { displayUser: command.username }];
                obj.db.getEvents(query, opts, function (docs) {
                    if (!docs) { console.log('UT CMD: getEvents returned null docs. opts=' + JSON.stringify(opts)); }
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
                    console.log('UT CMD: getDeviceNames not available');
                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'deviceNames', data: [] });
                }
                return;
            }

            // --- getUserNames ---
            if (command.pluginaction === 'getUserNames') {
                if (obj.db && obj.db.getUserNames) {
                    obj.db.getUserNames(function(d) {
                        obj.send(sid, { action:'plugin', plugin:'usertracer', method:'userNames', data: d || [] });
                    });
                } else {
                    console.log('UT CMD: getUserNames not available');
                    obj.send(sid, { action:'plugin', plugin:'usertracer', method:'userNames', data: [] });
                }
                return;
            }


            console.log('UT CMD: unknown action=' + command.pluginaction);
        } catch (e) {
            utError('serveraction', e, { pluginaction: command ? command.pluginaction : 'N/A' });
        }
        console.log('=== UT CMD END ===');
    };

    obj.send = function (sid, data) {
        try {
            console.log('=== UT SEND ===');
            console.log('UT SEND: sid=' + (sid ? sid.substring(0, 40) : 'null'));
            console.log('UT SEND: data.method=' + data.method);
            console.log('UT SEND: data.data type=' + (data.data ? (Array.isArray(data.data) ? 'array[' + data.data.length + ']' : typeof data.data) : 'undefined'));
            var jsonStr = JSON.stringify(data);
            console.log('UT SEND: data JSON=' + jsonStr.substring(0, 500));
            var wss2 = obj.meshServer.webserver.wssessions2;
            if (!wss2) {
                console.log('UT SEND: wssessions2 is NULL — meshServer.webserver keys=' + Object.keys(obj.meshServer.webserver).sort().join(','));
                return;
            }
            if (wss2[sid]) {
                console.log('UT SEND: session found, sending...');
                wss2[sid].send(jsonStr);
                console.log('UT SEND: OK');
            } else {
                console.log('UT SEND: session NOT FOUND. sid=' + (sid || 'null') + ' wssessions2 keys=' + Object.keys(wss2).join(',') + ' wssessions2 raw=' + JSON.stringify(Object.keys(wss2)));
            }
        } catch (e) {
            utError('send', e, { sid: sid });
        }
        console.log('=== UT SEND END ===');
    };


    obj.getNodeName = function (nid) {
        try {
            if (obj.meshServer.webserver.wsagents && obj.meshServer.webserver.wsagents[nid]) {
                return obj.meshServer.webserver.wsagents[nid].name || nid;
            }
            return nid;
        } catch (e) {
            return nid;
        }
    };


    obj.onDeviceRefreshEnd = function () {
        try {
            console.log('=== UT DEVICETAB ===');
            console.log('UT DEVICETAB: called');
            if (typeof currentNode === 'undefined' || !currentNode) {
                console.log('UT DEVICETAB: no currentNode. typeof=' + typeof currentNode + ' raw=' + JSON.stringify(currentNode));
                return;
            }
            console.log('UT DEVICETAB: currentNode._id=' + (currentNode._id ? currentNode._id.substring(0, 30) : 'null'));
            console.log('UT DEVICETAB: currentNode.name=' + currentNode.name);
            console.log('UT DEVICETAB: currentNode.osdesc=' + currentNode.osdesc);
            console.log('UT DEVICETAB: currentNode keys=' + Object.keys(currentNode).sort().join(','));
            if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) {
                console.log('UT DEVICETAB: not Windows, skipping tab');
                return;
            }
            console.log('UT DEVICETAB: registering tab...');
            if (typeof pluginHandler === 'undefined') {
                console.log('UT DEVICETAB: pluginHandler is undefined');
                return;
            }
            console.log('UT DEVICETAB: pluginHandler keys=' + Object.keys(pluginHandler).sort().join(','));
            pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
            QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
            console.log('UT DEVICETAB: tab registered and iframe created');
            console.log('=== UT DEVICETAB END ===');
        } catch (e) {
            utError('onDeviceRefreshEnd', e, { nodeid: typeof currentNode !== 'undefined' ? currentNode._id : null });
        }
    };

    return obj;
};
