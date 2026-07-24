/**
 * User-Device Tracer — Database module (NeDB + MongoDB compat)
 * Pattern: EventLog's db.js + nemongo.js shim
 */
"use strict";

module.exports.CreateDB = function (meshserver) {
    var obj = {};
    var Datastore = null;

    // Push node_modules path for NeDB resolution (same as ScriptTask)
    module.paths.push(require('path').join(meshserver.parentpath, 'node_modules'));

    if (meshserver.args.mongodb) {
        // MongoDB path
        var mongodb = require('mongodb');
        mongodb.MongoClient.connect(meshserver.args.mongodb, { useNewUrlParser: true, useUnifiedTopology: true }, function (err, client) {
            if (err) { console.log('USERTRACER DB: Unable to connect to MongoDB: ' + err); return; }
            var dbname = meshserver.args.mongodbname || 'meshcentral';
            var db = client.db(dbname);
            obj.events = db.collection('plugin_usertracer_events');
            obj.events.createIndex({ nodeid: 1 });
            obj.events.createIndex({ username: 1 });
            obj.events.createIndex({ detectedAt: 1 });
        });
    } else {
        // NeDB with fallback chain (ScriptTask pattern)
        try { Datastore = require('@seald-io/nedb'); } catch (ex) {}
        if (Datastore == null) {
            try { Datastore = require('@yetzt/nedb'); } catch (ex) {}
            if (Datastore == null) { Datastore = require('nedb'); }
        }
        obj.events = new Datastore({ filename: meshserver.getConfigFilePath('plugin-usertracer-events.db'), autoload: true });
        obj.events.persistence.setAutocompactionInterval(60000);
        obj.events.ensureIndex({ fieldName: 'nodeid' });
        obj.events.ensureIndex({ fieldName: 'username' });
        obj.events.ensureIndex({ fieldName: 'detectedAt' });
    }

    obj.addEvent = function (evt) {
        evt.time = new Date();
        if (obj.events.insert) obj.events.insert(evt);
    };

    obj.addEvents = function (events) {
        for (var i = 0; i < events.length; i++) {
            obj.addEvent(events[i]);
        }
    };

    obj.getEvents = function (query, limit, callback) {
        limit = limit || 200;
        if (obj.events.find) {
            obj.events.find(query || {}).sort({ detectedAt: -1 }).limit(limit).exec(function (err, docs) {
                callback(docs || []);
            });
        } else {
            callback([]);
        }
    };

    obj.getEventsByNode = function (nodeid, limit, callback) {
        obj.getEvents({ nodeid: nodeid }, limit, callback);
    };

    return obj;
};

    obj.addEvent = function (evt) {
        evt.time = new Date();
        if (obj.events.insert) obj.events.insert(evt);
    };

    obj.addEvents = function (events) {
        for (var i = 0; i < events.length; i++) {
            obj.addEvent(events[i]);
        }
    };

    obj.getEvents = function (query, limit, callback) {
        limit = limit || 200;
        if (obj.events.find) {
            obj.events.find(query || {}).sort({ detectedAt: -1 }).limit(limit).exec(function (err, docs) {
                callback(docs || []);
            });
        } else {
            callback([]);
        }
    };

    obj.getEventsByNode = function (nodeid, limit, callback) {
        obj.getEvents({ nodeid: nodeid }, limit, callback);
    };

    obj.getEventsByUser = function (username, limit, callback) {
        obj.getEvents({ username: username }, limit, callback);
    };

    return obj;
};
