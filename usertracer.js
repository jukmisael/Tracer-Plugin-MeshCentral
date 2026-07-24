/**
 * @description User-Device Tracer — MeshCentral plugin server-side
 * Rastreia usuários Windows logados nos dispositivos.
 * Usa dados já fornecidos pelo MeshCentral (device.users/lusers)
 * em vez de query user no agente.
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
    obj.scanTimer = null;
    obj.SCAN_INTERVAL = 30000; // 30s
    obj.userCache = {}; // { nodeid: [username, ...] }

    obj.exports = ['onDeviceRefreshEnd'];

    // -----------------------------------------------------------------------
    // Server startup
    // -----------------------------------------------------------------------
    obj.server_startup = function () {
        obj.meshServer.pluginHandler.usertracer_db = require(__dirname + '/db.js').CreateDB(obj.meshServer);
        obj.db = obj.meshServer.pluginHandler.usertracer_db;
        obj.debug('plugin:usertracer', 'Server started');

        // Periodic scan of all connected agents to detect user changes
        obj.scanTimer = setInterval(obj.scanAgents, obj.SCAN_INTERVAL);
        setTimeout(obj.scanAgents, 2000); // first scan after 2s
    };

    // -----------------------------------------------------------------------
    // Agent user scan
    // -----------------------------------------------------------------------
    obj.scanAgents = function () {
        try {
            var wsagents = obj.meshServer.webserver.wsagents;
            if (!wsagents) return;
            for (var nodeid in wsagents) {
                obj.checkAgentUsers(nodeid);
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'scanAgents error: ' + e.message);
        }
    };

    obj.checkAgentUsers = function (nodeid) {
        try {
            var agent = obj.meshServer.parent.agents ? obj.meshServer.parent.agents[nodeid] : null;
            if (!agent) {
                agent = obj.meshServer.webserver.wsagents[nodeid];
                if (!agent) return;
            }

            // Get current users from agent data (set by MeshCentral from command.users/lusers/upnusers)
            var currentUsers = obj.getAgentUsers(agent);
            if (!currentUsers || !Array.isArray(currentUsers)) return;

            // Sort for comparison
            currentUsers = currentUsers.sort();
            var cacheKey = JSON.stringify(currentUsers);
            var prev = obj.userCache[nodeid];

            if (prev === cacheKey) return; // no change

            obj.userCache[nodeid] = cacheKey;
            var nodeName = obj.getNodeName(nodeid);

            if (!prev) {
                // First time seeing this agent — log all current users as logins
                for (var i = 0; i < currentUsers.length; i++) {
                    obj.storeEvent(nodeid, nodeName, currentUsers[i], 'userLogin');
                }
                obj.debug('plugin:usertracer', 'Initial users for ' + nodeName + ': ' + currentUsers.join(', '));
            } else {
                // Detect changes
                var prevUsers = JSON.parse(prev);
                var newUsers = currentUsers;

                // Users in new but not in prev = logged in
                for (var i = 0; i < newUsers.length; i++) {
                    if (prevUsers.indexOf(newUsers[i]) === -1) {
                        obj.storeEvent(nodeid, nodeName, newUsers[i], 'userLogin');
                        obj.debug('plugin:usertracer', 'LOGIN: ' + newUsers[i] + ' on ' + nodeName);
                    }
                }

                // Users in prev but not in new = logged out
                for (var i = 0; i < prevUsers.length; i++) {
                    if (newUsers.indexOf(prevUsers[i]) === -1) {
                        obj.storeEvent(nodeid, nodeName, prevUsers[i], 'userLogout');
                        obj.debug('plugin:usertracer', 'LOGOUT: ' + prevUsers[i] + ' from ' + nodeName);
                    }
                }
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'checkAgentUsers error for ' + nodeid + ': ' + e.message);
        }
    };

    obj.getAgentUsers = function (agent) {
        // MeshCentral stores user info in multiple formats:
        // - agent.users: array of "domain\username"
        // - agent.lusers: array with locked status
        // - agent.upnusers: array of "user@domain" format
        // - agent._agent: may contain user info from agent core
        if (agent.users && Array.isArray(agent.users) && agent.users.length > 0) return agent.users;
        if (agent.lusers && Array.isArray(agent.lusers) && agent.lusers.length > 0) return agent.lusers;
        if (agent.upnusers && Array.isArray(agent.upnusers) && agent.upnusers.length > 0) return agent.upnusers;
        if (agent._agent && agent._agent.username) return [agent._agent.username];
        return [];
    };

    obj.storeEvent = function (nodeid, nodeName, userStr, eventType) {
        if (!obj.db || !obj.db.addEvent) return;
        var username = userStr;
        var domain = '';
        if (userStr.indexOf('\\') !== -1) { domain = userStr.split('\\')[0]; username = userStr.split('\\')[1]; }
        else if (userStr.indexOf('@') !== -1) { domain = userStr.split('@')[1]; username = userStr.split('@')[0]; }
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
    // Hook: agent first checks in — force an immediate user check
    // -----------------------------------------------------------------------
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        try {
            var nodeid = myparent ? myparent.nodeid : null;
            if (nodeid) {
                obj.debug('plugin:usertracer', 'hook_agentCoreIsStable: ' + nodeid);
                setTimeout(function () { obj.checkAgentUsers(nodeid); }, 3000);
            }
        } catch (e) {
            obj.debug('plugin:usertracer', 'hook_agentCoreIsStable error: ' + e.message);
        }
    };

    // -----------------------------------------------------------------------
    // Hook: process agent data — catches user updates between scans
    // -----------------------------------------------------------------------
    obj.hook_processAgentData = function (data, nodeid) {
        if (!nodeid) return;
        // After agent data arrives, schedule a user check (debounced)
        if (obj._pendingCheck && obj._pendingCheck[nodeid]) {
            clearTimeout(obj._pendingCheck[nodeid]);
        }
        if (!obj._pendingCheck) obj._pendingCheck = {};
        obj._pendingCheck[nodeid] = setTimeout(function () {
            obj.checkAgentUsers(nodeid);
            delete obj._pendingCheck[nodeid];
        }, 2000);
    };

    // -----------------------------------------------------------------------
    // Serveraction — handle frontend queries
    // -----------------------------------------------------------------------
    obj.serveraction = function (command, myparent, grandparent) {
        if (command.plugin !== 'usertracer') return;
        var sessionid = null;
        try { sessionid = myparent.ws.sessionId; } catch (e) {}
        obj.debug('plugin:usertracer', 'serveraction: ' + command.pluginaction + ', sessionid=' + sessionid);

        switch (command.pluginaction) {
            case 'getAllEvents':
                if (!sessionid) return;
                obj.db.getEvents({}, command.limit || 500, function (docs) {
                    obj.sendToSession(sessionid, {
                        action: 'plugin', plugin: 'usertracer',
                        method: 'allEvents', data: docs
                    });
                });
                break;
            case 'getDeviceEvents':
                if (!sessionid) return;
                obj.db.getEventsByNode(command.nodeid, command.limit || 200, function (docs) {
                    obj.sendToSession(sessionid, {
                        action: 'plugin', plugin: 'usertracer',
                        method: 'deviceEvents', data: docs
                    });
                });
                break;
            case 'forceScan':
                obj.scanAgents();
                if (sessionid) obj.sendToSession(sessionid, {
                    action: 'plugin', plugin: 'usertracer',
                    method: 'scanResult', data: { status: 'ok' }
                });
                break;
            default:
                obj.debug('plugin:usertracer', 'Unknown action: ' + command.pluginaction);
                break;
        }
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    obj.getNodeName = function (nodeid) {
        try {
            if (obj.meshServer.parent.agents && obj.meshServer.parent.agents[nodeid]) {
                return obj.meshServer.parent.agents[nodeid].name || nodeid;
            }
        } catch (e) {}
        return nodeid;
    };

    obj.sendToSession = function (sessionid, data) {
        if (!sessionid) return;
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sessionid]) {
                obj.meshServer.webserver.wssessions2[sessionid].send(JSON.stringify(data));
                obj.debug('plugin:usertracer', 'sendToSession: ' + data.method);
            }
        } catch (e) {}
    };

    // -----------------------------------------------------------------------
    // HTTP handler: admin panel & device tab
    // -----------------------------------------------------------------------
    obj.handleAdminReq = function (req, res, user) {
        obj.debug('plugin:usertracer', 'handleAdminReq: user=' + (user ? user.name : 'null'));
        if (req.query.user == 1) {
            res.render('device', {
                nodeid: req.query.nodeid || '',
                nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown'
            });
            return;
        }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    // -----------------------------------------------------------------------
    // Device tab registration
    // -----------------------------------------------------------------------
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
