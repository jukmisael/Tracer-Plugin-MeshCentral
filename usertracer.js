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
        console.log('UT: handleAdminReq, user=' + (user ? user.name : 'null') + ', query=' + JSON.stringify(req.query));
        if (req.query.user == 1) { return res.render('device', { nodeid: req.query.nodeid || '', nodeName: req.query.nodeid ? obj.getNodeName(req.query.nodeid) : 'Unknown' }); }
        if (!user || (user.siteadmin & 0xFFFFFFFF) == 0) { console.log('UT: 401'); res.sendStatus(401); return; }
        res.render('admin', {});
    };

    obj.serveraction = function (command, myparent, gp) {
        console.log('UT: serveraction called, plugin=' + command.plugin + ', action=' + command.pluginaction);
        if (command.plugin !== 'usertracer') return;
        var sid = null;
        try { sid = myparent.ws.sessionId; } catch (e) {}
        console.log('UT: sid=' + sid);

        if (command.pluginaction === 'getCurrentUsers') {
            var result = [];
            try {
                // Dump meshServer structure
                console.log('UT: meshServer type=' + typeof obj.meshServer);
                console.log('UT: meshServer keys=' + Object.keys(obj.meshServer).sort().join(','));

                // Source 1: Try obj.meshServer.agents directly
                try {
                    if (obj.meshServer.agents) {
                        console.log('UT: meshServer.agents count=' + Object.keys(obj.meshServer.agents).length);
                        for (var nid in obj.meshServer.agents) {
                            var a = obj.meshServer.agents[nid];
                            console.log('UT: agents[' + nid + '] keys=' + Object.keys(a).sort().join(','));
                            var u = obj.findUser(a);
                            if (u) obj.addResult(result, nid, a.name || nid, u);
                        }
                    } else { console.log('UT: meshServer.agents is ' + typeof obj.meshServer.agents); }
                } catch (e) { console.log('UT: agents error: ' + e.message); }

                // Source 2: wsagents via webserver
                try {
                    var ws = obj.meshServer.webserver ? obj.meshServer.webserver.wsagents || {} : {};
                    console.log('UT: wsagents count=' + Object.keys(ws).length);
                    for (var nid in ws) {
                        if (obj.hasResult(result, nid)) continue;
                        var a = ws[nid];
                        console.log('UT: ws[' + nid + '] keys=' + Object.keys(a).sort().join(','));
                        var u = obj.findUser(a);
                        if (u) obj.addResult(result, nid, obj.getNodeName(nid), u);
                    }
                } catch (e) { console.log('UT: wsagents error: ' + e.message); }

                // Source 3: obj.meshServer.parent
                try {
                    var p = obj.meshServer.parent;
                    console.log('UT: meshServer.parent type=' + typeof p);
                    if (p) {
                        console.log('UT: meshServer.parent keys=' + Object.keys(p).sort().join(','));
                        if (p.agents) console.log('UT: parent.agents count=' + Object.keys(p.agents).length);
                    }
                } catch (e) { console.log('UT: parent error: ' + e.message); }

            } catch (e) { console.log('UT: fatal: ' + e.message); }
            console.log('UT result: ' + result.length + ' devices');
            if (sid) obj.send(sid, { action: 'plugin', plugin: 'usertracer', method: 'currentUsers', data: result });
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
        try { return obj.meshServer.webserver.wsagents[nid].name || nid; } catch (e) { return nid; }
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
