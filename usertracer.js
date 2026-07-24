/**
 * User-Device Tracer — v3.0 minimal
 * Só lê o usuário ativo que o MeshCentral já tem de cada agente.
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;

    obj.exports = ['onDeviceRefreshEnd'];

    // -----------------------------------------------------------------------
    // HTTP: admin panel
    // -----------------------------------------------------------------------
    obj.handleAdminReq = function (req, res, user) {
        if (req.query.user == 1) { return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' }); }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    // -----------------------------------------------------------------------
    // Frontend query: get current users for all connected agents
    // -----------------------------------------------------------------------
    obj.serveraction = function (command, myparent, gp) {
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        if (!sid) return;

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            try {
                var agents = obj.meshServer.parent.agents || {};
                for (var nid in agents) {
                    var a = agents[nid];
                    var users = obj.getAgentUsers(a);
                    if (users && users.length > 0) {
                        result.push({ nodeid: nid, nodeName: a.name || nid, users: users });
                    }
                }
            } catch (e) {}
            obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
        }
    };

    obj.getAgentUsers = function (a) {
        if (a.users && Array.isArray(a.users) && a.users.length > 0) return a.users;
        if (a.lusers && Array.isArray(a.lusers) && a.lusers.length > 0) return a.lusers;
        return [];
    };

    obj.getNodeName = function (nid) { try { return obj.meshServer.parent.agents[nid].name || nid; } catch (e) { return nid; } };

    obj.send = function (sid, data) { try { if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data)); } catch (e) {} };

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
