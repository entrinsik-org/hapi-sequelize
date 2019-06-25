'use strict';

const _ = require('lodash');

module.exports = function patchUpsert(sequelize) {
    const {Utils, QueryTypes} = sequelize.Sequelize;

    sequelize.Sequelize.Model.prototype.pgUpsert = function (values, options) {
        options = Utils.cloneDeep(options) || {};

        if (!options.fields) {
            options.fields = Object.keys(this.attributes);
            options.model = this;
        }

        var createdAtAttr = this._timestampAttributes.createdAt
            , updatedAtAttr = this._timestampAttributes.updatedAt
            , hadPrimary = this.primaryKeyField in values || this.primaryKeyAttribute in values
            , instance = this.build(values);

        options.instance = instance;

        return instance.hookValidate(options).bind(this).then(function () {
            // Map field names
            var updatedDataValues = _.pick(instance.dataValues, Object.keys(instance._changed))
                , insertValues = Utils.mapValueFieldNames(instance.dataValues, options.fields, this)
                , updateValues = Utils.mapValueFieldNames(updatedDataValues, options.fields, this)
                , now = Utils.now(this.sequelize.options.dialect);

            // Attach createdAt
            if (createdAtAttr && !updateValues[createdAtAttr]) {
                insertValues[createdAtAttr] = this.$getDefaultTimestamp(createdAtAttr) || now;
            }
            if (updatedAtAttr && !insertValues[updatedAtAttr]) {
                insertValues[updatedAtAttr] = updateValues[updatedAtAttr] = this.$getDefaultTimestamp(updatedAtAttr) || now;
            }

            // Build adds a null value for the primary key, if none was given by the user.
            // We need to remove that because of some Postgres technicalities.
            if (!hadPrimary && this.primaryKeyAttribute && !this.rawAttributes[this.primaryKeyAttribute].defaultValue) {
                delete insertValues[this.primaryKeyField];
                delete updateValues[this.primaryKeyField];
            }

            return this.QueryInterface.pgUpsert(instance, this.getTableName(options), insertValues, updateValues, options);
        });
    };

    sequelize.queryInterface.pgUpsert = function (instance, tableName, insertValues, updateValues, options) {
        options = _.clone(options);

        // Lets combine uniquekeys and indexes into one
        const indexes = Utils._.map(instance.Model.options.uniqueKeys, function (value) {
            return value.fields;
        });

        options.type = QueryTypes.INSERT;
        options.conflictTarget = options.conflictTarget || indexes[0];

        const sql = this.QueryGenerator.pgUpsertQuery(instance, tableName, insertValues, updateValues, options);
        return this.sequelize.query(sql, options).then(function (result) {
            return result;
        });
    };

    sequelize.queryInterface.QueryGenerator.pgUpsertQuery = function (instance, tableName, insertValues, updateValues, options) {
        const rawAttributes = instance.Model.rawAttributes;
        let insertQuery = this.insertQuery(tableName, insertValues, rawAttributes);
        insertQuery = insertQuery.substring(0, insertQuery.lastIndexOf(';'));
        const updateQuery = _(updateValues).map((value, field) => {
            if (rawAttributes[field].onConflict === 'DEEP_MERGE' || rawAttributes[field].fieldName === 'settings') {
                const merge = `jsonb_deep_merge(${instance.Model.tableName}."${rawAttributes[field].fieldName}", ${this.escape(value, rawAttributes[field], {context: 'UPDATE'})})`;
                return `${this.quote(rawAttributes[field].fieldName)} = ${merge}`;
            }
            return `${this.quote(rawAttributes[field].fieldName)} = ${this.escape(value, rawAttributes[field], {context: 'UPDATE'})}`;
        }).value();
        const conflictTarget = [].concat(options.conflictTarget);
        return `${insertQuery} ON CONFLICT (${conflictTarget.map(field => this.quote(field)).join(',')}) DO UPDATE SET ${updateQuery.join(', ')} RETURNING *`;
    };
    return sequelize;
};