/**
 * @description User-Device Tracer — MeshCentral plugin server-side
 * Rastreia usuários Windows logados nos dispositivos via agente MeshCentral.
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

    obj.exports = [
        'onDeviceRefreshEnd'
    ];

    /** Initialize database on startup */
    obj.server_startup = function () {
        obj.meshServer.pluginHandler.usertracer_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.usertracer_db;
        obj.debug('plugin:usertracer', 'Server started');
    };

    /** Agent connected — tell it to start monitoring user sessions */
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        obj.debug('plugin:usertracer', 'hook_agentCoreIsStable called');
        try {
            var nodeid = myparent ? myparent.nodeid : null;
            obj.debug('plugin:usertracer', 'hook_agentCoreIsStable: nodeid=' + nodeid);
            if (nodeid && obj.meshServer.webserver.wsagents[nodeid]) {
                obj.meshServer.webserver.wsagents[nodeid].send(JSON.stringify({
                    action: 'plugin',
                    plugin: 'usertracer',
                    pluginaction: 'startPolling'
                }));
                obj.debug('plugin:usertracer', 'hook_agentCoreIsStable: startPolling sent to ' + nodeid);
            } else {
                obj.debug('plugin:usertracer', 'hook_agentCoreIsStable: no wsagent for nodeid=' + nodeid);
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'hook_agentCoreIsStable error: ' + e.message);
        }
    };

    /** Handle agent data and frontend commands */
    obj.serveraction = function (command, myparent, grandparent) {
        if (command.plugin !== 'usertracer') return;

        // Derive sessionid (frontend) or nodeid (agent)
        var sessionid = null;
        try { sessionid = myparent.ws.sessionId; } catch (e) {}
        var nodeid = command.nodeid || (myparent ? myparent.nodeid : null);

        obj.debug('plugin:usertracer', 'serveraction: pluginaction=' + command.pluginaction + ', nodeid=' + nodeid + ', sessionid=' + sessionid);

        switch (command.pluginaction) {

            // --- Agent → Server: session events ---
            case 'sessionEvents':
                if (!nodeid) { obj.debug('plugin:usertracer', 'sessionEvents: no nodeid'); return; }
                var events = [];
                try { events = JSON.parse(command.events); } catch (e) { obj.debug('plugin:usertracer', 'sessionEvents: parse error'); return; }
                obj.debug('plugin:usertracer', 'sessionEvents: received ' + events.length + ' events from ' + nodeid);
                for (var i = 0; i < events.length; i++) {
                    events[i].nodeid = nodeid;
                    events[i].nodeName = obj.getNodeName(nodeid);
                }
                obj.db.addEvents(events);
                obj.debug('plugin:usertracer', 'sessionEvents: stored ' + events.length + ' events for ' + nodeid);
                break;

            // --- Frontend → Server: get events for a device ---
            case 'getDeviceEvents':
                if (!sessionid) { obj.debug('plugin:usertracer', 'getDeviceEvents: no session'); return; }
                obj.debug('plugin:usertracer', 'getDeviceEvents: nodeid=' + command.nodeid);
                obj.db.getEventsByNode(command.nodeid, command.limit || 200, function (docs) {
                    obj.sendToSession(sessionid, {
                        action: 'plugin',
                        plugin: 'usertracer',
                        method: 'deviceEvents',
                        data: docs
                    });
                });
                break;

            // --- Frontend → Server: get all events (admin panel) ---
            case 'getAllEvents':
                if (!sessionid) { obj.debug('plugin:usertracer', 'getAllEvents: no session'); return; }
                obj.debug('plugin:usertracer', 'getAllEvents: limit=' + command.limit);
                obj.db.getEvents({}, command.limit || 500, function (docs) {
                    obj.sendToSession(sessionid, {
                        action: 'plugin',
                        plugin: 'usertracer',
                        method: 'allEvents',
                        data: docs
                    });
                });
                break;

            default:
                obj.debug('plugin:usertracer', 'serveraction: unknown pluginaction=' + command.pluginaction);
                break;
        }
    };

    /** Resolve node display name */
    obj.getNodeName = function (nodeid) {
        try {
            var agents = obj.meshServer.parent.agents;
            if (agents && agents[nodeid]) return agents[nodeid].name || nodeid;
        } catch (e) {}
        return nodeid;
    };
    /** Send response to frontend session */
    obj.sendToSession = function (sessionid, data) {
        if (!sessionid) { obj.debug('plugin:usertracer', 'sendToSession: no sessionid'); return; }
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sessionid]) {
                obj.meshServer.webserver.wssessions2[sessionid].send(JSON.stringify(data));
                obj.debug('plugin:usertracer', 'sendToSession: sent method=' + data.method + ' to session ' + sessionid);
            } else {
                obj.debug('plugin:usertracer', 'sendToSession: session ' + sessionid + ' not found');
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'sendToSession error: ' + e.message);
        }
    };

    /** HTTP handler: admin panel & device tab */
    obj.handleAdminReq = function (req, res, user) {
        obj.debug('plugin:usertracer', 'handleAdminReq: query=' + JSON.stringify(req.query) + ', user=' + (user ? user.name : 'null') + ', siteadmin=' + (user ? user.siteadmin : 'null'));
        // Device tab (loaded as iframe on device page)
        if (req.query.user == 1) {
            obj.debug('plugin:usertracer', 'handleAdminReq: rendering device tab for nodeid=' + req.query.nodeid);
            res.render('device', {
                nodeid: req.query.nodeid || '',
                nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown'
            });
            return;
        }
        // Admin panel — requires site admin
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
            obj.debug('plugin:usertracer', 'handleAdminReq: 401, siteadmin=' + (user ? user.siteadmin : 'null'));
            res.sendStatus(401);
            return;
        }
        obj.debug('plugin:usertracer', 'handleAdminReq: rendering admin panel');
        res.render('admin', {});
    };

    /** Register device tab */
    obj.onDeviceRefreshEnd = function (nodeid, panel, refresh, event) {
        if (typeof currentNode === 'undefined' || currentNode == null) return;
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
