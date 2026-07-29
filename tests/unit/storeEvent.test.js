'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMock, buildUser } = require('../_helpers/mock-meshcentral');

const factory = require('../../usertracer.js').usertracer;

// =============================================================================
// serveraction dispatcher
// =============================================================================

test('serveraction: ignores when plugin !== usertracer', () => {
    const { parent, captured } = buildMock({});
    const obj = factory(parent);
    obj.serveraction({ plugin: 'other', pluginaction: 'getTimeline' }, { ws: { sessionId: 'sid-1' } }, {});
    assert.equal(captured.sent.length, 0);  // nothing dispatched
});

test('serveraction: ignores when command missing', () => {
    const { parent, captured } = buildMock({});
    const obj = factory(parent);
    obj.serveraction(null, { ws: { sessionId: 'sid-1' } }, {});
    assert.equal(captured.sent.length, 0);
});

test('serveraction: ignores when sid missing', () => {
    const { parent, captured } = buildMock({});
    const obj = factory(parent);
    obj.serveraction({ plugin: 'usertracer', pluginaction: 'getTimeline' }, {}, {});
    assert.equal(captured.sent.length, 0);
});

test('serveraction: unknown pluginaction → no dispatch (UT_LOG.info)', () => {
    const { parent, captured } = buildMock({});
    const obj = factory(parent);
    obj.serveraction({ plugin: 'usertracer', pluginaction: 'totallyUnknown' }, { ws: { sessionId: 'sid-1' } }, {});
    assert.equal(captured.sent.length, 0);
});

test('serveraction: routes getCurrentUsers to _actionGetCurrentUsers', (t, done) => {
    const user = buildUser({ siteadmin: 0 });
    const { parent, captured } = buildMock({
        wssessions2: { 'sid-1': { user: user } },
        wsagents: {},
        mdb: { Get: function (nid, cb) { cb(null, []); } },
        getNodeWithRights: function (domain, u, nid, cb) { cb(null, 0, false); },
    });
    const obj = factory(parent);
    obj.serveraction({ plugin: 'usertracer', pluginaction: 'getCurrentUsers' }, { ws: { sessionId: 'sid-1' } }, {});
    setImmediate(function () {
        assert.ok(captured.sent.length >= 1, 'should send at least 1 message');
        assert.equal(captured.sent[0].data.method, 'currentUsers');
        assert.deepEqual(captured.sent[0].data.data, []);
        done();
    });
});

test('serveraction: routes getTimeline to _actionGetTimeline', (t, done) => {
    const user = buildUser({ siteadmin: 0 });
    const { parent, captured } = buildMock({
        wssessions2: { 'sid-1': { user: user } },
        dbEvents: [],
    });
    const obj = factory(parent);
    obj.serveraction({ plugin: 'usertracer', pluginaction: 'getTimeline', _reqSeq: 99 }, { ws: { sessionId: 'sid-1' } }, {});
    setImmediate(function () {
        assert.ok(captured.sent.length >= 1, 'should send at least 1 message');
        assert.equal(captured.sent[0].data.method, 'timeline');
        assert.equal(captured.sent[0].data._reqSeq, 99);
        done();
    });
});

test('serveraction: routes getNodeDetails to _actionGetNodeDetails', (t, done) => {
    const user = buildUser({ siteadmin: 0 });
    const { parent, captured } = buildMock({
        wssessions2: { 'sid-1': { user: user } },
        getNodeWithRights: function (d, u, nid, cb) { cb(null, 0, false); },  // deny
    });
    const obj = factory(parent);
    obj.serveraction({ plugin: 'usertracer', pluginaction: 'getNodeDetails', nodeid: 'node//domain/secret' }, { ws: { sessionId: 'sid-1' } }, {});
    setImmediate(function () {
        assert.ok(captured.sent.length >= 1, 'should send at least 1 message');
        assert.equal(captured.sent[0].data.method, 'nodeDetails');
        assert.equal(captured.sent[0].data.data, null);  // denied
        done();
    });
});

