/**
 * @description User-Device Tracer - Agent-side Windows session monitor
 * @author Misael Filho
 * @license MIT
 * 
 * Runs on each Windows endpoint. Periodically detects logged-in users
 * via `query user` and reports session transitions to the server.
 * Handles multi-session (RDP/TS): tracks all active console + RDP sessions.
 */

"use strict";

var mesh = null;
var pollTimer = null;
var POLL_INTERVAL_MS = 30 * 1000; // 30 seconds between checks
var knownSessions = {}; // { sessionName: { username, state, domain, startTime } }
var debugMode = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbg(str) {
    if (!debugMode) return;
    try {
        var fs = require('fs');
        var logStream = fs.createWriteStream('usertracer-debug.txt', { flags: 'a' });
        logStream.write(new Date().toLocaleString() + ': ' + str + '\n');
        logStream.end();
    } catch (e) { /* silent */ }
}

/** Parse `query user` output into an array of session objects. */
function parseQueryUserOutput(stdout) {
    var lines = stdout.trim().split(/\r?\n/);
    if (lines.length < 2) return []; // header only or empty
    var sessions = [];
    for (var i = 1; i < lines.length; i++) {
        var line = lines[i];
        if (!line.trim()) continue;
        var username = line.substring(0, 22).trim();
        var sessionName = line.substring(22, 42).trim();
        var sessionId = line.substring(42, 47).trim();
        var state = line.substring(47, 57).trim();
        var idleTime = line.substring(57, 70).trim();
        var logonTime = line.substring(70).trim();
        if (!username) continue;
        var domain = '';
        var un = username;
        if (username.indexOf('\\') !== -1) {
            var parts = username.split('\\');
            domain = parts[0];
            un = parts[1];
        } else if (username.indexOf('@') !== -1) {
            var parts = username.split('@');
            un = parts[0];
            domain = parts[1];
        }
        sessions.push({
            raw: username,
            username: un,
            domain: domain,
            sessionName: sessionName,
            sessionId: sessionId,
            state: state,
            idleTime: idleTime,
            logonTime: logonTime
        });
    }
    return sessions;
}

/** Compare current sessions with known sessions and return deltas. */
function computeSessionDeltas(currentSessions) {
    var events = [];
    var currentKeys = {};
    var now = new Date().toISOString();

    // Index ALL current sessions by key — including Disc, so RDP
    // disconnect/reconnect does NOT trigger false login/logout.
    for (var i = 0; i < currentSessions.length; i++) {
        var s = currentSessions[i];
        var key = s.sessionName || s.username + '-' + s.sessionId;
        currentKeys[key] = true;

        if (!knownSessions[key]) {
            // Entirely new session appeared → real login
            events.push({
                type: 'userLogin',
                username: s.username,
                domain: s.domain,
                sessionName: s.sessionName,
                sessionId: s.sessionId,
                state: s.state,
                logonTime: s.logonTime,
                detectedAt: now
            });
            dbg('LOGIN: ' + s.domain + '\\' + s.username + ' on ' + s.sessionName + ' state=' + s.state);
        } else {
            // Session existed before — check state transition
            var prev = knownSessions[key];
            var prevActive = (prev.state.toLowerCase() !== 'disc' && prev.state.toLowerCase() !== '?' && prev.state !== '');
            var currActive = (s.state.toLowerCase() !== 'disc' && s.state.toLowerCase() !== '?' && s.state !== '');
            if (prevActive !== currActive) {
                events.push({
                    type: currActive ? 'sessionReconnected' : 'sessionDisconnected',
                    username: s.username,
                    domain: s.domain,
                    sessionName: s.sessionName,
                    sessionId: s.sessionId,
                    previousState: prev.state,
                    currentState: s.state,
                    detectedAt: now
                });
                dbg('STATE: ' + s.domain + '\\' + s.username + ' ' + prev.state + ' → ' + s.state);
            }
        }
    }

    // Sessions that were in knownSessions but are entirely gone → real logout
    for (var key in knownSessions) {
        if (!currentKeys[key]) {
            var prev = knownSessions[key];
            events.push({
                type: 'userLogout',
                username: prev.username,
                domain: prev.domain,
                sessionName: prev.sessionName,
                sessionId: prev.sessionId,
                previousState: prev.state,
                detectedAt: now
            });
            dbg('LOGOUT: ' + prev.domain + '\\' + prev.username + ' was on ' + (prev.sessionName || '?'));
        }
    }

    // Replace knownSessions with current snapshot (ALL sessions)
    knownSessions = {};
    for (var i = 0; i < currentSessions.length; i++) {
        var s = currentSessions[i];
        var key = s.sessionName || s.username + '-' + s.sessionId;
        knownSessions[key] = s;
    }

    return events;
}
/** Run `query user` and report deltas to the server. */
function pollUserSessions() {
    if (process.platform !== 'win32') return;

    try {
        var exec = require('child_process').exec;
        exec('query user', { timeout: 10000 }, function (err, stdout, stderr) {
            if (err) {
                // 'query user' can exit non-zero with stderr; use what we got
                if (!stdout || stdout.trim().length === 0) {
                    // No output = no sessions at all
                    if (Object.keys(knownSessions).length > 0) {
                        var events = [];
                        for (var key in knownSessions) {
                            var prev = knownSessions[key];
                            events.push({
                                type: 'userLogout',
                                username: prev.username,
                                domain: prev.domain,
                                sessionName: prev.sessionName,
                                sessionId: prev.sessionId,
                                previousState: prev.state,
                                detectedAt: new Date().toISOString()
                            });
                        }
                        knownSessions = {};
                        reportEvents(events);
                    }
                    return;
                }
            }

            if (!stdout || stdout.trim().length === 0) {
                if (Object.keys(knownSessions).length > 0) {
                    var events = [];
                    for (var key in knownSessions) {
                        var prev = knownSessions[key];
                        events.push({
                            type: 'userLogout',
                            username: prev.username,
                            domain: prev.domain,
                            sessionName: prev.sessionName,
                            sessionId: prev.sessionId,
                            previousState: prev.state,
                            detectedAt: new Date().toISOString()
                        });
                    }
                    knownSessions = {};
                    reportEvents(events);
                }
                return;
            }

            var sessions = parseQueryUserOutput(stdout);
            var events = computeSessionDeltas(sessions);
            if (events.length > 0) {
                reportEvents(events);
                sendSnapshot(sessions);
            }
        });
    } catch (e) {
        dbg('pollUserSessions error: ' + (e.message || e));
    }
}


