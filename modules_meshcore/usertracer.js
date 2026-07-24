/**
 * User-Device Tracer — Agent-side Windows session monitor
 * Pattern: ScriptTask's modules_meshcore pattern
 *
 * Runs on each Windows endpoint. Periodically runs `query user`
 * and reports session transitions (login/logout/disconnect/reconnect).
 * Supports RDP/TS multi-session.
 */
"use strict";

var mesh = null;
var pollTimer = null;
var POLL_INTERVAL_MS = 30000;
var knownSessions = {};
var debug_flag = false;

// Debug function (EventLog/ScriptTask pattern)
// Writes to usertracer.txt in agent working directory
// Enable by sending pluginaction 'setDebug' with value 'true'
var dbg = function(str) {
    if (debug_flag !== true) return;
    try {
        var fs = require('fs');
        var logStream = fs.createWriteStream('usertracer.txt', { flags: 'a' });
        logStream.write('\n' + new Date().toLocaleString() + ': ' + str);
        logStream.end('\n');
    } catch (e) {}
};

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

function parseQueryUserOutput(stdout) {
    var lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    var sessions = [];
    for (var i = 1; i < lines.length; i++) {
        var line = lines[i];
        if (!line.trim()) continue;
        var username = line.substring(0, 22).trim();
        var sessionName = line.substring(22, 42).trim();
        var sessionId = line.substring(42, 47).trim();
        var state = line.substring(47, 57).trim();
        if (!username) continue;
        var domain = '';
        if (username.indexOf('\\') !== -1) { domain = username.split('\\')[0]; username = username.split('\\')[1]; }
        else if (username.indexOf('@') !== -1) { domain = username.split('@')[1]; username = username.split('@')[0]; }
        sessions.push({
            username: username, domain: domain,
            sessionName: sessionName, sessionId: sessionId, state: state
        });
    }
    return sessions;
}

function computeDeltas(current) {
    var events = [], now = new Date().toISOString();
    var keys = {};
    for (var i = 0; i < current.length; i++) {
        var s = current[i];
        var key = s.sessionName || s.username + '-' + s.sessionId;
        keys[key] = true;
        if (!knownSessions[key]) {
            events.push({ type: 'userLogin', username: s.username, domain: s.domain, sessionName: s.sessionName, sessionId: s.sessionId, state: s.state, detectedAt: now });
        } else {
            var prev = knownSessions[key];
            var prevActive = (prev.state.toLowerCase() !== 'disc' && prev.state !== '');
            var currActive = (s.state.toLowerCase() !== 'disc' && s.state !== '');
            if (prevActive !== currActive) {
                events.push({ type: currActive ? 'sessionReconnected' : 'sessionDisconnected', username: s.username, domain: s.domain, sessionName: s.sessionName, previousState: prev.state, currentState: s.state, detectedAt: now });
            }
        }
    }
    for (var key in knownSessions) {
        if (!keys[key]) {
            var prev = knownSessions[key];
            events.push({ type: 'userLogout', username: prev.username, domain: prev.domain, sessionName: prev.sessionName, detectedAt: now });
        }
    }
    knownSessions = {};
    for (var i = 0; i < current.length; i++) {
        var s = current[i];
        knownSessions[s.sessionName || s.username + '-' + s.sessionId] = s;
    }
    return events;
}

function pollNow() {
    if (process.platform !== 'win32') { dbg('pollNow: non-Windows, skipping'); return; }
    dbg('pollNow: starting');
    try {
        require('child_process').exec('query user', { timeout: 10000 }, function (err, stdout) {
            if (err) dbg('pollNow: query user error: ' + (err.message || err));
            dbg('pollNow: stdout length=' + (stdout ? stdout.length : 0));
            if (!stdout || stdout.trim().length === 0) {
                if (Object.keys(knownSessions).length > 0) {
                    dbg('pollNow: no sessions, clearing ' + Object.keys(knownSessions).length + ' known');
                    var events = [];
                    for (var key in knownSessions) {
                        var prev = knownSessions[key];
                        events.push({ type: 'userLogout', username: prev.username, domain: prev.domain, sessionName: prev.sessionName, detectedAt: new Date().toISOString() });
                    }
                    knownSessions = {};
                    sendEvents(events);
                } else {
                    dbg('pollNow: no sessions, knownSessions already empty');
                }
                return;
            }
            var sessions = parseQueryUserOutput(stdout);
            dbg('pollNow: parsed ' + sessions.length + ' sessions');
            var events = computeDeltas(sessions);
            if (events.length > 0) { dbg('pollNow: ' + events.length + ' events detected'); sendEvents(events); }
            else { dbg('pollNow: no changes'); }
        });
    } catch (e) { dbg('pollNow: exception: ' + (e.message || e)); }
}

function sendEvents(events) {
    if (!mesh) { dbg('sendEvents: no mesh object'); return; }
    dbg('sendEvents: sending ' + events.length + ' events, nodeid=' + (mesh.info ? (mesh.info._id || mesh.info.nodeid) : 'unknown'));
    try {
        var cmd = {
            action: 'plugin', plugin: 'usertracer',
            pluginaction: 'sessionEvents',
            events: JSON.stringify(events)
        };
        if (mesh.info && (mesh.info._id || mesh.info.nodeid)) {
            cmd.nodeid = mesh.info._id || mesh.info.nodeid;
        }
        mesh.SendCommand(cmd);
        dbg('sendEvents: OK');
    } catch (e) { dbg('sendEvents: error: ' + (e.message || e)); }
}


function startPolling() {
    if (pollTimer) return;
    pollNow();
    pollTimer = setInterval(pollNow, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---------------------------------------------------------------------------
// MeshAgent entry point
// ---------------------------------------------------------------------------

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    dbg('consoleaction: pluginaction=' + args.pluginaction);
    switch (args.pluginaction) {
        case 'startPolling': startPolling(); break;
        case 'stopPolling': stopPolling(); break;
        case 'pollNow': pollNow(); break;
        case 'getStatus': return JSON.stringify(knownSessions);
        case 'setDebug': debug_flag = (args.value === 'true' || args.value === true); dbg('Debug set to ' + debug_flag); return 'Debug: ' + debug_flag;
    }
    return 'OK';
}

// Auto-start on agent boot (delayed to let MeshAgent initialize)
if (typeof setInterval !== 'undefined') {
    setTimeout(function () {
        if (process.platform === 'win32') {
            try { mesh = require('MeshAgent'); startPolling(); } catch (e) {}
        }
    }, 5000);
}
