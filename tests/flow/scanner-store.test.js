'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMock, injectDb } = require('../_helpers/mock-meshcentral');

const factory = require('../../usertracer.js').usertracer;

// =============================================================================
// Flow tests: scanner → checkNode → storeEvent → db roundtrip
//
// PRODUCTION BEHAVIOR PINS — DO NOT ALTER:
//
// 1. _resolveNodeId + checkNode:
//    [UT] _resolveNodeId: mapped raw="85S93T..." → "node//85S93T..."
//    [UT] checkNode: raw doc = {"users":["BKSSERVICES\\Janio.dionisio"]}
//    [UT] storeEvent: raw evt={"eventType":"userLogin",...}
//    [UT INFO] event stored node=BR-25001 user=BKSSERVICES\J***o type=userLogin
//
//    Scanner lê o doc do MeshCentral via mdb.Get, encontra usuários logados
//    no dispositivo, e armazena eventos de transição no NeDB. O nodeid é
//    normalizado por _resolveNodeId quando vem no formato curto (sem prefixo
//    "node//"). A transição login→lock→unlock→logout deriva dos arrays
//    doc.users (sessão ativa) e doc.lusers (bloqueio) do MeshCentral.
//
//    No primeiro scan, se o usuário está em users E em lusers, o evento
//    gerado é LOCK (não LOGIN) — porque o estado real é "Bloqueado",
//    não "Online". Isso resolve a discrepância entre a UI do MeshCentral
//    (que mostra o ícone de cadeado) e a timeline do plugin.
//
// 2. storeEvent:
//    Eventos inválidos (eventType fora de UT_EVENT) são rejeitados sem crash.
//    Eventos válidos são persistidos via db.addEvent com displayUser, nodeName,
//    detectedAt em ISO, e eventType normalizado (userLogin/userLogout/userLock/userUnlock).
//
// ESTES TESTES SÃO PINADOS — não alterar sem verificar o fluxo real em produção.
// Qualquer mudança aqui reflete uma mudança no comportamento do scanner que
// afeta diretamente quais eventos são armazenados no NeDB.
// =============================================================================

// Helper: build a stub DB that records events
function makeRecordingDb(storedEvents) {
    return {
        getEventsByNode: function (nid, _opts, cb) { cb([]); },  // no history
        addEvent: function (event) { storedEvents.push(event); }
    };
}

// Helper: build mdb.Get mock that returns a node doc
function makeMdbGet(users, lusers, lastconnectSec) {
    return {
        Get: function (nid, cb) {
            if (nid === 'node//domain/n1') {
                cb(null, [{
                    _id: 'node//domain/n1',
                    name: 'BR-24019',
                    users: users,
                    lusers: lusers,
                    pwr: 1,
                    conn: 1,
                    lastconnect: lastconnectSec
                }]);
            } else cb(null, []);
        }
    };
}

// =============================================================================
// Flow 1: scanner emits userLogin on first scan (after recent bounce window)
// =============================================================================

test('flow: scanner detects new user login on a node and stores event', (t, done) => {
    const storedEvents = [];
    const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000;
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['alex'] } },
        mdb: makeMdbGet(['DOMAIN\\alexandre.matias'], [], tenMinAgo)
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;
    obj.checkNode('node//domain/n1');
    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.ok(loginEvts.length >= 1, 'should have a userLogin event');
        assert.equal(loginEvts[0].nodeid, 'node//domain/n1');
        assert.equal(loginEvts[0].nodeName, 'BR-24019');
        done();
    }, 100);
});

// =============================================================================
// Flow 2: scanner emits userLogout when user disappears from doc.users
// =============================================================================

test('flow: scanner detects logout when wsagents shrinks', (t, done) => {
    const storedEvents = [];
    const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000;
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: [] } },
        mdb: makeMdbGet([], [], tenMinAgo)
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;
    // Pre-populate cache as if alice was logged in
    obj.userCache['node//domain/n1'] = JSON.stringify({ users: ['DOMAIN\\alice'], lusers: [] });
    obj.checkNode('node//domain/n1');
    setTimeout(function () {
        const logoutEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogout'; });
        assert.ok(logoutEvts.length >= 1, 'should detect logout');
        done();
    }, 100);
});

// =============================================================================
// Flow 3: full transition: login → lock → unlock → logout
// =============================================================================

