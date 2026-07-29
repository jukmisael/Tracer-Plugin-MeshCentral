'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMock, injectDb } = require('../_helpers/mock-meshcentral');

const factory = require('../../usertracer.js').usertracer;

// =============================================================================
// Hook tests: hook_agentCoreIsStable and hook_processAgentData
//
// These hooks are the entry points that trigger checkNode (the scanner).
// Upstream contract (verified in /tmp/MeshCentral):
//   - hook_agentCoreIsStable(meshagent, grandparent) — called once after
//     agent's meshcore loaded. Fires on every agent connect.
//   - hook_processAgentData(command, nodeid) — called for every agent
//     message with action:'plugin'. Can be called many times.
//
// Both hooks debounce checkNode with a 2000ms timeout (delays actual scan
// to avoid agent bounce storms). The implementation cancels pending
// timers on subsequent calls (debounce within 2s window).
// =============================================================================

// Helper: build mdb get that returns a node doc
function makeMdbGet(nodeDoc) {
    return {
        Get: function (nid, cb) {
            if (nid === nodeDoc._id) cb(null, [nodeDoc]);
            else cb(null, []);
        }
    };
}

// =============================================================================
// hook_agentCoreIsStable
// =============================================================================

test('hook_agentCoreIsStable: schedules checkNode after 2s delay', (t, done) => {
    const storedEvents = [];
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['alice'] } }
    });
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function (e) { storedEvents.push(e); }
    });
    obj._stopped = false;
    // mdb.Get returns node doc with alice (so first scan = emit login)
    const mdb = makeMdbGet({
        _id: 'node//domain/n1',
        name: 'BR-24019',
        users: ['DOMAIN\\alice'],
        lusers: [],
        pwr: 1,
        lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
    });
    obj.mdb = mdb;

    // Trigger hook with valid meshagent
    obj.hook_agentCoreIsStable({ nodeid: 'node//domain/n1' }, {});

    // BEFORE 2s: no event yet (debounce in progress)
    setTimeout(function () {
        assert.equal(storedEvents.length, 0, 'before 2s: no event (debounced)');
    }, 100);

    // AFTER 2s: event should be emitted
    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.ok(loginEvts.length >= 1, 'after 2s: should have login event');
        done();
    }, 2400);
});

test('hook_agentCoreIsStable: rejects when myparent is null', () => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    // Should not throw
    obj.hook_agentCoreIsStable(null, {});
    obj.hook_agentCoreIsStable(undefined, {});
});

test('hook_agentCoreIsStable: rejects when myparent.nodeid is missing', () => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    // Should not throw and should not schedule scan
    obj.hook_agentCoreIsStable({}, {});
    obj.hook_agentCoreIsStable({ nodeid: null }, {});
    obj.hook_agentCoreIsStable({ nodeid: '' }, {});
    // No way to verify the timer doesn't fire, but at least no throw
});

test('hook_agentCoreIsStable: rejects when nodeid is not a string', () => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    obj.hook_agentCoreIsStable({ nodeid: 123 }, {});       // number
    obj.hook_agentCoreIsStable({ nodeid: { nested: true } }, {}); // object
    obj.hook_agentCoreIsStable({ nodeid: ['arr'] }, {});   // array
});

test('hook_agentCoreIsStable: error in checkNode is caught (no crash)', (t, done) => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    // mdb.Get throws — _pendingCheck should be caught
    obj.mdb = { Get: function (nid, cb) { throw new Error('boom'); } };
    obj._stopped = false;
    obj.hook_agentCoreIsStable({ nodeid: 'node//domain/n1' }, {});
    setTimeout(function () {
        // No assert — just verify no crash propagated
        done();
    }, 2400);
});

// =============================================================================
// hook_processAgentData
// =============================================================================

test('hook_processAgentData: normalizes nodeid when string', (t, done) => {
    const storedEvents = [];
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['alice'] } }
    });
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function (e) { storedEvents.push(e); }
    });
    obj._stopped = false;
    obj.mdb = makeMdbGet({
        _id: 'node//domain/n1',
        name: 'BR-24019',
        users: ['DOMAIN\\alice'],
        lusers: [],
        pwr: 1,
        lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
    });

    obj.hook_processAgentData({ action: 'plugin', nodeid: 'node//domain/n1' }, 'node//domain/n1');

    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.ok(loginEvts.length >= 1, 'after 2s: should have login event');
        done();
    }, 2400);
});

test('hook_processAgentData: normalizes nodeid when object {nodeid}', (t, done) => {
    const storedEvents = [];
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['bob'] } }
    });
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function (e) { storedEvents.push(e); }
    });
    obj._stopped = false;
    obj.mdb = makeMdbGet({
        _id: 'node//domain/n1',
        name: 'BR-24019',
        users: ['DOMAIN\\bob'],
        lusers: [],
        pwr: 1,
        lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
    });

    // nodeid is object (as in meshagent.js real call)
    obj.hook_processAgentData({ action: 'plugin' }, { nodeid: 'node//domain/n1' });

    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.ok(loginEvts.length >= 1, 'object nodeid normalized correctly');
        done();
    }, 2400);
});

