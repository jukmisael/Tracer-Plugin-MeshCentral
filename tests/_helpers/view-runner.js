'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// =============================================================================
// view-runner.js — minimal browser shim for testing Handlebars view scripts.
//
// Extracts the inline <script> from views/*.handlebars, evaluates it in a
// sandbox with a minimal DOM (Map-based element store + key/value input model),
// and exposes the resulting functions and globals for testing.
//
// NOT a full DOM. Functions that require complex DOM (e.g. renderXrefUser
// with stacked cards, sdSync dropdown sync) get stubbed by helpers when
// the test focuses on a specific function (e.g. loadTimeline routing).
// =============================================================================

/**
 * Extract the inline <script>...</script> from a handlebars file.
 * @param {string} viewPath - absolute or repo-relative path to .handlebars
 * @returns {string} - the JS source
 */
function extractScript(viewPath) {
    var src = fs.readFileSync(viewPath, 'utf8');
    var m = src.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('No <script> block in ' + viewPath);
    return m[1];
}

// Minimal DOM element: stores innerHTML, textContent, value, and a list of
// child option elements (for selects).
function makeEl(id, initialValue) {
    var el = {
        id: id,
        innerHTML: '',
        textContent: '',
        value: initialValue || '',
        style: {},
        children: [],
        options: [],
        attributes: {},
        classList: { contains: function () { return false; }, add: function () {}, remove: function () {} },
        contains: function () { return false; },
        getAttribute: function (k) { return el.attributes[k] != null ? el.attributes[k] : null; },
        setAttribute: function (k, v) { el.attributes[k] = String(v); },
        removeAttribute: function (k) { delete el.attributes[k]; },
        addEventListener: function () {},
        removeEventListener: function () {},
        appendChild: function (child) {
            if (child && child.tagName === 'OPTION') el.options.push(child);
            el.children.push(child);
        }
    };
    return el;
}

// Set up a minimal browser sandbox with the elements admin.handlebars expects.
function makeDom() {
    var elements = {};
    var ids = [
        'dStart', 'dEnd', 'tlFilter',
        'gantt', 'sDevices', 'sUsers', 'sEvents',
        'xrefUser', 'xrefDev', 'xrefUserResult', 'xrefDevResult',
        'hintUser', 'hintDev',
        'sdDrop-xrefUser', 'sdDrop-xrefDev', 'sdOpts-xrefUser', 'sdOpts-xrefDev',
        'sdSel-xrefUser', 'sdSel-xrefDev',
        'sdWrap-xrefUser', 'sdWrap-xrefDev',
        'debug'
    ];
    ids.forEach(function (id) {
        var initialVal = '';
        if (id === 'dStart') initialVal = '2026-07-29';
        if (id === 'dEnd') initialVal = '2026-07-29';
        elements[id] = makeEl(id, initialVal);
    });
    // Selects need at least a placeholder option
    elements['xrefUser'].options.push({ value: '', textContent: '— Selecione um usuário —' });
    elements['xrefDev'].options.push({ value: '', textContent: '— Selecione um dispositivo —' });

    return {
        elements: elements,
        document: {
            getElementById: function (id) { return elements[id] || null; },
            addEventListener: function () {},
            createElement: function (tag) {
                return {
                    tagName: tag.toUpperCase(),
                    value: '',
                    textContent: '',
                    style: {},
                    classList: { contains: function () { return false; }, add: function () {}, remove: function () {} },
                    setAttribute: function (k, v) { this.attributes[k] = String(v); },
                    getAttribute: function (k) { return this.attributes[k] || null; },
                    appendChild: function () {},
                    onclick: null,
                    attributes: {}
                };
            }
        },
        window: {
            addEventListener: function () {},
            removeEventListener: function () {}
        },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Date: Date,
        Array: Array,
        Math: Math,
        JSON: JSON,
        Object: Object,
        String: String,
        Number: Number
    };
}

/**
 * Run the script extracted from viewPath in a fresh sandbox.
 * @param {string} viewPath - path to .handlebars
 * @param {object} opts - { ms: { send, socket } | null, captureSend: function }
 * @returns {object} - { ctx, sandbox, expose(name) }
 */
function runView(viewPath, opts) {
    opts = opts || {};
    var script = extractScript(viewPath);
    var sandbox = makeDom();
    sandbox.console = console;

    // Inject ms (MeshCentral handle) — defaults to null so calls are no-ops
    sandbox.ms = opts.ms || null;
    // Track what getUserNames / getDeviceNames / etc would call
    sandbox.captureSend = opts.captureSend || function () {};

    var ctx = vm.createContext(sandbox);
    vm.runInContext(script, ctx, { filename: viewPath });

    return {
        ctx: ctx,
        sandbox: sandbox,
        // Expose a global from the sandbox
        get: function (name) {
            return vm.runInContext(name, ctx);
        },
        // Run a statement in the sandbox context
        run: function (code) {
            return vm.runInContext(code, ctx);
        }
    };
}

module.exports = { extractScript, runView };