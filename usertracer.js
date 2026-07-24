/**
 * User-Device Tracer — minimal
 * Lê o usuário ativo que o MeshCentral já tem de cada agente.
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];

    obj.handleAdminReq = function (req, res, user) {
        if (req.query.user == 1) { return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' }); }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    obj.serveraction = function (command, myparent, gp) {
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        if (!sid) return;

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            try {
                // Source 1: parent.agents
                var src1 = obj.meshServer.parent.agents || {};
                for (var nid in src1) {
                    var u = obj.findUser(src1[nid]);
                    if (u) { obj.addResult(result, nid, src1[nid].name || nid, u); }
                }
                // Source 2: wsagents
                var src2 = obj.meshServer.webserver.wsagents || {};
                for (var nid in src2) {
                    if (obj.hasResult(result, nid)) continue;
                    var u = obj.findUser(src2[nid]);
                    if (u) { obj.addResult(result, nid, obj.getNodeName(nid), u); }
                }
                // Debug dump
                var first = Object.keys(src1)[0];
                if (first) {
                    obj.debug('plugin:usertracer', 'parent.agents[' + first + '] keys: ' + Object.keys(src1[first]).sort().join(', '));
                    obj.debug('plugin:usertracer', 'wsagents[' + first + '] keys: ' + (src2[first] ? Object.keys(src2[first]).sort().join(', ') : 'N/A'));
                }
            } catch (e) { obj.debug('plugin:usertracer', 'error: ' + e.message); }
            obj.debug('plugin:usertracer', 'result: ' + result.length + ' devices with users');
            obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
        }
    };

    obj.findUser = function (o) {
        if (!o || typeof o !== 'object') return null;
        var props = ['users', 'lusers', 'upnusers'];
        for (var i = 0; i < props.length; i++) {
            if (Array.isArray(o[props[i]]) && o[props[i]].length > 0) return o[props[i]];
        }
        if (o._agent && o._agent.username) return [o._agent.username];
        if (o.info && o.info.username) return [o.info.username];
        return null;
    };

    obj.addResult = function (arr, nid, name, users) {
        for (var i = 0; i < arr.length; i++) { if (arr[i].nodeid === nid) return; }
        arr.push({ nodeid: nid, nodeName: name, users: users });
    };

    obj.hasResult = function (arr, nid) {
        for (var i = 0; i < arr.length; i++) { if (arr[i].nodeid === nid) return true; }
        return false;
    };

    obj.getNodeName = function (nid) {
        try { return obj.meshServer.parent.agents[nid].name || nid; } catch (e) { return nid; }
    };

    obj.send = function (sid, data) {
        try { if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data)); } catch (e) {}
    };

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;
        pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
        QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
    };

    return obj;
};
