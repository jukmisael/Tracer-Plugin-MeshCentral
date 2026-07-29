'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMock, buildUser } = require('../_helpers/mock-meshcentral');

const factory = require('../../usertracer.js').usertracer;

// =============================================================================
// _getSessionUser
// =============================================================================

test('_getSessionUser: returns user from wssessions2[sid].user', () => {
    const user = buildUser({ name: 'alice', siteadmin: 0 });
    const { parent, captured } = buildMock({
        wssessions2: { 'sid-1': { user: user } },
    });
    const obj = factory(parent);
    assert.equal(obj._getSessionUser('sid-1'), user);
});

test('_getSessionUser: returns null if session missing', () => {
    const { parent } = buildMock({ wssessions2: {} });
    const obj = factory(parent);
    assert.equal(obj._getSessionUser('sid-missing'), null);
});

test('_getSessionUser: returns null if session has no user', () => {
    const { parent } = buildMock({ wssessions2: { 'sid-1': {} } });
    const obj = factory(parent);
    assert.equal(obj._getSessionUser('sid-1'), null);
});

test('_getSessionUser: returns null if webserver missing', () => {
    const { parent } = buildMock({});
    parent.parent.webserver = null;
    const obj = factory(parent);
    assert.equal(obj._getSessionUser('sid-1'), null);
});

// =============================================================================
// _isAdminFull
// =============================================================================

test('_isAdminFull: returns true for siteadmin=0xFFFFFFFF', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    assert.equal(obj._isAdminFull({ siteadmin: 0xFFFFFFFF }), true);
});

test('_isAdminFull: returns false for siteadmin=0', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    assert.equal(obj._isAdminFull({ siteadmin: 0 }), false);
});

test('_isAdminFull: returns false for partial siteadmin (e.g. only 0x80000000)', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    assert.equal(obj._isAdminFull({ siteadmin: 0x80000000 }), false);
});

test('_isAdminFull: null/undefined user → falsy', () => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    assert.ok(!obj._isAdminFull(null));
    assert.ok(!obj._isAdminFull(undefined));
});

// =============================================================================
// _filterAccessibleNodeIds
// =============================================================================

test('_filterAccessibleNodeIds: returns empty if user is null', (t, done) => {
    const { parent } = buildMock({});
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(null, ['node1'], function (result) {
        assert.deepEqual(result, []);
        done();
    });
});
test('_filterAccessibleNodeIds: admin full bypass total (sem GetNodeWithRights)', (t, done) => {
    const user = buildUser({ siteadmin: 0xFFFFFFFF });
    // Se GetNodeWithRights for chamado, o teste falha (admin não deveria chegar nele)
    const { parent } = buildMock({
        getNodeWithRights: function () {
            done(new Error('admin full should not call GetNodeWithRights'));
        },
    });
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1', 'node2'], function (result) {
        assert.deepEqual(result, ['node1', 'node2']);
        done();
    });
});
test('_filterAccessibleNodeIds: admin full bypass mesmo sem manageAllDeviceGroups', (t, done) => {
    const user = buildUser({
        siteadmin: 0xFFFFFFFF,
        links: { 'node//domain/n1': { rights: 0xFFFFFFFF }, 'mesh//domain/mesh1': { rights: 0xFFFFFFFF } }
    });
    const { parent } = buildMock({ manageAllDeviceGroups: [] });
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1', 'node2'], function (result) {
        // Admin sempre bypass, retorna o array original
        assert.deepEqual(result, ['node1', 'node2']);
        done();
    });
});

test('_filterAccessibleNodeIds: non-admin with MESHRIGHT_DEVICEDETAILS → node accepted', (t, done) => {
    const user = buildUser({ siteadmin: 0, links: {} });
    const MESHRIGHT_DEVICEDETAILS = 0x00100000;
    const { parent } = buildMock({
        getNodeWithRights: function (domain, u, nid, cb) {
            cb(null, MESHRIGHT_DEVICEDETAILS, true);
        },
    });
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1', 'node2'], function (result) {
        assert.deepEqual(result, ['node1', 'node2']);
        done();
    });
});

test('_filterAccessibleNodeIds: non-admin without MESHRIGHT_DEVICEDETAILS → node denied', (t, done) => {
    const user = buildUser({ siteadmin: 0, links: {} });
    const { parent } = buildMock({
        getNodeWithRights: function (domain, u, nid, cb) {
            cb(null, 0x00000008, true);  // REMOTECONTROL only, no DEVICEDETAILS
        },
    });
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1'], function (result) {
        assert.deepEqual(result, []);
        done();
    });
});

test('_filterAccessibleNodeIds: visible=false → node denied', (t, done) => {
    const user = buildUser({ siteadmin: 0 });
    const { parent } = buildMock({
        getNodeWithRights: function (domain, u, nid, cb) {
            cb(null, 0x00100000, false);  // rights but not visible
        },
    });
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1'], function (result) {
        assert.deepEqual(result, []);
        done();
    });
});

test('_filterAccessibleNodeIds: mixed access → only accessible returned', (t, done) => {
    const user = buildUser({ siteadmin: 0 });
    const { parent } = buildMock({
        getNodeWithRights: function (domain, u, nid, cb) {
            if (nid === 'node1') cb(null, 0x00100000, true);
            else if (nid === 'node2') cb(null, 0, false);
            else cb(null, 0x00100000, true);
        },
    });
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1', 'node2', 'node3'], function (result) {
        assert.deepEqual(result, ['node1', 'node3']);
        done();
    });
});

test('_filterAccessibleNodeIds: admin full bypass mesmo com nodeIds=null', (t, done) => {
    const user = buildUser({ siteadmin: 0xFFFFFFFF, links: {} });
    const { parent } = buildMock({});
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, null, function (result) {
        // Admin bypass: retorna o input original (null) sem filtrar
        assert.equal(result, null);
        done();
    });
});

test('_filterAccessibleNodeIds: returns empty if GetNodeWithRights API missing', (t, done) => {
    const user = buildUser({ siteadmin: 0 });
    const { parent } = buildMock({});
    parent.parent.webserver.GetNodeWithRights = null;  // remove API
    const obj = factory(parent);
    obj._filterAccessibleNodeIds(user, ['node1'], function (result) {
        assert.deepEqual(result, []);
        done();
    });
});