test('flow: scanner detects lock transition (login → lock → unlock → logout)', (t, done) => {
    const storedEvents = [];
    const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000;
    const states = [
        { users: ['DOMAIN\\alice'], lusers: [] },                              // step 0: login
        { users: ['DOMAIN\\alice'], lusers: ['DOMAIN\\alice'] },               // step 1: lock
        { users: ['DOMAIN\\alice'], lusers: [] },                              // step 2: unlock
        { users: [], lusers: [] }                                              // step 3: logout
    ];
    let step = 0;
    let currentUsers = states[0].users;
    let currentLusers = states[0].lusers;
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: currentUsers } },
        mdb: {
            Get: function (nid, cb) {
                if (nid === 'node//domain/n1') {
                    cb(null, [{
                        _id: 'node//domain/n1',
                        name: 'BR-24019',
                        users: currentUsers,
                        lusers: currentLusers,
                        pwr: 1,
                        conn: 1,
                        lastconnect: tenMinAgo
                    }]);
                } else cb(null, []);
            }
        }
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;

    function advance() {
        step++;
        currentUsers = states[step].users;
        currentLusers = states[step].lusers;
        obj.checkNode('node//domain/n1');
    }

    obj.checkNode('node//domain/n1');  // step 0: login
    setTimeout(function () {
        advance();  // step 1: lock
        setTimeout(function () {
            advance();  // step 2: unlock
            setTimeout(function () {
                advance();  // step 3: logout
                setTimeout(function () {
                    const types = storedEvents.map(function (e) { return e.eventType; });
                    assert.ok(types.indexOf('userLogin') >= 0, 'should have login');
                    assert.ok(types.indexOf('userLock') >= 0, 'should have lock');
                    assert.ok(types.indexOf('userUnlock') >= 0, 'should have unlock');
                    assert.ok(types.indexOf('userLogout') >= 0, 'should have logout');
                    done();
                }, 300);
            }, 300);
        }, 300);
    }, 300);
});

// =============================================================================
// Flow 4: storeEvent input validation
// =============================================================================

test('flow: storeEvent rejects invalid eventType without crashing', () => {
    const { parent } = buildMock({});
    const obj = injectDb(factory(parent));
    obj.storeEvent('node1', 'node1', 'alice', 'INVALID_TYPE');  // should not throw
});

// =============================================================================
// Flow 5: no event when users array is empty
// =============================================================================

test('flow: scanner skips node with empty users array (no login event)', (t, done) => {
    const storedEvents = [];
    const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000;
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: [] } },
        mdb: makeMdbGet([], [], tenMinAgo)
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;
    obj.checkNode('node//domain/n1');
    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.equal(loginEvts.length, 0, 'no login event for empty users');
        done();
    }, 100);
});

// =============================================================================
// Flow 6: bounce protection — lastconnect < 2 min suppresses first-login event
// =============================================================================

test('flow: scanner suppresses first-login event on recent reconnect (bounce protection)', (t, done) => {
    const storedEvents = [];
    const justNow = Date.now() / 1000;  // < 2 min ago = recent bounce
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['alice'] } },
        mdb: makeMdbGet(['DOMAIN\\alice'], [], justNow)
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;
    obj.checkNode('node//domain/n1');
    setTimeout(function () {
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.equal(loginEvts.length, 0, 'bounce protection: no event when lastconnect < 2 min');
        done();
    }, 100);
});

// =============================================================================
// Flow 7: idem-potency — same state twice produces no duplicate events
// =============================================================================

// =============================================================================
// Flow 7: primeira varredura com usuário já bloqueado (lusers não vazio)
// Deve gerar LOCK, não LOGIN — alinhado com a UI do MeshCentral que
// mostra "Bloqueado" com ícone de cadeado.
// =============================================================================

test('flow: first scan with locked user emits userLock instead of userLogin', (t, done) => {
    const storedEvents = [];
    const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000;
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['DOMAIN\\alice'] } },
        mdb: makeMdbGet(['DOMAIN\\alice'], ['DOMAIN\\alice'], tenMinAgo)
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;
    obj.checkNode('node//domain/n1');
    setTimeout(function () {
        const lockEvts = storedEvents.filter(function (e) { return e.eventType === 'userLock'; });
        const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
        assert.ok(lockEvts.length >= 1, 'locked user on first scan should emit userLock, got ' + JSON.stringify(storedEvents));
        assert.equal(loginEvts.length, 0, 'should NOT emit userLogin for locked user');
        done();
    }, 100);
});

// =============================================================================
// Flow 8: scanner is idempotent — same state does not emit duplicate events
// =============================================================================

test('flow: scanner is idempotent — same state does not emit duplicate events', (t, done) => {
    const storedEvents = [];
    const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000;
    const { parent } = buildMock({
        wsagents: { 'node//domain/n1': { users: ['alice'] } },
        mdb: makeMdbGet(['DOMAIN\\alice'], [], tenMinAgo)
    });
    const obj = injectDb(factory(parent), makeRecordingDb(storedEvents));
    obj._stopped = false;
    obj.checkNode('node//domain/n1');
    setTimeout(function () {
        obj.checkNode('node//domain/n1');  // second scan: same state
        setTimeout(function () {
            // Should have only 1 login event (first scan), not 2
            const loginEvts = storedEvents.filter(function (e) { return e.eventType === 'userLogin'; });
            assert.equal(loginEvts.length, 1, 'idempotent: same state produces no duplicates');
            done();
        }, 100);
    }, 100);
});