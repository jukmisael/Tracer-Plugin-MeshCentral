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
                // Try EVERY possible data source for agent users
                var sources = [
                    obj.meshServer.parent.agents,
                    obj.meshServer.webserver.wsagents
                ];
                for (var si = 0; si < sources.length; si++) {
                    var src = sources[si];
                    if (!src) continue;
                    for (var nid in src) {
                        var a = src[nid];
                        // Dump full structure of first agent
                        if (si === 0 && result.length === 0) {
                            obj.debug('plugin:usertracer', '=== DUMP agent ' + nid + ' (from source ' + si + ') ===');
                            var keys = Object.keys(a).sort();
                            for (var ki = 0; ki < keys.length; ki++) {
                                try {
                                    var val = a[keys[ki]];
                                    var valStr = (typeof val === 'object') ? JSON.stringify(val).substring(0, 200) : String(val);
                                    obj.debug('plugin:usertracer', '  ' + keys[ki] + ' = ' + valStr);
                                } catch (e) { obj.debug('plugin:usertracer', '  ' + keys[ki] + ' = (error reading)'); }
                            }
                        }
                        // Try all possible user properties
                        var userProps = ['users', 'lusers', 'upnusers', 'user', 'username', '_agent', 'info'];
                        for (var pi = 0; pi < userProps.length; pi++) {
                            var prop = userProps[pi];
                            try {
                                if (a[prop]) {
                                    if (prop === '_agent' && a[prop].username) {
                                        result.push({ nodeid: nid, nodeName: a.name || nid, users: [a[prop].username] });
                                        obj.debug('plugin:usertracer', 'FOUND user via _agent.username: ' + a[prop].username);
                                    } else if (Array.isArray(a[prop]) && a[prop].length > 0) {
                                        result.push({ nodeid: nid, nodeName: a.name || nid, users: a[prop] });
                                        obj.debug('plugin:usertracer', 'FOUND users via ' + prop + ': ' + JSON.stringify(a[prop]));
                                        break;
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) {
                obj.debug('plugin:usertracer', 'getCurrentUsers error: ' + e.message);
            }
            obj.debug('plugin:usertracer', 'getCurrentUsers: returning ' + result.length + ' devices with users');
            obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
        }
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
