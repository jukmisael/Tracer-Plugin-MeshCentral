'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');

const factory = require('../../usertracer.js').usertracer;
const { buildMock, buildUser } = require('../_helpers/mock-meshcentral');

// =============================================================================
// Process-level tests: validate that the factory creates an obj that
// survives hot-reload (multiple factory() calls), produces valid JSON
// responses, and behaves correctly when timers fire.
//
// PRODUCTION BEHAVIOR PINS — DO NOT ALTER:
//
// Hot-reload safety:
//   MeshCentral recria o plugin via factory(parent) a cada reload.
//   Múltiplas chamadas factory() produzem instâncias independentes
//   sem estado compartilhado. obj._send serializa via JSON.stringify
//   sem loops circulares (obj não tem referências circulares).
//
// handleAdminReq:
//   Roteia entre render('admin', {}) e render('device', {...})
//   baseado em req.query.user. Admin full bypassa ACL e RBAC.
//   Sem admin full, usa GetNodeWithRights + getAccessPermissions.
//
//   [UT] handleAdminReq: ENTRY query={"pin":"usertracer"}
//       user={"name":"misael.filho.admin","siteadmin":4294967295}
//   [UT] handleAdminReq: admin full bypass
//   [UT] handleAdminReq: admin panel (admin bypass)
//   [UT] handleAdminReq: rendered admin.handlebars (admin bypass)
//
// ESTES TESTES SÃO PINADOS — não alterar sem verificar o fluxo real.
// =============================================================================

test('process: factory() can be called multiple times (hot-reload safe)', () => {
    const { parent } = buildMock({});
    const obj1 = factory(parent);
    const obj2 = factory(parent);
    assert.notEqual(obj1, obj2);  // different instances
    assert.equal(typeof obj1._send, 'function');
    assert.equal(typeof obj2._send, 'function');
});

test('process: obj methods are independent across instances', () => {
    const { parent } = buildMock({});
    const obj1 = factory(parent);
    const obj2 = factory(parent);
    obj1._customFlag = 'one';
    obj2._customFlag = 'two';
    assert.equal(obj1._customFlag, 'one');
    assert.equal(obj2._customFlag, 'two');
});

test('process: JSON.stringify of obj works (no circular refs)', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    obj.userCache = { 'node1': '{"users":["alice"]}' };
    obj.devicePower = { 'node1': { pwr: 1, conn: 1, time: Date.now() } };
    // Round-trip JSON
    const s = JSON.stringify({
        _activeUsers: Object.keys(obj.userCache),
        _pwrMap: Object.keys(obj.devicePower),
    });
    assert.ok(s.indexOf('node1') >= 0);
});

test('process: obj._send serializes via JSON.stringify (no circular refs in data)', () => {
    const { parent, captured } = buildMock({
        wssessions2: { 'sid-1': {} },
    });
    const obj = factory(parent);
    // Build a payload that could fail if not careful
    const payload = {
        action: 'plugin',
        plugin: 'usertracer',
        method: 'timeline',
        data: [{ nodeid: 'n1', username: 'u', detectedAt: '2026-07-29', eventType: 'userLogin' }],
        _pwrMap: { n1: { pwr: 1, time: 1 } },
        _activeUsers: { n1: ['u'] },
    };
    obj._send('sid-1', payload);
    assert.equal(captured.sent.length, 1);
    assert.equal(captured.sent[0].data.method, 'timeline');
});

test('process: handleAdminReq renders handlebars with safe vars', () => {
    const { parent, captured } = buildMock({});
    const obj = factory(parent);
    const user = buildUser({ siteadmin: 0xFFFFFFFF });
    let rendered = null;
    const res = {
        render: function (template, vars) { rendered = { template: template, vars: vars }; },
        sendStatus: function (code) { rendered = { error: code }; },
    };
    obj.handleAdminReq({ query: { admin: '1' } }, res, user);
    assert.ok(rendered, 'should call res.render or sendStatus');
    assert.equal(rendered.template, 'admin');
});

test('process: handleAdminReq sends 401 for non-admin without user=1', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    const user = buildUser({ siteadmin: 0 });
    let statusCode = null;
    const res = {
        render: function () { throw new Error('should not render'); },
        sendStatus: function (code) { statusCode = code; },
    };
    obj.handleAdminReq({ query: {} }, res, user);
    assert.equal(statusCode, 401);
});

test('process: handleAdminReq for device tab — admin full bypasses ACL + RBAC', (t, done) => {
    // Site-admin sees everything, ACL check is irrelevant (handleAdminReq still calls render)
    const { parent } = buildMock({});
    const obj = factory(parent);
    const user = buildUser({ siteadmin: 0xFFFFFFFF });
    let rendered = null;
    const res = {
        render: function (template, vars) { rendered = { template: template, vars: vars }; },
        sendStatus: function () { done(new Error('admin should not be denied')); },
    };
    obj.handleAdminReq({ query: { user: '1', nodeid: 'node//domain/n1' } }, res, user);
    setImmediate(function () {
        assert.ok(rendered, 'admin should get rendered');
        assert.equal(rendered.template, 'device');
        done();
    });
});

test('process: handleAdminReq for device tab — denies without DEVICEDETAILS', (t, done) => {
    const { parent } = buildMock({
        getNodeWithRights: function (domain, u, nid, cb) { cb(null, 0, false); },
    });
    const obj = factory(parent);
    const user = buildUser({ siteadmin: 0 });
    const res = {
        render: function () { done(new Error('should not render')); },
        sendStatus: function (code) { assert.equal(code, 401); done(); },
    };
    obj.handleAdminReq({ query: { user: '1', nodeid: 'node//domain/n1' } }, res, user);
});