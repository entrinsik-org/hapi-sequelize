'use strict';


var _ = require('lodash');
var joi = require('joi');
var Boom = require('boom');
var internals = {};

/**
 * Default pre-update lifecycle method. This method may change the update via side effect only. Return values
 * are ignored. This method is called only if an existing entity has been found.
 * @param {Object} request the hapi request
 * @param {Object} instance the updated instance about to be saved
 */
internals.defaultPreUpdate = function (request, instance) {
};

/**
 * Default pre-create lifcycle method. This method may change the update via side effect only. This method is called
 * if the entity has not been found and the route's create option is set to true.
 * @param {Object} request the hapi request
 * @param {Object} instance the new instance about to be saved
 */
internals.defaultPreCreate = function (request, instance) {

};

/**
 * Default post-update lifecycle method. This method may change the update via side effect only. Return values
 * are ignored
 * @param {Object} request the hapi request
 * @param {Object} instance the saved instance
 * @param {Object} reply the hapi reply
 */
internals.defaultPostUpdate = function (request, instance, reply) {

};

internals.defaultPostCreate = function (request, instance, reply) {

};

/**
 * If the request has params then use them in the where by default
 * @param request hapi request
 * @returns Request params object or null if empty
 */
internals.defaultWhere = function (request) {
    return Object.keys(request.params).length > 0 ? request.params : null;
};

/**
 * Options schema to validate
 * @param sequelize Sequelize object
 * @returns {{model: *, where: *, preUpdate: *, postUpdate: *}} options object with defaults for undefined attributes
 */
internals.optionsSchema = function (sequelize) {
    return {
        model: joi.string().required().valid(_.keys(sequelize.models)),
        where: joi.func().default(internals.defaultWhere),
        preUpdate: joi.func().default(internals.defaultPreUpdate),
        preCreate: joi.func().default(internals.defaultPreCreate),
        postUpdate: joi.func().default(internals.defaultPostUpdate),
        postCreate: joi.func().default(internals.defaultPostCreate),
        create: joi.boolean().default(false),
        options: joi.object(),
        scope: joi.alternatives([joi.string(), joi.func(), joi.array().items(joi.string())]).allow(null)
    };
};

/**
 * Creates generic update handler
 * @param sequelize Sequelize object
 * @param route Route to handle
 * @param options Options object
 * @returns {Function} Returns handler function
 */
internals.createHandler = function (sequelize, route, options) {
    joi.validate(options, internals.optionsSchema(sequelize), function (err, validated) {
        if (err) throw new Error('Error in route ' + route.path + ': ' + err.message);
        options = validated;
    });

    var Model = sequelize.model(options.model);
    var newInstance = false;

    return function (req, reply) {
        let scope = _.isFunction(options.scope) ? options.scope(req) : options.scope;
        // non-null/undefined -> force array
        scope = (scope !== null && scope !== undefined) ? [].concat(scope) : scope;

        var ScopedModel = options.hasOwnProperty('scope') ?
            Model.scope(scope) :
            Model;

        var where = options.where(req);

        if (!where || Object.keys(where).length === 0) {
            //If no where conditions are defined at all then findOne() would return an unpredictable result.
            return reply(Boom.badRequest('Request has no conditions. Results would be indeterminate.'));
        }

        //Perform find and update within a transaction
        return sequelize.requiresTransaction(function (t) {
            return ScopedModel.findOne({ where: where, transaction: t })
                .then(function (instance) {
                    if (!instance && !options.create) throw Boom.notFound();

                    return instance || ScopedModel.build(_.merge(where, req.payload));
                })
                .then(function (instance) {
                    //remove any eagerly loaded association models so the payload can reassign the foreignKey if it wants to
                    _.forEach(ScopedModel.associations, function (assoc, key) {
                        delete instance[key];
                    });

                    // handle null payload
                    instance.set(_.assign({}, req.payload));
                    return instance;
                })
                .tap(function (instance) {
                    newInstance = instance.isNewRecord;
                    return newInstance ? options.preCreate(req, instance) : options.preUpdate(req, instance);
                })
                .then(function (instance) {
                    return instance.save(_.assign({}, options.options, { transaction: t }));
                })
                .tap(function (instance) {
                    return newInstance ? options.postCreate(req, instance, reply) : options.postUpdate(req, instance, reply);
                })
                .then(function (instance) {
                    process.nextTick(function () {
                        if (!req.response) reply(null, instance);
                    });
                })
                .catch(reply);
        });
    };
};

module.exports = _.curry(internals.createHandler);