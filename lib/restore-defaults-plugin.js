'use strict';

var joi = require('joi');
var util = require('util');
var _ = require('lodash');

const schema = joi.object().keys({
    onConflict: joi.string().default('DEEP_MERGE'),
    exclude: joi.array().items(joi.string()).single().default([])
});

module.exports = function (opts = {}) {

    opts = joi.attempt(opts, schema);

    return function (Model) {

        Model.attributes._changes = { type: Model.sequelize.Sequelize.JSONB, onConflict: opts.onConflict };
        const idColumn = _(Model.attributes).filter({ primaryKey: true }).map('fieldName').first() || 'id';

        Model.Instance.prototype.restoreDefaults = function restoreDefaults () {
            // nothing to restore
            if (!this._changes && !this._changes.original) return this.sequelize.Promise.resolve(this);

            var update = _.reduce(this._changes.original, function (acc, value, key) {
                acc[key] = value;
                return acc;
            }, { _changes: null });

            return this.Model.update(update, {
                where: { [idColumn]: this[idColumn] },
                returning: true,
                validate: false
            })
                .spread(function (affected, rows) {
                    return rows[0];
                });
        };

        Model.applyLatestChanges = function applyLatestChanges (options) {
            var self = this;

            var attrs = _.reduce(this.attributes, function (acc, attr, name) {
                if (!self._isVirtualAttribute(attr) && name !== '_changes' && !attr.primaryKey) {
                    acc.push(attr);
                }
                return acc;
            }, []);

            var updateExprs = attrs.map(function (attr) {
                var field = self.sequelize.queryInterface.quoteIdentifier(attr.field);
                return util.format('%s = COALESCE(c.%s, m.%s)', field, field, field);
            }).join(', ');

            var castExprs = attrs.map(function (attr) {
                return [
                    self.sequelize.queryInterface.quoteIdentifier(attr.field),
                    attr.type.toString()
                ].join(' ');
            }).join(', ');

            var withQuery = util.format(`WITH changes as (select "%s", c.* from "%s", jsonb_to_record(_changes -> \'current\') as c(%s))`,
                idColumn,
                this.options.tableName,
                castExprs);

            var update = util.format('UPDATE "%s" m SET %s', this.options.tableName, updateExprs);

            var query = util.format(`%s %s FROM changes c WHERE m."%s" = c."%s" and m._changes is not null`, withQuery, update, idColumn, idColumn);
            return this.sequelize.query(query, _.merge(options, { raw: true }));
        };

        Model.options.setterMethods = Model.options.setterMethods || {};

        Model.options.setterMethods._changes = function (value) {
            if (value) {
                //noinspection JSPotentiallyInvalidUsageOfThis
                this.setDataValue('_changes', value);
                _.forEach(value.current, function (change, key) {
                    this[key] = change;
                }.bind(this));
            } else {
                var previous = this.previous('_changes') || {};
                _.forEach(previous.original, function (change, key) {
                    this[key] = change;
                }.bind(this));
                //noinspection JSPotentiallyInvalidUsageOfThis
                this.setDataValue('_changes', null);
            }
        };

        Model.hook('beforeUpdate', function (model) {
            // restoring defaults
            if (model.changed('_changes')) return;

            var fieldsToTrack = _.difference(model.changed(), ['_changes'].concat(opts.exclude));

            if (fieldsToTrack.length === 0) return;

            var changes = _.assign({}, model._changes);
            changes.current = changes.current || {};
            changes.original = changes.original || {};

            fieldsToTrack.forEach(function (field) {
                changes.original[field] = changes.original.hasOwnProperty(field) ? changes.original[field] : model.previous(field);
                changes.current[field] = model[field];
                if (_.isEqual(changes.original[field], changes.current[field])) {
                    delete changes.original[field];
                    delete changes.current[field];
                }
            });

            model.setDataValue('_changes', Object.keys(changes.current).length > 0 || Object.keys(changes.original).length > 0 ? changes : null);
        });

        Model.refreshAttributes();

        return Model;
    };
};