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
    // Query events with filters — supports date range
    // -----------------------------------------------------------------------
    obj.getEvents = function (query, opts, callback) {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        var limit = opts.limit || 500;
        var range = {};
        if (opts.startDate || opts.endDate) {
            range.detectedAt = {};
            if (opts.startDate) range.detectedAt.$gte = opts.startDate;
            if (opts.endDate) range.detectedAt.$lte = opts.endDate;
        }
        var q = query || {};
        if (range.detectedAt) q.detectedAt = range.detectedAt;
        if (opts.nodeids && opts.nodeids.length > 0) {
            q.nodeid = { $in: opts.nodeids };
        }
        if (obj.events.find) {
            obj.events.find(q).sort({ detectedAt: -1 }).limit(limit).exec(function (err, docs) {
                callback(docs || []);
            });
        } else {
            callback([]);
        }
    };

    obj.getEventsByNode = function (nodeid, opts, callback) {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        opts.nodeids = [nodeid];
        obj.getEvents({}, opts, callback);
    };

    // -----------------------------------------------------------------------
    // Get unique device names for filter dropdown
    // -----------------------------------------------------------------------
    obj.getDeviceNames = function (callback) {
        if (obj.events.find) {
            obj.events.find({}).sort({ detectedAt: -1 }).exec(function (err, docs) {
                var devices = {}, result = [];
                (docs || []).forEach(function(e) {
                    if (e.nodeName && !devices[e.nodeName]) {
                        devices[e.nodeName] = true;
                        result.push({ nodeid: e.nodeid, name: e.nodeName });
                    }
                });
                callback(result);
            });
        } else { callback([]); }
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