test('serveraction: error in handler does not crash', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    // Force an error by passing a sessionId that doesn't resolve
    obj.serveraction({ plugin: 'usertracer', pluginaction: 'getTimeline' }, { ws: { sessionId: null } }, {});
    // No assertion — just verify it doesn't throw
});

// =============================================================================
// _send
// =============================================================================

test('_send: missing session → no crash, UT_LOG.info emitted', () => {
    const { parent, captured } = buildMock({});
    const obj = factory(parent);
    obj._send('sid-nonexistent', { foo: 'bar' });
    assert.equal(captured.sent.length, 0);
});

test('_send: writes JSON to wssessions2[sid].send', () => {
    const { parent, captured } = buildMock({
        wssessions2: { 'sid-1': {} },
    });
    const obj = factory(parent);
    obj._send('sid-1', { hello: 'world' });
    assert.equal(captured.sent.length, 1);
    assert.equal(captured.sent[0].data.hello, 'world');
});

test('_send: handles send() throwing', () => {
    const { parent } = buildMock({
        wssessions2: { 'sid-1': { send: function () { throw new Error('socket closed'); } } },
    });
    const obj = factory(parent);
    obj._send('sid-1', { hello: 'world' });  // should NOT throw
});

// =============================================================================
// getNodeName
// =============================================================================

test('getNodeName: returns wsagents name when available', () => {
    const { parent } = buildMock({
        wsagents: { 'node1': { name: 'BR-24019' } },
    });
    const obj = factory(parent);
    assert.equal(obj.getNodeName('node1'), 'BR-24019');
});

test('getNodeName: returns nid when wsagent not found', () => {
    const { parent } = buildMock({ wsagents: {} });
    const obj = factory(parent);
    assert.equal(obj.getNodeName('node1'), 'node1');
});

test('getNodeName: returns nid when wsagents undefined', () => {
    const { parent } = buildMock({});
    delete parent.parent.webserver.wsagents;
    const obj = factory(parent);
    assert.equal(obj.getNodeName('node1'), 'node1');
});

test('getNodeName: returns nid on throw', () => {
    const { parent } = buildMock({});
    parent.parent.webserver.wsagents = null;  // cause throw on .name access
    const obj = factory(parent);
    assert.equal(obj.getNodeName('node1'), 'node1');
});

// =============================================================================
// exports
// =============================================================================

test('exports: exposes onDeviceRefreshEnd', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    assert.ok(Array.isArray(obj.exports));
    assert.ok(obj.exports.indexOf('onDeviceRefreshEnd') >= 0);
});

test('exports: exposes WS message stubs (currentUsers, nodeDetails, purgeResult, timeline, deviceNames, userNames)', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    // These exist so the upstream pluginHandler dispatch
    // (default.handlebars:4172 — pluginHandler[plugin][method])
    // doesn't throw TypeError when our server-side _send broadcasts
    // these messages to non-admin MeshCentral pages (devices list,
    // device details). The admin page intercepts these via
    // ms.socket.addEventListener directly. ALL 6 broadcast methods
    // must be in exports — admin.handlebars only handles 3 of them
    // (timeline, deviceNames, userNames) and 3 are never rendered
    // anywhere (currentUsers, nodeDetails, purgeResult).
    var expected = ['currentUsers', 'nodeDetails', 'purgeResult', 'timeline', 'deviceNames', 'userNames'];
    expected.forEach(function (m) {
        assert.ok(obj.exports.indexOf(m) >= 0, m + ' in exports');
        assert.equal(typeof obj[m], 'function', m + ' is a function');
    });
});

test('WS message stubs: are no-ops (no crash when called)', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    var methods = ['currentUsers', 'nodeDetails', 'purgeResult', 'timeline', 'deviceNames', 'userNames'];
    methods.forEach(function (m) {
        assert.doesNotThrow(function () { obj[m](); }, m + '() with no args');
        assert.doesNotThrow(function () {
            obj[m]({ action: 'plugin', plugin: 'usertracer', method: m, data: {} });
        }, m + '() with WS payload');
    });
});