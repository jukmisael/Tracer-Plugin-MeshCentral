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
        try {
            var nodeid = myparent ? myparent.nodeid : null;
            if (nodeid && obj.meshServer.webserver.wsagents[nodeid]) {
                obj.meshServer.webserver.wsagents[nodeid].send(JSON.stringify({
                    action: 'plugin',
                    plugin: 'usertracer',
                    pluginaction: 'startPolling'
                }));
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

        switch (command.pluginaction) {

            // --- Agent → Server: session events ---
            case 'sessionEvents':
                if (!nodeid) { obj.debug('plugin:usertracer', 'sessionEvents: no nodeid'); return; }
                var events = [];
                try { events = JSON.parse(command.events); } catch (e) { return; }
                for (var i = 0; i < events.length; i++) {
                    events[i].nodeid = nodeid;
                    events[i].nodeName = obj.getNodeName(nodeid);
                }
                obj.db.addEvents(events);
                obj.debug('plugin:usertracer', 'Stored ' + events.length + ' events for node ' + nodeid);
                break;

            // --- Frontend → Server: get events for a device ---
            case 'getDeviceEvents':
                if (!sessionid) return;
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
                if (!sessionid) return;
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
        if (!sessionid) return;
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sessionid]) {
                obj.meshServer.webserver.wssessions2[sessionid].send(JSON.stringify(data));
            }
        } catch (e) {}
    };

    /** HTTP handler: admin panel & device tab */
    obj.handleAdminReq = function (req, res, user) {
        // Device tab (loaded as iframe on device page)
        if (req.query.user == 1) {
            res.render('device', {
                nodeid: req.query.nodeid || '',
                nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown'
            });
            return;
        }
        // Admin panel — requires site admin
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
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