test('hook_processAgentData: normalizes nodeid when object {_id}', (t, done) => {
    const storedEvents = [];
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['carol'] } }
    });
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function (e) { storedEvents.push(e); }
    });
    obj._stopped = false;
    obj.mdb = makeMdbGet({
        _id: 'node//domain/n1',
        name: 'BR-24019',
        users: ['DOMAIN\\carol'],
        lusers: [],
        pwr: 1,
        lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
    });

    obj.hook_processAgentData({ action: 'plugin' }, { _id: 'node//domain/n1' });

    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.ok(loginEvts.length >= 1, '_id fallback normalized correctly');
        done();
    }, 2400);
});

test('hook_processAgentData: ignores when nodeid is null/undefined/object-without-id', () => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    // Should not throw and should not schedule
    obj.hook_processAgentData({}, null);
    obj.hook_processAgentData({}, undefined);
    obj.hook_processAgentData({});
    obj.hook_processAgentData({}, { random: 'no id field' });
    // No assertion — just verify no crash
});

test('hook_processAgentData: debounces — multiple calls within 2s = single checkNode', (t, done) => {
    let checkNodeCalls = 0;
    const storedEvents = [];
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function (e) { storedEvents.push(e); }
    });
    obj._stopped = false;
    // Wrap mdb.Get to count calls
    obj.mdb = {
        Get: function (nid, cb) {
            checkNodeCalls++;
            cb(null, [{
                _id: 'node//domain/n1',
                name: 'BR-24019',
                users: ['DOMAIN\\alice'],
                lusers: [],
                pwr: 1,
                lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
            }]);
        }
    };

    // Fire 5 hook calls in quick succession
    for (var i = 0; i < 5; i++) {
        obj.hook_processAgentData({ action: 'plugin' }, 'node//domain/n1');
    }

    setTimeout(function () {
        // Only 1 checkNode should have happened (debounce)
        assert.equal(checkNodeCalls, 1, '5 hook calls debounced to 1 checkNode');
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.equal(loginEvts.length, 1, 'only 1 login event emitted despite 5 hooks');
        done();
    }, 2400);
});

test('hook_processAgentData: 2nd wave after 2s fires 2nd checkNode', (t, done) => {
    let checkNodeCalls = 0;
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function () {}
    });
    obj._stopped = false;
    obj.mdb = {
        Get: function (nid, cb) {
            checkNodeCalls++;
            cb(null, [{
                _id: 'node//domain/n1',
                name: 'BR-24019',
                users: ['DOMAIN\\alice'],
                lusers: [],
                pwr: 1,
                lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
            }]);
        }
    };

    obj.hook_processAgentData({ action: 'plugin' }, 'node//domain/n1');
    setTimeout(function () {
        obj.hook_processAgentData({ action: 'plugin' }, 'node//domain/n1');
        setTimeout(function () {
            assert.equal(checkNodeCalls, 2, '2 separate waves = 2 checkNode calls');
            done();
        }, 2400);
    }, 2400);
});

test('hook_processAgentData: error in checkNode is caught', (t, done) => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    obj.mdb = { Get: function (nid, cb) { throw new Error('boom'); } };
    obj._stopped = false;
    obj.hook_processAgentData({ action: 'plugin' }, 'node//domain/n1');
    setTimeout(function () {
        // No assertion — just verify no crash
        done();
    }, 2400);
});

test('hook_processAgentData: different nodeids scan independently', (t, done) => {
    let checkNodeCalls = [];
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function () {}
    });
    obj._stopped = false;
    obj.mdb = {
        Get: function (nid, cb) {
            checkNodeCalls.push(nid);
            cb(null, [{
                _id: nid,
                name: 'TEST',
                users: [],
                lusers: [],
                pwr: 1,
                lastconnect: (Date.now() - 10 * 60 * 1000) / 1000
            }]);
        }
    };

    // 2 different nodes
    obj.hook_processAgentData({}, 'node1');
    obj.hook_processAgentData({}, 'node2');

    setTimeout(function () {
        assert.equal(checkNodeCalls.length, 2, 'both nodes scanned');
        assert.ok(checkNodeCalls.indexOf('node1') >= 0 || checkNodeCalls.indexOf('node//node1') >= 0, 'node1 resolved');
        assert.ok(checkNodeCalls.indexOf('node2') >= 0 || checkNodeCalls.indexOf('node//node2') >= 0, 'node2 resolved');
        done();
    }, 2400);
});

// =============================================================================
// Stopped plugin safety
// =============================================================================

test('hook_agentCoreIsStable: no-op when _stopped=true', (t, done) => {
    let checkNodeCalls = 0;
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent), {
        getEventsByNode: function (n, o, cb) { cb([]); },
        addEvent: function () {}
    });
    obj._stopped = true;  // plugind stopped
    obj.mdb = {
        Get: function (nid, cb) {
            checkNodeCalls++;
            cb(null, [{ _id: nid, name: 'X', users: [], lusers: [], pwr: 1 }]);
        }
    };
    obj.hook_agentCoreIsStable({ nodeid: 'node1' }, {});
    setTimeout(function () {
        // Plugin stopped — checkNode should not fire
        assert.equal(checkNodeCalls, 0, 'checkNode did not run');
        done();
    }, 2400);
});