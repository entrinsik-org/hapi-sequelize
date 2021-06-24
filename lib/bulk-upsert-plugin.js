'use strict';

const Sequelize = require('@entrinsik/informer-sequelize');
const _ = require('lodash');
const es = require('ent-streams');
const stream = require('stream');
const util = require('util');
const pgCopyStreams = require('pg-copy-streams');
const { hooks } = require('@entrinsik/informer-sequelize/lib/hooks');
hooks.beforeBulkUpsert = { params: 2 };
hooks.beforeBulkUpsertMerge = { params: 3 };
hooks.afterBulkUpsert = { params: 2 };


exports.plugin = {
    bulkUpsertStream($stream, options) {
        const P = Sequelize.Promise;
        let proceed = true;

        if (
            !$stream ||
            (!($stream instanceof stream.Readable) && !_.isArray($stream))
        )
            return P.reject(
                new Error(
                    `Cannot use Model.bulkUpsertStream() with a non-existing value or with a value that is not a Readable/Highland stream or an Array`
                )
            );
        if (_.isArray($stream) && !$stream.length) return P.resolve(this);

        options = _.assign({ omit: [], idFields: ['id'] }, options);

        const Utils = Sequelize.Utils;
        const createdAtAttr = this._timestampAttributes.createdAt,
            updatedAtAttr = this._timestampAttributes.updatedAt,
            now = Utils.now(this.modelManager.sequelize.options.dialect);

        // foreignTable
        const curTime = Date.now();
        const tempTableName = `temp_${this.tableName}_${curTime}`;

        // Map attributes for serial identification
        const attributes = {};
        for (let attr in this.tableAttributes) {
            // attr is attr.fieldName in sequelize, not attr.field from the db
            attributes[attr] = this.rawAttributes[attr];
            if (this.rawAttributes[attr].field) {
                attributes[this.rawAttributes[attr].field] = this.rawAttributes[
                    attr
                ];
                // if .field on db is different than .fieldName in sequelize, remove .fieldName and leave .field
                if (
                    this.rawAttributes[attr].field !==
                    this.rawAttributes[attr].fieldName
                ) {
                    delete attributes[this.rawAttributes[attr].fieldName];
                }
            }
        }

        // primary key attributes - not omitted & either primaryKey OR a specified 'id' field
        const primaryKeyAttrs = _.filter(
            attributes,
            attr =>
                options.omit.indexOf(attr.field) < 0 &&
                (attr.primaryKey || _.includes(options.idFields, attr.field))
        );
        const onConflictColumns = _.map(
            primaryKeyAttrs,
            pkAttr => `"${pkAttr.field}"`
        ).join(',');

        // for ON CONFLICT DO UPDATE SET (a,b,c) = (x,y,z) ... kick out: explicitly omitted via options, primary key, "createdAt"
        const attrsForUpdate = _.filter(
            attributes,
            attr =>
                options.omit.indexOf(attr.field) < 0 &&
                !attr.primaryKey &&
                attr.field !== createdAtAttr
        );
        const lhsUpdateColumns = _.map(
            attrsForUpdate,
            attr => `"${attr.field}"`
        ).join(',');
        const rhsUpdateColumns = _.map(
            attrsForUpdate,
            attr => {
                if (attr.onConflict === 'DEEP_MERGE')
                    return `jsonb_deep_merge(${this.tableName}."${attr.field}"::jsonb, EXCLUDED."${attr.field}"::jsonb)`;
                return `EXCLUDED."${attr.field}"`;
            }
        ).join(',');

        // attributes being inserted
        const attrsForInsert = _.filter(
            attributes,
            attr => options.omit.indexOf(attr.field) < 0
        );
        const insertColumns = _.map(
            attrsForInsert,
            attr => `"${attr.field}"`
        ).join(',');

        // log & execute
        const query = (conn, sql) => {
            this.sequelize.log(
                `Executing (${conn.uuid || 'default'}): ${
                    _.isString(sql) ? sql : _.get(sql, 'text', sql)
                }`
            );
            return conn.query(sql);
        };

        // create stream-copy target temp table
        const createTempTable = conn =>
            P.resolve(proceed).then(() =>
                query(
                    conn,
                    `CREATE TEMP TABLE "${tempTableName}" (LIKE "${
                        this.tableName
                    }" INCLUDING DEFAULTS) ON COMMIT DROP`
                )
            );
        const createCopyStream = conn =>
            P.resolve(proceed).then(() =>
                query(
                    conn,
                    pgCopyStreams.from(
                        `COPY "${tempTableName}" (${insertColumns}) FROM STDIN WITH (FORMAT csv)`
                    )
                )
            );

        // build model instance from record so validation & hooks fire
        const buildInstance = record => {
            const instance = this.build(record, { isNewRecord: true });
            // set createdAt/updatedAt attributes
            if (createdAtAttr && !record[createdAtAttr]) {
                instance.dataValues[createdAtAttr] = now;
            }
            if (updatedAtAttr && !record[updatedAtAttr]) {
                instance.dataValues[updatedAtAttr] = now;
            }
            return instance;
        };

        // ensure all attributes are on the record and their record values are properly formatted as postgres expects for CSV format COPY when defined & non-null
        const ensureCsvRecordValues = (rec, attrs) => {
            _.forEach(attrs, attr => {
                let val = rec[attr.field];
                if (_.isUndefined(val)) {
                    // undefined -> null
                    val = null;
                } else if (val !== null) {
                    // only stringify defined non-null values ('null' in postgres CSV format is treated as the literal string)
                    val = attr.type.stringify(
                        val,
                        _.merge(
                            {},
                            this.QueryInterface.QueryGenerator.options,
                            options
                        )
                    );
                }
                _.set(rec, attr.field, val);
            });
            return rec;
        };

        // ensure record correctly maps values to column names
        const ensureFields = rec => {
            let rawAttribute;
            for (let attr in rec) {
                if (rec.hasOwnProperty(attr)) {
                    rawAttribute = this.rawAttributes[attr];

                    // sequelize always thinks there is an id even if none is mapped
                    if (!rawAttribute) {
                        delete rec[attr];
                    } else if (
                        rawAttribute.field &&
                        rawAttribute.field !== rawAttribute.fieldName
                    ) {
                        rec[this.rawAttributes[attr].field] = rec[attr];
                        delete rec[attr];
                    }
                }
            }
        };

        const streamError = err => _.set(err, '_streamError', true);

        // build csv stream
        const getCsvStream = ($source, $target) =>
            es.pipeline(
                $source,
                // build model instances so hooks & validations happen
                es.mapSync(record => buildInstance(record)),
                // Recreate record from instances to represent any changes made in hooks or validation, remove virtual attributes
                es.mapSync(instance =>
                    _.omit(instance.dataValues, this._virtualAttributes)
                ),
                // Map field names to column names
                es.eachSync(rec => ensureFields(rec)),
                // ensure record has a value for all attributes
                es.mapSync(rec => ensureCsvRecordValues(rec, attrsForInsert)),
                // CSV-ify the record. make sure attributes are ordered properly
                es.csv({
                    sendHeaders: false,
                    headers: _.pluck(attrsForInsert, 'field')
                }),
                es.stringify(),
                $target
            );

        // // stream-copy csv stream -> temp table
        const streamCopy = (conn, $copy) =>
            P.resolve(proceed)
                .then(
                    () =>
                        new P((resolve, reject) => {
                            getCsvStream($stream, $copy)
                                .on('error', err => reject(streamError(err)))
                                .on('end', () => resolve());
                        })
                )
                .finally(() => $copy.end());

        // INSERT INTO <model>(<insertColumns>) SELECT <insertColumns> FROM <foreignTable> ON CONFLICT (<primaryKeyColumns>) DO UPDATE SET (<nonConstraintColumns>) = (EXCLUDED.<nonConstraintColumns>)
        const insertOnConflict = conn =>
            P.resolve(proceed).then(() =>
                query(
                    conn,
                    `INSERT INTO "${
                        this.tableName
                    }"(${insertColumns}) SELECT ${insertColumns} FROM ${tempTableName} ON CONFLICT (${onConflictColumns}) DO UPDATE SET (${lhsUpdateColumns}) = ${
                        attrsForUpdate.length > 1 ? '' : 'ROW'
                    }(${rhsUpdateColumns})`
                )
            );

        // get connection off of current transaction or from connection manager
        const getConnection = () => {
            let conn;
            return new P(resolve =>
                P.resolve(proceed)
                    .then(
                        () =>
                            _.get(options, ['transaction', 'connection']) ||
                            this.sequelize.connectionManager.getConnection(
                                options
                            )
                    )
                    .tap(c => (conn = c))
                    .then(resolve)
            ).disposer(() => {
                // only release connection if not within transaction
                if (!conn || options.transaction) return;
                return this.sequelize.connectionManager.releaseConnection(conn);
            });
        };

        // format non-source stream errors with sequelize dialect. forward other errors
        const formatError = (err, conn) =>
            P.reject(
                !!err._streamError
                    ? err
                    : new this.sequelize.dialect.Query(
                          conn,
                          this.sequelize,
                          _.merge(options, { raw: true })
                      ).formatError(err)
            );

        $stream = es
            .streamify($stream)
            .on('error', err => (proceed = P.reject(streamError(err))));

        return P.using(getConnection(), conn =>
            P.resolve(proceed)
                .tap(() => this.runHooks('beforeBulkUpsert', options))
                .tap(() => createTempTable(conn))
                .then(() => createCopyStream(conn))
                .tap($copy => streamCopy(conn, $copy))
                .tap(() => this.runHooks('beforeBulkUpsertMerge', options, tempTableName))
                .then(() => insertOnConflict(conn))
                .catch(err => formatError(err, conn))
                .finally(() => this.runHooks('afterBulkUpsert', options))
        );
    },

    bulkUpsert(records, options) {
        const P = Sequelize.Promise;
        if (!records || !records.length) return Sequelize.Promise.resolve(this);

        options = options || {};
        const Utils = Sequelize.Utils;
        const self = this,
            createdAtAttr = this._timestampAttributes.createdAt,
            updatedAtAttr = this._timestampAttributes.updatedAt,
            now = Utils.now(self.modelManager.sequelize.options.dialect);

        // build DAOs
        const instances = records.map(function(values) {
            const instance = self.build(values, { isNewRecord: true });
            // set createdAt/updatedAt attributes
            if (createdAtAttr && !values[createdAtAttr]) {
                instance.dataValues[createdAtAttr] = now;
            }
            if (updatedAtAttr && !values[updatedAtAttr]) {
                instance.dataValues[updatedAtAttr] = now;
            }
            return instance;
        });

        options.omit = options.omit || [];
        options.idFields = options.idFields || ['id'];

        // Create all in one query
        // Recreate records from instances to represent any changes made in hooks or validation
        records = instances.map(function(instance) {
            return _.omit(instance.dataValues, self._virtualAttributes);
        });

        let rawAttribute;
        // Map field names
        records.forEach(function(values) {
            for (let attr in values) {
                if (values.hasOwnProperty(attr)) {
                    rawAttribute = self.rawAttributes[attr];

                    // sequelize always thinks there is an id even if none is mapped
                    if (!rawAttribute) {
                        delete values[attr];
                    } else if (
                        rawAttribute.field &&
                        rawAttribute.field !== rawAttribute.fieldName
                    ) {
                        values[self.rawAttributes[attr].field] = values[attr];
                        delete values[attr];
                    }
                }
            }
        });

        // Map attributes for serial identification
        const attributes = {};
        for (let attr in self.tableAttributes) {
            attributes[attr] = self.rawAttributes[attr];
            if (self.rawAttributes[attr].field) {
                attributes[self.rawAttributes[attr].field] =
                    self.rawAttributes[attr];
                // if attr.field on db is different than attr.fieldName in sequelize, remove it
                if (
                    this.rawAttributes[attr].field !==
                    this.rawAttributes[attr].fieldName
                ) {
                    delete attributes[this.rawAttributes[attr].fieldName];
                }
            }
        }

        const tempTableName = this.tableName + '_' + new Date().getTime();

        const updateAttrs = _(attributes)
            .filter(function(attr) {
                return (
                    options.omit.indexOf(attr.field) < 0 &&
                    !attr.primaryKey &&
                    attr.field !== createdAtAttr
                );
            })
            .value();

        const lhs = updateAttrs.map(attr => `"${attr.field}"`).join(',');
        const rhs = updateAttrs.map(function (attr) {
            if(attr.onConflict === 'DEEP_MERGE') {
                return `jsonb_deep_merge(t."${attr.field}"::jsonb, s."${attr.field}"::jsonb)`;
            }
            return `s."${attr.field}"`;
        }).join(',');

        const insertAttrs = _(attributes)
            .filter(function(attr) {
                return options.omit.indexOf(attr.field) < 0;
            })
            .map(function(attr) {
                return '"' + attr.field + '"';
            })
            .join(',');

        const idFields = options.idFields.map(
            f => (this.rawAttributes[f] && this.rawAttributes[f].field) || f
        );
        const where = idFields.map(f => `t."${f}" = s."${f}"`).join(' and ');

        const updateQuery = util.format(
            `WITH upd AS (UPDATE "%s" t SET (%s) = ${
                updateAttrs.length > 1 ? '' : 'ROW'
            }(%s) FROM %s s WHERE %s RETURNING s."%s")`,
            this.tableName,
            lhs,
            rhs,
            tempTableName,
            where,
            idFields[0]
        );

        const insertQuery = util.format(
            'INSERT INTO "%s"(%s) SELECT %s FROM %s s LEFT JOIN upd t USING ("%s") WHERE t."%s" iS NULL',
            this.tableName,
            insertAttrs,
            insertAttrs,
            tempTableName,
            idFields[0],
            idFields[0]
        );

        const upsertQuery = util.format('%s %s', updateQuery, insertQuery);

        return P.resolve()
            .then(() => this.runHooks('beforeBulkUpsert', options))
            .then(() =>
                 this.sequelize
                    .query(
                        util.format(
                            'CREATE TEMP TABLE "%s" (LIKE "%s" INCLUDING DEFAULTS) ON COMMIT DROP',
                            tempTableName,
                            this.tableName
                        ),
                        _.merge(options, { raw: true })
                    )
            )
            .then(function() {
                // Insert all records at once
                return self.QueryInterface.bulkInsert(
                    tempTableName,
                    records,
                    _.merge(options, { returning: false }),
                    attributes
                );
            })
            .tap(() => this.runHooks('beforeBulkUpsertMerge', options, tempTableName))
            .then(function() {
                return self.sequelize.query(
                    upsertQuery,
                    _.merge(options, { raw: true })
                );
            })
            .finally(() => this.runHooks('afterBulkUpsert', options));
    }
};