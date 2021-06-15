'use strict';

var joi = require('joi');
var _ = require('lodash');
var Sequelize = require('@entrinsik/informer-sequelize');

var internals = {};

/**
 * Default function for the where clause of the select. Returns the URL
 * parameters as an object
 * @param {Object} request the hapi request
 */
internals.defaultWhere = function (request) {
    return Object.keys(request.params).length > 0 ? request.params : null;
};

/**
 * Default pre-delete operation function used to manipulate the options
 * object that is passed in to the delete function. return values are ignored
 * @param {Object} request the hapi request
 * @param {Object} options the delete options to pass to sequelize
 */
internals.defaultPreDelete = function (request, options) {

};

/**
 * Default post-delete operation function used to manipulate the request
 * based on the result after the delete command has completed. Return values
 * are ignored.
 * @param {Object} request the hapi request
 * @param result the result of the delete operation
 */
internals.defaultPostDelete = function (request, result) {

};

/**
 * Joi validation schema for the route configuration definition. Includes
 * including defaulting all options so all options can be assumed to exist
 * at runtime.
 * @param {Object} sequelize the sequelize instance
 * @returns {{model: *, where: *, preDelete: *, postDelete: *}}
 */
internals.optionsSchema = function (sequelize) {
    return joi.object().keys({
        model: joi.string().required().valid(_.keys(sequelize.models)),
        where: joi.func().default(internals.defaultWhere),
        options: joi.object().default({}),
        preRemove: joi.func().default(internals.defaultPreDelete),
        postRemove: joi.func().default(internals.defaultPostDelete),
        scope: joi.alternatives([joi.string(), joi.func(), joi.array().items(joi.string())]).allow(null)
    });
};

/**
 * Constructs the where clause content for the sequelize delete
 * @param {Object} req the hapi request
 * @param {Object} options the route options
 * @returns {Object} the where clause object
 */
internals.buildWhere = function (req, options) {
    return options.where(req);
};

/**
 * Builds the options object that is passed to sequelize
 * @param {Object} req the hapi request
 * @param {Object} options the route options
 * @returns {Object} the delete options for sequelize
 */
internals.constructDeleteOptions = function (req, options) {
    // to fire the pre/postDestroy methods on individual models
    // can be overridden in the route options
    var opts = { individualHooks: true };
    //construct the where from the route config & URL q params
    var where = internals.buildWhere(req, options);
    if (where) opts.where = where;
    return _.assign(opts, options.options);
};

/**
 * Creates a hapi route handler responsible for deleting an instance of a sequelize
 * model. Route defintion is validated with joi such that a bad configuration will
 * prevent the server from starting as well as adding the convenience of allowing
 * auto-documentation modules to inspect the route definition. All operations
 * that occur within the handler for each request are wrapped within a transaction.
 *
 * This function is curried and passed to the hapi handler registration function.
 *
 * @param {Object} sequelize the sequelize instance
 * @param {Object} defaults the defaults object for delete from the ent-sequelize startup config
 * @param {Object} route
 * @param {Object} options
 */
internals.createHandler = function (sequelize, defaults, route, options) {
    var Model;

    //validate the handler options
    joi.validate(options, internals.optionsSchema(sequelize, defaults), function (err, validated) {
        if (err) throw new Error('Error in route ' + route.path + ': ' + err.message);
        options = validated;
    });

    //get the model we're dealing with
    Model = sequelize.models[options.model];

    return function (req, reply) {
        let scope = _.isFunction(options.scope) ? options.scope(req) : options.scope;
        // non-null/undefined -> force array
        scope = (scope !== null && scope !== undefined) ? [].concat(scope) : scope;

        var ScopedModel = options.hasOwnProperty('scope') ?
            Model.scope(scope) :
            Model;

        //require the operation to always be in a transaction
        return sequelize.requiresTransaction(function (t) {
            //construct the options
            return Sequelize.Promise.try(() => internals.constructDeleteOptions(req, options))
            //hook in if options need tweaking
                .tap(options.preRemove.bind(null, req))
                //perform the delete, always passing the transaction along
                .then(function (opts) {
                    opts.transaction = t;
                    return ScopedModel.destroy(opts);
                })
                //in case something needs to happen after the delete
                .tap(options.postRemove.bind(null, req))
                //never return anything from http DELETE method
                .then(function () {
                    reply();
                })
                //catch anything that went wrong
                .catch(reply);
        });
    };
};

module.exports = _.curry(internals.createHandler);
