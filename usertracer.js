/**
 * @description User-Device Tracer — server-side plugin for MeshCentral.
 * Tracks which Windows AD users log into which devices via agent-side
 * `query user` polling. Provides admin panel (list, graph, timeline, audit)
 * and per-device tab.
 * @author Misael Filho
 * @license MIT
 */

"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.db = null;

    // Exports to frontend (web UI functions)
    obj.exports = [
        'onDeviceRefreshEnd'
    ];

    // -----------------------------------------------------------------------
    // Permissions
    // -----------------------------------------------------------------------
    obj.registerPermissions = function () {
        parent.registerPermissions('usertracer', {
            'view_audit': {
                title: 'View Audit Log',
                desc: 'Can view the user-device audit trail',
                default: 'allowed'
            },
            'view_admin': {
                title: 'View Admin Panel',
                desc: 'Can access the global admin panel',
                default: 'allowed'
            }
        });
    };

    // -----------------------------------------------------------------------
    // Database (NeDB)
    // -----------------------------------------------------------------------
    obj.initDB = function () {
        var Datastore = require('nedb');
        // Events collection
        if (obj.eventsDb == null) {
            obj.eventsDb = new Datastore({
                filename: obj.meshServer.getConfigFilePath('plugin-usertracer-events.db'),
                autoload: true
            });
            obj.eventsDb.persistence.setAutocompactionInterval(60000);
            obj.eventsDb.ensureIndex({ fieldName: 'nodeid' });
            obj.eventsDb.ensureIndex({ fieldName: 'detectedAt' });
            obj.eventsDb.ensureIndex({ fieldName: 'username' });
        }
        // Snapshots collection (periodic full state)
        if (obj.snapshotsDb == null) {
            obj.snapshotsDb = new Datastore({
                filename: obj.meshServer.getConfigFilePath('plugin-usertracer-snapshots.db'),
                autoload: true
            });
            obj.snapshotsDb.persistence.setAutocompactionInterval(60000);
            obj.snapshotsDb.ensureIndex({ fieldName: 'nodeid' });
            obj.snapshotsDb.ensureIndex({ fieldName: 'timestamp' });
        }
    };

    // -----------------------------------------------------------------------
    // Server hooks
    // -----------------------------------------------------------------------

    obj.server_startup = function () {
        obj.initDB();
        obj.registerPermissions();
        obj.debug('plugin:usertracer', 'Server startup complete');
    };

    /**
     * Called when an agent first establishes a stable connection.
     * Tells the agent to start polling user sessions.
     */
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        try {
            var nodeid = myparent ? myparent.nodeid : null;
            if (nodeid && obj.meshServer.webserver.wsagents[nodeid]) {
                obj.meshServer.webserver.wsagents[nodeid].send(JSON.stringify({
                    action: 'plugin',
                    plugin: 'usertracer',
                    pluginaction: 'startPolling'
                }));
                obj.debug('plugin:usertracer', 'Sent startPolling to node ' + nodeid);
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'hook_agentCoreIsStable error: ' + e.message);
        }
    };

    /**
     * Handle messages from agents AND from the web UI (serveraction).
     * Agent messages arrive with action='plugin', plugin='usertracer'.
     * Web UI messages arrive via serveraction with command.plugin='usertracer'.
     */
    obj.serveraction = function (command, myparent, grandparent) {
        if (command.plugin !== 'usertracer') return;

        var sessionid = null;
        try { sessionid = myparent.ws.sessionId; } catch (e) { /* from agent, no ws session */ }

        // Derive nodeid: command may include it (frontend) or we get it from
        // the agent connection context (myparent.nodeid for agent messages).
        var nodeid = command.nodeid || (myparent ? myparent.nodeid : null) || (myparent && myparent.user ? null : null);

        switch (command.pluginaction) {

            // --- Agent → Server: session events (login/logout/disconnect/reconnect) ---
            case 'sessionEvents':
                obj.handleSessionEvents(command, nodeid);
                break;

            // --- Agent → Server: full session snapshot ---
            case 'sessionSnapshot':
                obj.handleSessionSnapshot(command, nodeid);
                break;

            // --- Frontend → Server: query events for a node ---
            case 'getDeviceEvents':
                obj.getDeviceEvents(command, sessionid);
                break;

            // --- Frontend → Server: query all events (admin panel) ---
            case 'getAllEvents':
                obj.getAllEvents(command, sessionid);
                break;

            // --- Frontend → Server: per-user aggregation ---
            case 'getEventsByUser':
                obj.getEventsByUser(command, sessionid);
                break;

            // --- Frontend → Server: per-device aggregation ---
            case 'getEventsByDevice':
                obj.getEventsByDevice(command, sessionid);
                break;

            // --- Frontend → Server: timeline data (grouped by device+user pair) ---
            case 'getTimeline':
                obj.getTimeline(command, sessionid);
                break;

            // --- Frontend → Server: graph data (user-device relationships) ---
            case 'getGraphData':
                obj.getGraphData(command, sessionid);
                break;

            default:
                obj.debug('plugin:usertracer', 'Unknown pluginaction: ' + command.pluginaction);
                break;
        }
    };

    obj.handleSessionEvents = function (command, nodeid) {
        if (!nodeid) {
            obj.debug('plugin:usertracer', 'sessionEvents missing nodeid — agent message without connection context?');
            return;
        }

        var events = [];
        try { events = JSON.parse(command.events); } catch (e) {
            obj.debug('plugin:usertracer', 'sessionEvents parse error: ' + e.message);
            return;
        }

        var nodeName = obj.getNodeName(nodeid);

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            ev.nodeid = nodeid;
            ev.nodeName = nodeName;
            ev.receivedAt = new Date().toISOString();
            obj.eventsDb.insert(ev);
        }

        obj.debug('plugin:usertracer', 'Stored ' + events.length + ' event(s) for node ' + nodeName);
    };

    obj.handleSessionSnapshot = function (command, nodeid) {
        if (!nodeid) return;

        var sessions = [];
        try { sessions = JSON.parse(command.sessions); } catch (e) { return; }

        obj.snapshotsDb.insert({
            nodeid: nodeid,
            nodeName: obj.getNodeName(nodeid),
            sessions: sessions,
            timestamp: command.timestamp || new Date().toISOString()
        });
    };
        }

        obj.debug('plugin:usertracer', 'Stored ' + events.length + ' event(s) for node ' + nodeName);
    };

    // -----------------------------------------------------------------------
    // Frontend query handlers
    // -----------------------------------------------------------------------

    /** Send result back to a specific web UI session. */
    obj.sendToSession = function (sessionid, data) {
        if (!sessionid) return;
        try {
            if (obj.meshServer.webserver.wssessions2 &&
                obj.meshServer.webserver.wssessions2[sessionid]) {
                obj.meshServer.webserver.wssessions2[sessionid].send(JSON.stringify(data));
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'sendToSession error: ' + e.message);
        }
    };

    /** Resolve a node's display name. */
    obj.getNodeName = function (nodeid) {
        try {
            if (obj.meshServer.parent.agents &&
                obj.meshServer.parent.agents[nodeid]) {
                return obj.meshServer.parent.agents[nodeid].name || nodeid;
            }
        } catch (e) { /* fall through */ }
        return nodeid;
    };

    obj.getDeviceEvents = function (command, sessionid) {
        var nodeid = command.nodeid;
        var limit = command.limit || 200;

        obj.eventsDb.find({ nodeid: nodeid })
            .sort({ detectedAt: -1 })
            .limit(limit)
            .exec(function (err, docs) {
                obj.sendToSession(sessionid, {
                    action: 'plugin',
                    plugin: 'usertracer',
                    method: 'deviceEvents',
                    nodeid: nodeid,
                    nodeName: obj.getNodeName(nodeid),
                    data: docs || []
                });
            });
    };

    obj.getAllEvents = function (command, sessionid) {
        var limit = command.limit || 500;
        var query = {};
        if (command.username) query.username = command.username;
        if (command.nodeid) query.nodeid = command.nodeid;
        if (command.eventType) query.eventType = command.eventType;

        obj.eventsDb.find(query)
            .sort({ detectedAt: -1 })
            .limit(limit)
            .exec(function (err, docs) {
                obj.sendToSession(sessionid, {
                    action: 'plugin',
                    plugin: 'usertracer',
                    method: 'allEvents',
                    data: docs || []
                });
            });
    };

    obj.getEventsByUser = function (command, sessionid) {
        obj.eventsDb.find({})
            .sort({ detectedAt: -1 })
            .exec(function (err, docs) {
                // Aggregate by username
                var byUser = {};
                var docsArr = docs || [];
                for (var i = 0; i < docsArr.length; i++) {
                    var e = docsArr[i];
                    var key = e.domain ? e.domain + '\\' + e.username : e.username;
                    if (!byUser[key]) {
                        byUser[key] = {
                            username: e.username,
                            domain: e.domain || '',
                            totalEvents: 0,
                            devices: {},
                            lastSeen: null,
                            firstSeen: null
                        };
                    }
                    byUser[key].totalEvents++;
                    if (!byUser[key].devices[e.nodeName]) {
                        byUser[key].devices[e.nodeName] = {
                            nodeid: e.nodeid,
                            count: 0
                        };
                    }
                    byUser[key].devices[e.nodeName].count++;
                    if (!byUser[key].firstSeen || e.detectedAt < byUser[key].firstSeen) {
                        byUser[key].firstSeen = e.detectedAt;
                    }
                    if (!byUser[key].lastSeen || e.detectedAt > byUser[key].lastSeen) {
                        byUser[key].lastSeen = e.detectedAt;
                    }
                }

                obj.sendToSession(sessionid, {
                    action: 'plugin',
                    plugin: 'usertracer',
                    method: 'eventsByUser',
                    data: byUser
                });
            });
    };

    obj.getEventsByDevice = function (command, sessionid) {
        obj.eventsDb.find({})
            .sort({ detectedAt: -1 })
            .exec(function (err, docs) {
                var byDevice = {};
                var docsArr = docs || [];
                for (var i = 0; i < docsArr.length; i++) {
                    var e = docsArr[i];
                    var nodeName = e.nodeName || e.nodeid;
                    if (!byDevice[nodeName]) {
                        byDevice[nodeName] = {
                            nodeid: e.nodeid,
                            nodeName: nodeName,
                            totalEvents: 0,
                            users: {},
                            lastSeen: null
                        };
                    }
                    byDevice[nodeName].totalEvents++;
                    var userName = e.domain ? e.domain + '\\' + e.username : e.username;
                    if (!byDevice[nodeName].users[userName]) {
                        byDevice[nodeName].users[userName] = {
                            username: e.username,
                            domain: e.domain || '',
                            count: 0
                        };
                    }
                    byDevice[nodeName].users[userName].count++;
                    if (!byDevice[nodeName].lastSeen || e.detectedAt > byDevice[nodeName].lastSeen) {
                        byDevice[nodeName].lastSeen = e.detectedAt;
                    }
                }

                obj.sendToSession(sessionid, {
                    action: 'plugin',
                    plugin: 'usertracer',
                    method: 'eventsByDevice',
                    data: byDevice
                });
            });
    };

    obj.getTimeline = function (command, sessionid) {
        obj.eventsDb.find({})
            .sort({ detectedAt: -1 })
            .limit(command.limit || 300)
            .exec(function (err, docs) {
                var timeline = [];
                var docsArr = docs || [];
                for (var i = docsArr.length - 1; i >= 0; i--) {
                    var e = docsArr[i];
                    timeline.push({
                        date: e.detectedAt,
                        type: e.eventType,
                        user: e.domain ? e.domain + '\\' + e.username : e.username,
                        device: e.nodeName || e.nodeid,
                        session: e.sessionName || '',
                        detail: e.eventType === 'sessionDisconnected'
                            ? 'Disconnected'
                            : e.eventType === 'sessionReconnected'
                                ? 'Reconnected'
                                : e.eventType === 'userLogin'
                                    ? 'Logged in' + (e.state ? ' (' + e.state + ')' : '')
                                    : 'Logged out'
                    });
                }

                obj.sendToSession(sessionid, {
                    action: 'plugin',
                    plugin: 'usertracer',
                    method: 'timeline',
                    data: timeline
                });
            });
    };

    obj.getGraphData = function (command, sessionid) {
        // Returns nodes (users + devices) and edges (connections) for a graph visualization
        obj.eventsDb.find({})
            .sort({ detectedAt: -1 })
            .exec(function (err, docs) {
                var nodes = [];
                var edges = [];
                var userIds = {};
                var deviceIds = {};
                var edgeKeys = {};
                var nodeIdx = {};

                var docsArr = docs || [];
                for (var i = 0; i < docsArr.length; i++) {
                    var e = docsArr[i];
                    var userName = e.domain ? e.domain + '\\' + e.username : e.username;
                    var deviceName = e.nodeName || e.nodeid;
                    var eventWeight = (e.eventType === 'userLogin' || e.eventType === 'sessionReconnected') ? 1 : 0.5;

                    // User node
                    if (!userIds[userName]) {
                        var uid = 'user_' + userName;
                        userIds[userName] = uid;
                        nodeIdx[uid] = nodes.length;
                        nodes.push({
                            id: uid,
                            label: userName,
                            type: 'user',
                            group: 'user',
                            title: 'User: ' + userName
                        });
                    }

                    // Device node
                    if (!deviceIds[deviceName]) {
                        var did = 'device_' + deviceName;
                        deviceIds[deviceName] = did;
                        nodeIdx[did] = nodes.length;
                        nodes.push({
                            id: did,
                            label: deviceName,
                            type: 'device',
                            group: 'device',
                            title: 'Device: ' + deviceName
                        });
                    }

                    // Edge between user and device
                    var ekey = userIds[userName] + '|' + deviceIds[deviceName];
                    if (!edgeKeys[ekey]) {
                        edgeKeys[ekey] = true;
                        edges.push({
                            from: userIds[userName],
                            to: deviceIds[deviceName],
                            value: 1,
                            title: '1 connection',
                            color: '#4CAF50'
                        });
                    } else {
                        // Increment weight
                        for (var j = 0; j < edges.length; j++) {
                            if (edges[j].from === userIds[userName] &&
                                edges[j].to === deviceIds[deviceName]) {
                                edges[j].value++;
                                edges[j].title = edges[j].value + ' connections';
                                break;
                            }
                        }
                    }
                }

                obj.sendToSession(sessionid, {
                    action: 'plugin',
                    plugin: 'usertracer',
                    method: 'graphData',
                    data: { nodes: nodes, edges: edges }
                });
            });
    };

    // -----------------------------------------------------------------------
    // Web UI: Admin panel + Device tab handler
    // -----------------------------------------------------------------------

    obj.handleAdminReq = function (req, res, user) {
        // Device tab view (user=1 + nodeid)
        if (req.query.user == 1) {
            res.render('device', {
                nodeid: req.query.nodeid || '',
                nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown'
            });
            return;
        }
        // Admin panel — requires site admin
        if ((user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    // -----------------------------------------------------------------------
    // Web UI: Device tab registration
    // -----------------------------------------------------------------------

    obj.onDeviceRefreshEnd = function (nodeid, panel, refresh, event) {
        if (typeof currentNode === 'undefined' || currentNode == null) return;
        // Only show for Windows devices
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;

        pluginHandler.registerPluginTab({
            tabTitle: 'User Tracer',
            tabId: 'pluginUserTracer'
        });

        QA('pluginUserTracer',
            '<iframe id="pluginIframeUserTracer" style="width:100%;height:600px;overflow:auto" '
            + 'scrolling="yes" frameBorder=0 '
            + 'src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
    };

    return obj;
};
