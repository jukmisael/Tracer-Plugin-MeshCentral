'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runView } = require('../_helpers/view-runner');

// =============================================================================
// loadTimeline() router tests — views/admin.handlebars
//
// Bug history (v3.5.87):
//   loadTimeline() was referenced in 3 places (onDateChange, resetZoom,
//   zoomTo) but undefined, causing ReferenceError on first click of the
//   reset-zoom button. Fixed by adding a router that delegates to
//   loadXrefUser() / loadXrefDev() based on which xref is active.
//
// Strategy:
//   - Stub loadXrefUser and loadXrefDev in the sandbox BEFORE running the
//     router under test. Verify which one is called based on _reqUser /
//     _reqDev. This tests routing logic without depending on DOM/WebSocket.
//   - Also verify the regression tests for the original call sites
//     (onDateChange, resetZoom, zoomTo) — they must be defined and not
//     throw when invoked with empty cache / no xref.
// =============================================================================

function freshView(opts) {
    return runView('views/admin.handlebars', opts || {});
}

// Install stubs that count how many times loadXrefUser / loadXrefDev
// are called by loadTimeline.
function withStubs(view) {
    view.run([
        'var _calls = { user: 0, dev: 0 };',
        'loadXrefUser = function () { _calls.user++; };',
        'loadXrefDev = function () { _calls.dev++; };'
    ].join('\n'));
}

// =============================================================================
// Function presence (smoke)
// =============================================================================

test('loadTimeline: function is defined', () => {
    const r = freshView();
    assert.equal(typeof r.get('loadTimeline'), 'function');
});

test('regression: onDateChange is defined (called from HTML onchange)', () => {
    const r = freshView();
    assert.equal(typeof r.get('onDateChange'), 'function');
});

test('regression: resetZoom and zoomTo are defined', () => {
    const r = freshView();
    assert.equal(typeof r.get('resetZoom'), 'function');
    assert.equal(typeof r.get('zoomTo'), 'function');
});

// =============================================================================
// Routing logic
// =============================================================================

test('loadTimeline: routes to loadXrefUser when _reqUser is set', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = "DOMAIN\\\\alice"; _reqDev = ""; _xrefPending = "";');

    r.get('loadTimeline')();

    const calls = r.get('_calls');
    assert.equal(calls.user, 1, 'loadXrefUser should be called once');
    assert.equal(calls.dev, 0, 'loadXrefDev should NOT be called');
});

test('loadTimeline: routes to loadXrefDev when _reqDev is set', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = ""; _reqDev = "node//domain/n1"; _xrefPending = "";');

    r.get('loadTimeline')();

    const calls = r.get('_calls');
    assert.equal(calls.user, 0, 'loadXrefUser should NOT be called');
    assert.equal(calls.dev, 1, 'loadXrefDev should be called once');
});

test('loadTimeline: _reqUser wins when both _reqUser and _reqDev are set', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = "DOMAIN\\\\alice"; _reqDev = "node//domain/n1"; _xrefPending = "";');

    r.get('loadTimeline')();

    const calls = r.get('_calls');
    assert.equal(calls.user, 1, 'user should win');
    assert.equal(calls.dev, 0, 'dev should be skipped');
});

test('loadTimeline: shows empty-state when neither _reqUser nor _reqDev is set', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = ""; _reqDev = ""; _xrefPending = ""; document.getElementById("gantt").innerHTML = "";');

    r.get('loadTimeline')();

    const calls = r.get('_calls');
    assert.equal(calls.user, 0);
    assert.equal(calls.dev, 0);
    const gantt = r.sandbox.document.getElementById('gantt');
    assert.ok(gantt.innerHTML.indexOf('Selecione') >= 0,
        'gantt should show "Selecione um usuário ou dispositivo" placeholder');
});

// =============================================================================
// Original bug surface: onDateChange, resetZoom, zoomTo must not throw
// ReferenceError. With empty cache + no xref, they all funnel through
// loadTimeline() (router) which shows the empty-state.
// =============================================================================

test('regression: onDateChange() does not throw "loadTimeline is not defined"', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = ""; _reqDev = ""; _eventsCache = []; _viewRange = null;');
    assert.doesNotThrow(function () { r.get('onDateChange')(); });
});

test('regression: resetZoom() with empty cache does not throw', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = ""; _reqDev = ""; _eventsCache = []; _viewRange = null;');
    assert.doesNotThrow(function () { r.get('resetZoom')(); });
});

test('regression: zoomTo() with empty cache does not throw', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = ""; _reqDev = ""; _eventsCache = []; _viewRange = null;');
    assert.doesNotThrow(function () {
        r.get('zoomTo')(Date.now() - 500, Date.now() + 500);
    });
});

test('regression: resetZoom with empty cache + active _reqUser routes through loadXrefUser', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = "DOMAIN\\\\alice"; _reqDev = ""; _eventsCache = []; _viewRange = null;');
    r.get('resetZoom')();
    const calls = r.get('_calls');
    assert.equal(calls.user, 1, 'resetZoom(emptyCache + reqUser) should trigger loadXrefUser');
});

test('regression: zoomTo with empty cache + active _reqDev routes through loadXrefDev', () => {
    const r = freshView();
    withStubs(r);
    r.run('_reqUser = ""; _reqDev = "node//domain/n1"; _eventsCache = []; _viewRange = null;');
    r.get('zoomTo')(Date.now() - 500, Date.now() + 500);
    const calls = r.get('_calls');
    assert.equal(calls.dev, 1, 'zoomTo(emptyCache + reqDev) should trigger loadXrefDev');
});