'use strict';

// Shared mock factory for MeshCentral plugin testing.
// Reused by unit/, process/, flow/, e2e/ tests.

const path = require('path');

/**
 * Build a mock `parent` object that the usertracer.js factory accepts.
 * The structure matches what `pluginHandler.usertracer(parent)` receives:
 *   parent = pluginHandler
 *   parent.parent = meshServer
 *
 * @param {object} opts - { wsagents, wssessions2, nodes, getNodeWithRights, getAccessPermissions, dbEvents, ... }
 * @returns {object} { parent, plugin, captured }
 */
function buildMock(opts = {}) {
    const captured = {
        sent: [],         // messages sent via wssessions2[sid].send
        adminReqs: [],    // calls to handleAdminReq
        purgeDbs: 0,      // calls to db.purgeAll
        timedOut: false,
        debug: [],
    };

    // Default: deny everything unless overridden
    const getNodeWithRights = opts.getNodeWithRights || function (domain, user, nid, cb) {
        cb(null, 0, false);
    };

    // Default: deny all perms (like MeshCentral when no permissions defined)
    // Returns a function that checks permissions, matching the real API shape
    const getAccessPermissions = opts.getAccessPermissions || function (pluginName, user, ctx) {
        return Promise.resolve(function (perm) { return false; });
    };

    // Default db (NeDB-like) - returns events matching nodeids
    const dbEvents = opts.dbEvents || [];
    const dbGetEvents = opts.dbGetEvents || function (query, opts2, cb) {
        let result = dbEvents;
        if (opts2 && opts2.nodeids && opts2.nodeids.length > 0) {
            const filter = new Set(opts2.nodeids);
            result = result.filter(function (e) { return filter.has(e.nodeid); });
        }
        cb(result);
    };

    const webserver = {
        wssessions2: opts.wssessions2 || {},
        wsagents: opts.wsagents || {},
        nodes: opts.nodes || {},
        meshes: opts.meshes || {},
        users: opts.users || {},
        GetNodeWithRights: getNodeWithRights,
        GetAllMeshWithRights: opts.getAllMeshWithRights || function () { return []; },
        send: function (sid, data) {
            captured.sent.push({ sid: sid, data: typeof data === 'string' ? JSON.parse(data) : data });
        },
    };

    // Per-session send override (when caller wants to read responses)
    Object.keys(webserver.wssessions2).forEach(function (sid) {
        if (typeof webserver.wssessions2[sid].send !== 'function') {
            webserver.wssessions2[sid].send = function (data) {
                captured.sent.push({ sid: sid, data: typeof data === 'string' ? JSON.parse(data) : data });
            };
        }
    });

    const meshServer = {
        debug: function () { captured.debug.push(Array.from(arguments)); },
        webserver: webserver,
        parent: opts.meshParent || { config: { settings: { managealldevicegroups: opts.manageAllDeviceGroups || [] } } },
        db: opts.meshDB || null,
        parentpath: opts.parentpath || path.resolve(__dirname, '../../node_modules'),
        dispatchEventToAgent: opts.dispatchEventToAgent || function () {},
        DispatchEvent: opts.dispatchEvent || function () {},
        GetConnectivityState: opts.getConnectivityState || function () { return null; },
    };

    const parent = {
        parent: meshServer,
        registerPermissions: opts.registerPermissions || function () {},
        getAccessPermissions: getAccessPermissions,
        pluginHandler: opts.pluginHandler || null,
        pluginPermissions: opts.pluginPermissions || null,
        wrapFunctionCall: opts.wrapFunctionCall || function () {},
    };

    return { parent, meshServer, webserver, captured };
}

/**
 * Construct a user object matching MeshCentral schema.
 * @param {object} opts - { siteadmin, links, _id, domain }
 */
function buildUser(opts = {}) {
    return Object.assign({
        _id: 'user//domain/' + (opts.name || 'tester'),
        siteadmin: 0,
        links: {},
        domain: 'domain',
        name: opts.name || 'tester',
    }, opts);
}

/**
 * Construct a node doc matching MeshCentral schema.
 */
function buildNode(opts = {}) {
    return Object.assign({
        _id: 'node//domain/' + (opts.id || 'node1'),
        name: opts.name || opts.id || 'node1',
        domain: 'domain',
        meshid: 'mesh//domain/mesh1',
        mtype: 2,        // Windows
        host: opts.host || 'host1',
        ip: opts.ip || '192.168.1.10',
        users: opts.users || [],
        lusers: opts.lusers || [],
        pwr: opts.pwr !== undefined ? opts.pwr : 1,
        conn: opts.conn !== undefined ? opts.conn : 1,
        lastconnect: opts.lastconnect || Date.now() / 1000,
        osdesc: opts.osdesc || 'Windows 11',
    }, opts);
}

/**
 * Common MESHRIGHT_* bitmask constants from webserver.js:150-174.
 */
const MESHRIGHT = {
    EDITMESH: 0x00000001,
    MANAGEUSERS: 0x00000002,
    MANAGECOMPUTERS: 0x00000004,
    REMOTECONTROL: 0x00000008,
    AGENTCONSOLE: 0x00000010,
    SERVERFILES: 0x00000020,
    WAKEDEVICE: 0x00000040,
    SETNOTES: 0x00000080,
    REMOTEVIEWONLY: 0x00000100,
    DEVICEDETAILS: 0x00100000,
    ADMIN: 0xFFFFFFFF,
};

module.exports = { buildMock, buildUser, buildNode, MESHRIGHT };