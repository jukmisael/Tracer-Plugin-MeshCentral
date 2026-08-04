/**
 * User-Device Tracer — Database module v3.6.0
 * Suporta NeDB + MongoDB com fallback chain (ScriptTask/EventLog pattern).
 * #7: Fallback suporta MongoDB/SQL
 * #13: addEvent trata erro
 * #14: TTL em eventos (default 90 dias, configurável)
 */
"use strict";

module.exports.CreateDB = function (meshserver) {
    var obj = {};
    obj.backend = 'unknown';
    obj.events = null;
    obj.dbVersion = 2;
    obj.TTL_DAYS = 90; // #14 — TTL default

    var TTL_S = obj.TTL_DAYS * 24 * 60 * 60;
    var Datastore = null;
    var MongoClient = null;
    var ObjectID = null;

    // Push node_modules path para NeDB resolution (EventLog pattern)
    try {
        var path = require('path');
        module.paths.push(path.join(meshserver.parentpath, 'node_modules'));
    } catch (_) {}

    // Fallback chain NeDB (#7)
    try { Datastore = require('@seald-io/nedb'); } catch (e1) {}
    if (!Datastore) { try { Datastore = require('@yetzt/nedb'); } catch (e2) {} }
    if (!Datastore) { try { Datastore = require('nedb'); } catch (e3) {
        console.log('[UT ERROR] NeDB não disponível e nenhum backend alternativo.');
    } }

    var _nedbRecovered = false;
    function initNeDB() {
        if (!Datastore) return;
        try {
            obj.backend = 'nedb';
            obj.events = new Datastore({
                filename: meshserver.getConfigFilePath('plugin-usertracer-events.db'),
                autoload: true,
                corruptAlertThreshold: 0.5  // default 10% é muito conservador — tolera 50% corrupção (recovery em vez de crash loop)
            });
            obj.events.setAutocompactionInterval(300000);  // 5min: reduz write contention com scanner
            obj.events.ensureIndex({ fieldName: 'nodeid' });
            obj.events.ensureIndex({ fieldName: 'username' });
            obj.events.ensureIndex({ fieldName: 'detectedAt' });
            console.log('[UT] NeDB initialized (TTL_DAYS=' + obj.TTL_DAYS + ')');
        } catch (e) {
            console.log('[UT ERROR] NeDB init failed: ' + e.message);
            // Recovery: se corrupção > threshold corrompeu o arquivo durante restart abrupto,
            // deleta o .db e tenta de novo (fresh start, dados perdidos nesse cenário).
            if (!_nedbRecovered && /corrupt/i.test(e.message)) {
                _nedbRecovered = true;
                try {
                    var _fs = require('fs');
                    var _p = meshserver.getConfigFilePath('plugin-usertracer-events.db');
                    console.log('[UT WARN] deleting corrupt db: ' + _p);
                    try { _fs.unlinkSync(_p); } catch (_e1) {}
                    try { _fs.unlinkSync(_p + '~'); } catch (_e2) {}
                    initNeDB();  // retry
                } catch (_recoverE) {
                    console.log('[UT ERROR] recovery failed: ' + _recoverE.message);
                }
            }
        }
    }

    // Detect MongoDB
    if (meshserver.args && meshserver.args.mongodb) {
        try {
            MongoClient = require('mongodb').MongoClient;
            ObjectID = require('mongodb').ObjectID;
        } catch (e) {
            console.log('[UT WARN] MongoDB requested but mongodb module not available, falling back to NeDB');
        }
    }

    if (MongoClient) {
        // -------- MongoDB branch (#7) --------
        MongoClient.connect(meshserver.args.mongodb, { useNewUrlParser: true, useUnifiedTopology: true }, function (err, client) {
            if (err) {
                console.log('[UT ERROR] MongoDB connect failed: ' + err.message + ' — falling back to NeDB');
                initNeDB();
                return;
            }
            try {
                obj.backend = 'mongodb';
                var dbname = 'meshcentral';
                if (meshserver.args.mongodbname) dbname = meshserver.args.mongodbname;
                var db = client.db(dbname);
                obj.events = db.collection('plugin_usertracer_events');
                obj.events.createIndex({ nodeid: 1 });
                obj.events.createIndex({ username: 1 });
                obj.events.createIndex({ detectedAt: 1 }, { expireAfterSeconds: TTL_S });
                console.log('[UT] MongoDB initialized (TTL_S=' + TTL_S + ')');
            } catch (e) {
                console.log('[UT ERROR] MongoDB init failed: ' + e.message);
                initNeDB();
            }
        });
    } else {
        initNeDB();
    }

    // -------- Abstraction helpers (NeDB-compatible)
    function _isMongo() { return obj.backend === 'mongodb'; }
    function _isReady() { return !!obj.events; }
    function _formatId(id) {
        if (_isMongo() && typeof ObjectID === 'function') {
            try { return new ObjectID(id); } catch (_) { return id; }
        }
        return id;
    }

    // #13 — addEvent com tratamento de erro
    obj.addEvent = function (evt, cb) {
        if (!_isReady()) {
            if (cb) cb(new Error('DB not ready'));
            return;
        }
        try {
            evt.time = new Date();
            if (_isMongo()) {
                obj.events.insertOne(evt).then(
                    function () { if (cb) cb(null); },
                    function (err) { console.log('[UT ERROR] addEvent: ' + (err && err.message)); if (cb) cb(err); }
                );
            } else {
                try {
                    obj.events.insert(evt);
                    if (cb) cb(null);
                } catch (e) {
                    console.log('[UT ERROR] addEvent NeDB: ' + e.message);
                    if (cb) cb(e);
                }
            }
        } catch (e) {
            console.log('[UT ERROR] addEvent outer: ' + e.message);
            if (cb) cb(e);
        }
    };

    obj.getEvents = function (query, opts, callback) {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (!_isReady()) { callback([]); return; }
        var limit = (opts && opts.limit) || 500;
        var q = query ? Object.assign({}, query) : {};
        if (opts && (opts.startDate || opts.endDate)) {
            q.detectedAt = {};
            if (opts.startDate) q.detectedAt.$gte = opts.startDate;
            if (opts.endDate) q.detectedAt.$lte = opts.endDate;
        }
        if (opts && opts.nodeids && opts.nodeids.length > 0) {
            q.nodeid = { $in: opts.nodeids };
        }
        if (_isMongo()) {
            obj.events.find(q).sort({ detectedAt: -1 }).limit(limit).toArray(function (err, docs) {
                callback(docs || []);
            });
        } else if (typeof obj.events.find === 'function') {
            obj.events.find(q).sort({ detectedAt: -1 }).limit(limit).exec(function (err, docs) {
                callback(docs || []);
            });
        } else {
            callback([]);
        }
    };

    obj.getEventsByNode = function (nodeid, opts, callback) {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (typeof opts === 'number') { opts = { limit: opts }; }
        if (!opts) opts = {};
        opts.nodeids = [nodeid];
        obj.getEvents({}, opts, callback);
    };

    // Melhora #16 — usar aggregate em MongoDB ao invés de scan
    obj.getDeviceNames = function (callback) {
        if (!_isReady()) { callback([]); return; }
        if (_isMongo() && typeof obj.events.distinct === 'function') {
            // single query: distinct nodeids recentes
            obj.events.aggregate([
                { $match: { nodeid: { $exists: true, $ne: null }, nodeName: { $exists: true, $ne: '' } } },
                { $sort: { detectedAt: -1 } },
                { $group: { _id: '$nodeid', name: { $first: '$nodeName' } } },
                { $limit: 1000 }
            ]).toArray(function (err, docs) {
                if (err) { callback([]); return; }
                callback((docs || []).map(function (d) { return { nodeid: d._id, name: d.name }; }));
            });
        } else if (typeof obj.events.find === 'function') {
            obj.events.find({}).sort({ detectedAt: -1 }).exec(function (err, docs) {
                var devices = {}, result = [];
                (docs || []).forEach(function (e) {
                    if (e.nodeName && !devices[e.nodeName]) {
                        devices[e.nodeName] = true;
                        result.push({ nodeid: e.nodeid, name: e.nodeName });
                    }
                });
                callback(result);
            });
        } else {
            callback([]);
        }
    };

    obj.getEventsByUser = function (username, opts, callback) {
        if (typeof opts === 'function') { callback = opts; opts = {}; }
        if (typeof opts === 'number') { opts = { limit: opts }; }
        obj.getEvents({ username: username }, opts, callback);
    };

    // #16 — agregado nativo no MongoDB
    obj.getUserNames = function (callback) {
        if (!_isReady()) { callback([]); return; }
        if (_isMongo() && typeof obj.events.distinct === 'function') {
            obj.events.aggregate([
                { $match: { displayUser: { $exists: true, $ne: '' } } },
                { $sort: { detectedAt: -1 } },
                { $group: { _id: '$displayUser', username: { $first: '$username' }, domain: { $first: '$domain' } } },
                { $limit: 1000 }
            ]).toArray(function (err, docs) {
                if (err) { callback([]); return; }
                callback((docs || []).map(function (d) {
                    return { username: d.username, displayUser: d._id, domain: d.domain || '' };
                }));
            });
        } else if (typeof obj.events.find === 'function') {
            obj.events.find({}).sort({ detectedAt: -1 }).exec(function (err, docs) {
                var users = {}, result = [];
                (docs || []).forEach(function (e) {
                    if (e.displayUser && !users[e.displayUser]) {
                        users[e.displayUser] = true;
                        result.push({ username: e.username, displayUser: e.displayUser, domain: e.domain });
                    }
                });
                callback(result);
            });
        } else {
            callback([]);
        }
    };

    obj.getCurrentUsers = function (callback) {
        if (!_isReady()) { callback({}); return; }
        if (_isMongo() && typeof obj.events.aggregate === 'function') {
            obj.events.aggregate([
                { $sort: { detectedAt: -1 } },
                { $group: { _id: '$nodeid', username: { $first: '$displayUser' }, detectedAt: { $first: '$detectedAt' }, nodeName: { $first: '$nodeName' } } }
            ]).toArray(function (err, docs) {
                var byNode = {};
                (docs || []).forEach(function (e) {
                    byNode[e._id] = { nodeid: e._id, nodeName: e.nodeName, username: e.username, detectedAt: e.detectedAt };
                });
                callback(byNode);
            });
        } else if (typeof obj.events.find === 'function') {
            obj.events.find({}).sort({ detectedAt: -1 }).exec(function (err, docs) {
                var byNode = {};
                (docs || []).forEach(function (e) {
                    if (!byNode[e.nodeid] || e.detectedAt > byNode[e.nodeid].detectedAt) {
                        byNode[e.nodeid] = e;
                    }
                });
                callback(byNode);
            });
        } else {
            callback({});
        }
    };

    // #10 — purge all
    obj.purgeAll = function (callback) {
        if (!_isReady()) { callback(new Error('DB not ready')); return; }
        try {
            if (_isMongo()) {
                obj.events.deleteMany({}, function (err) { if (callback) callback(err || null); });
            } else {
                obj.events.remove({}, { multi: true }, function (err) {
                    if (callback) callback(err || null);
                });
            }
        } catch (e) { if (callback) callback(e); }
    };

    return obj;
};
