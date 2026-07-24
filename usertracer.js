/**
 * User-Device Tracer — debug
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];

    obj.handleAdminReq = function (req, res, user) {
        console.log('UT: handleAdminReq user=' + (user ? user.name : 'null'));
        if (req.query.user == 1) { return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' }); }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { console.log('UT: 401'); res.sendStatus(401); return; }
        res.render('admin', {});
    };

    obj.serveraction = function (command, myparent, gp) {
        console.log('UT: serveraction action=' + command.pluginaction);
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        if (!sid) return;

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            try {
                var ws = obj.meshServer.webserver ? obj.meshServer.webserver.wsagents || {} : {};
                console.log('UT: ' + Object.keys(ws).length + ' agents');

                // Check agentInfo for user data (in-memory)
                for (var nid in ws) {
                    var a = ws[nid];
                    // Dump agentInfo shape once
                    if (a.agentInfo) {
                        console.log('UT: agentInfo keys=' + Object.keys(a.agentInfo).sort().join(','));
                        console.log('UT: agentInfo sample=' + JSON.stringify(a.agentInfo).substring(0, 300));
                        if (a.agentInfo.username) {
                            obj.addResult(result, nid, a.name || nid, [a.agentInfo.username]);
                        }
                        break; // dump only first
                    }
                }

                // Try DB
                var db = obj.meshServer.db;
                if (db && typeof db.Get === 'function') {
                    for (var nid in ws) {
                        if (obj.hasResult(result, nid)) continue;
                        (function(nodeId) {
                            try {
                                db.Get(nodeId, function(err, docs) {
                                    if (err || !docs || docs.length === 0) return;
                                    var d = docs[0];
                                    if (Array.isArray(d.users) && d.users.length > 0) {
                                        obj.addResult(result, nodeId, d.name || nodeId, d.users);
                                        console.log('UT: DB users=' + JSON.stringify(d.users));
                                    } else if (Array.isArray(d.lusers) && d.lusers.length > 0) {
                                        obj.addResult(result, nodeId, d.name || nodeId, d.lusers);
                                        console.log('UT: DB lusers=' + JSON.stringify(d.lusers));
                                    }
                                });
                            } catch(e) { console.log('UT: db error ' + e.message); }
                        })(nid);
                    }
                } else { console.log('UT: db.Get not available'); }
            } catch (e) { console.log('UT: error ' + e.message); }
            console.log('UT: final result ' + result.length + ' devices');
            if (sid) setTimeout(function() { obj.send(sid, { action:'plugin', plugin:'usertracer', method:'currentUsers', data: result }); }, 500);
        }
    };

    obj.findUser = function (o) {
        if (!o || typeof o !== 'object') return null;
        var props = ['users', 'lusers', 'upnusers'];
        for (var i = 0; i < props.length; i++) { if (Array.isArray(o[props[i]]) && o[props[i]].length > 0) return o[props[i]]; }
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
