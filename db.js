/**
 * User-Device Tracer — Database module
 * Armazena eventos de login/logout e dados do plugin.
 * NeDB com fallback chain (ScriptTask pattern).
 */
"use strict";

module.exports.CreateDB = function (meshserver) {
    var obj = {};
    var Datastore = null;

    // Push node_modules path for NeDB resolution
    module.paths.push(require('path').join(meshserver.parentpath, 'node_modules'));

    // NeDB fallback chain (ScriptTask/EventLog pattern)
    try { Datastore = require('@seald-io/nedb'); } catch (ex) {}
    if (Datastore == null) {
        try { Datastore = require('@yetzt/nedb'); } catch (ex) {}
        if (Datastore == null) { Datastore = require('nedb'); }
    }

    // -----------------------------------------------------------------------
    // Events collection — login/logout timeline
    // -----------------------------------------------------------------------
    obj.events = new Datastore({
        filename: meshserver.getConfigFilePath('plugin-usertracer-events.db'),
        autoload: true
    });
    obj.events.setAutocompactionInterval(60000);
    obj.events.ensureIndex({ fieldName: 'nodeid' });
    obj.events.ensureIndex({ fieldName: 'username' });
    obj.events.ensureIndex({ fieldName: 'detectedAt' });

    // -----------------------------------------------------------------------
    // Insert an event
    // -----------------------------------------------------------------------
    obj.addEvent = function (evt) {
        evt.time = new Date();
        if (obj.events.insert) obj.events.insert(evt);
    };

    // -----------------------------------------------------------------------
    // Query events with filters
    // -----------------------------------------------------------------------
    obj.getEvents = function (query, limit, callback) {
        limit = limit || 500;
        if (obj.events.find) {
            obj.events.find(query || {}).sort({ detectedAt: -1 }).limit(limit).exec(function (err, docs) {
                callback(docs || []);
            });
        } else {
            callback([]);
        }
    };

    // -----------------------------------------------------------------------
    // Query events for a specific node
    // -----------------------------------------------------------------------
    obj.getEventsByNode = function (nodeid, limit, callback) {
        obj.getEvents({ nodeid: nodeid }, limit, callback);
    };

    // -----------------------------------------------------------------------
    // Query events by user
    // -----------------------------------------------------------------------
    obj.getEventsByUser = function (username, limit, callback) {
        obj.getEvents({ username: username }, limit, callback);
    };

    // -----------------------------------------------------------------------
    // Aggregate: get all unique users per node (current state)
    // -----------------------------------------------------------------------
    obj.getCurrentUsers = function (callback) {
        // This is a helper — returns the LATEST event per node
        if (obj.events.find) {
            obj.events.find({}).sort({ detectedAt: -1 }).exec(function (err, docs) {
                var byNode = {};
                var docsArr = docs || [];
                for (var i = 0; i < docsArr.length; i++) {
                    var e = docsArr[i];
                    if (!byNode[e.nodeid] || e.detectedAt > byNode[e.nodeid].detectedAt) {
                        byNode[e.nodeid] = e;
                    }
                }
                callback(byNode);
            });
        } else {
            callback({});
        }
    };

    return obj;
};