/** Send deltas to the MeshCentral server. */
function reportEvents(events) {
    if (!mesh) return;
    try {
        mesh.SendCommand({
            action: 'plugin',
            plugin: 'usertracer',
            pluginaction: 'sessionEvents',
            events: JSON.stringify(events)
        });
        dbg('Reported ' + events.length + ' event(s) to server');
    } catch (e) {
        dbg('reportEvents error: ' + (e.message || e));
    }
}

/** Send a full session snapshot for graph/timeline reconstruction. */
function sendSnapshot(sessions) {
    if (!mesh) return;
    try {
        mesh.SendCommand({
            action: 'plugin',
            plugin: 'usertracer',
            pluginaction: 'sessionSnapshot',
            sessions: JSON.stringify(sessions),
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        dbg('sendSnapshot error: ' + (e.message || e));
    }
}

// ---------------------------------------------------------------------------
// Agent module interface (called by meshcore)
// ---------------------------------------------------------------------------

/**
 * Entry point from meshcore. Called when the agent receives a plugin command.
 * Also serves as the module initializer when the agent starts.
 */
function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;

    // Initialize known sessions from parent if available
    if (mesh && mesh.info) {
        dbg('Agent initialized. Host: ' + (mesh.info.host || 'unknown'));
    }

    switch (args.pluginaction) {
        case 'startPolling':
            startPolling();
            break;

        case 'stopPolling':
            stopPolling();
            break;

        case 'pollNow':
            pollUserSessions();
            break;

        case 'getStatus':
            // Return current known sessions
            return JSON.stringify(knownSessions);

        case 'setDebug':
            debugMode = (args.value === 'true' || args.value === true);
            return 'Debug mode: ' + debugMode;

        default:
            break;
    }

    return 'OK';
}

function startPolling() {
    if (pollTimer) return;
    // Do an immediate poll on start
    pollUserSessions();
    pollTimer = setInterval(pollUserSessions, POLL_INTERVAL_MS);
    dbg('Polling started (interval: ' + POLL_INTERVAL_MS + 'ms)');
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    dbg('Polling stopped');
}

// Auto-start polling when module loads (agent boot)
if (typeof setInterval !== 'undefined') {
    // Small delay to let meshcore fully initialize
    setTimeout(function () {
        if (process.platform === 'win32') {
            try {
                mesh = require('MeshAgent');
                startPolling();
            } catch (e) {
                // MeshAgent not available yet — will be started via consoleaction later
                dbg('Deferred start (MeshAgent not ready): ' + (e.message || e));
            }
        } else {
            dbg('Non-Windows platform, polling disabled');
        }
    }, 5000);
}
