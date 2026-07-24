/**
 * User-Device Tracer — full debug version
 */
"use strict";

module.exports.usertracer = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.exports = ['onDeviceRefreshEnd'];
    obj.db = obj.meshServer.db;

    console.log('UT INIT: module loaded, parent keys=' + Object.keys(parent).sort().join(','));
    console.log('UT INIT: meshServer type=' + typeof obj.meshServer);
    console.log('UT INIT: db type=' + typeof obj.db + ' Get=' + (obj.db && typeof obj.db.Get));

    obj.handleAdminReq = function (req, res, user) {
        console.log('UT HANDLEADMIN: called, user=' + (user ? user.name : 'null') + ' query=' + JSON.stringify(req.query));
        if (req.query.user == 1) {
            console.log('UT HANDLEADMIN: rendering device tab for ' + req.query.nodeid);
            return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' });
        }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) {
            console.log('UT HANDLEADMIN: 401 Unauthorized, user.siteadmin=' + (user ? user.siteadmin : 'null'));
            res.sendStatus(401);
            return;
        }
        console.log('UT HANDLEADMIN: rendering admin panel');
        res.render('admin', {});
    };

    obj.serveraction = function (command, myparent, gp) {
        console.log('UT SERVERACTION: called, plugin=' + command.plugin + ' action=' + command.pluginaction);
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        console.log('UT SERVERACTION: sid=' + sid);
        if (!sid || !obj.db || typeof obj.db.Get !== 'function') {
            console.log('UT SERVERACTION: missing sid or db, sid=' + sid + ' db=' + (!!obj.db));
            return;
        }

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            var ws = obj.meshServer.webserver.wsagents || {};
            var agentIds = Object.keys(ws);
            console.log('UT GETUSERS: agents count=' + agentIds.length + ' ids=' + agentIds.map(function(s){return s.substring(0,20);}).join(','));

            if (agentIds.length === 0) {
                console.log('UT GETUSERS: no agents, sending empty result');
                obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
                return;
            }

            var pending = agentIds.length;
            agentIds.forEach(function (nid) {
                console.log('UT DB: calling Get(' + nid.substring(0, 40) + '...)');
                obj.db.Get(nid, function (err, docs) {
                    console.log('UT DB: callback for ' + nid.substring(0, 40) + '... err=' + (err ? err.message : 'null') + ' docs=' + (docs ? docs.length : 'null'));
                    try {
                        if (!err && docs && docs.length > 0) {
                            var d = docs[0];
                            console.log('UT DB: doc name=' + d.name + ' users=' + JSON.stringify(d.users) + ' lusers=' + JSON.stringify(d.lusers) + ' keys=' + Object.keys(d).sort().join(','));
                            if (Array.isArray(d.users) && d.users.length > 0) {
                                result.push({ nodeid: nid, nodeName: d.name || nid, users: d.users });
                                console.log('UT DB: added user ' + JSON.stringify(d.users) + ' for ' + d.name);
                            } else {
                                console.log('UT DB: no users array for ' + d.name);
                            }
                        } else {
                            console.log('UT DB: no docs found for ' + nid.substring(0, 40) + '...');
                        }
                    } catch (e) {
                        console.log('UT DB: ERROR in callback: ' + e.message);
                    }
                    pending--;
                    console.log('UT DB: pending=' + pending + ' result.length=' + result.length);
                    if (pending <= 0) {
                        console.log('UT DB: ALL DONE, sending ' + result.length + ' devices');
                        console.log('UT DB: result JSON=' + JSON.stringify(result).substring(0, 500));
                        obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
                    }
                });
            });
        }
    };

    obj.getNodeName = function (nid) {
        try { return obj.meshServer.webserver.wsagents[nid].name || nid; } catch (e) { return nid; }
    };

    obj.send = function (sid, data) {
        console.log('UT SEND: sid=' + sid.substring(0, 30) + '... method=' + data.method + ' data.length=' + (data.data ? data.data.length : 'N/A'));
        try {
            if (obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[sid]) {
                obj.meshServer.webserver.wssessions2[sid].send(JSON.stringify(data));
                console.log('UT SEND: OK');
            } else {
                console.log('UT SEND: session ' + sid.substring(0, 30) + '... not found in wssessions2');
            }
        } catch (e) {
            console.log('UT SEND: ERROR: ' + e.message);
        }
    };

    obj.onDeviceRefreshEnd = function () {
        console.log('UT DEVICETAB: onDeviceRefreshEnd called');
        if (typeof currentNode === 'undefined' || !currentNode) { console.log('UT DEVICETAB: no currentNode'); return; }
        if (currentNode.osdesc && currentNode.osdesc.toLowerCase().indexOf('windows') === -1) { console.log('UT DEVICETAB: not Windows, skipping'); return; }
        pluginHandler.registerPluginTab({ tabTitle: 'User Tracer', tabId: 'pluginUserTracer' });
        QA('pluginUserTracer', '<iframe id="pluginIframeUserTracer" style="width:100%;height:200px;overflow:auto" scrolling="yes" frameBorder=0 src="/pluginadmin.ashx?pin=usertracer&nodeid=' + encodeURIComponent(currentNode._id) + '&user=1" />');
        console.log('UT DEVICETAB: tab registered for ' + currentNode._id.substring(0, 30));
    };

    return obj;
};
