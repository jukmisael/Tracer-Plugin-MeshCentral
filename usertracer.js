/**
 * User-Device Tracer — v3.1
 * Lê usuários ativos do banco de dados do MeshCentral.
 * db.Get(nodeId) → doc.users = ["DOMAIN\username"]
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.db = obj.meshServer.db;

    obj.handleAdminReq = function (req, res, user) {
        if (req.query.user == 1) { return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' }); }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { res.sendStatus(401); return; }
        res.render('admin', {});
    };

    obj.serveraction = function (command, myparent, gp) {
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        if (!sid || !obj.db || typeof obj.db.Get !== 'function') return;

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            var ws = obj.meshServer.webserver.wsagents || {};
            var agentIds = Object.keys(ws);
            var pending = agentIds.length;

            if (pending === 0) {
                obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
                return;
            }

            agentIds.forEach(function (nid) {
                obj.db.Get(nid, function (err, docs) {
                    try {
                        if (!err && docs && docs.length > 0) {
                            var d = docs[0];
                            console.log('UT: nid=' + nid.substring(0, 40) + ' users=' + JSON.stringify(d.users) + ' lusers=' + JSON.stringify(d.lusers));
                            if (Array.isArray(d.users) && d.users.length > 0) {
                                result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                            } else if (Array.isArray(d.lusers) && d.lusers.length > 0) {
                                result.push({ nodeid: nid, nodeName: d.name || nid, users: d.lusers });
                            }
                        } else {
                            console.log('UT: nid=' + (nid ? nid.substring(0, 40) : 'null') + ' err=' + (err ? err.message : 'null') + ' docs=' + (docs ? docs.length : 'null'));
                        }
                    } catch (e) { console.log('UT: callback error: ' + e.message); }
                    pending--;
                    console.log('UT: pending=' + pending);
                    if (pending <= 0) {
                        console.log('UT: sending result with ' + result.length + ' items');
                        obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
                    }
                });
            });
        }
    };

    obj.getNodeName = function (nid) { try { return obj.meshServer.webserver.wsagents[nid].name || nid; } catch (e) { return nid; } };

    obj.send = function (sid, data) { try { if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data)); } catch (e) {} };

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;
        pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
        QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
    };

    return obj;
};
