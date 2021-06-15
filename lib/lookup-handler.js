'use strict';

var _ = require('lodash');
var joi = require('joi');
var compile = require('hapi/lib/validation').compile;
var boom = require('boom');
var eu = require('ent-utils');
var Sequelize = require('@entrinsik/informer-sequelize');

var internals = {};

/**
 * Default pre-query lifecycle method. This method may change the query via side effect only. Return values
 * are ignored
 * @param {Object} request the hapi request
 * @param {Object} query the compiled query options to be sent to sequelize
 */
internals.defaultPreLookup = function (request, query) {
};

/**
 * Default post-query lifecycle method. This method may change the query via side effect only. Return values
 * are ignored
 * @param {Object} request the hapi request
 * @param {Object} result the found entity
 * @param {Object} reply the hapi reply
 */
internals.defaultPostLookup = function (request, result, reply) {
};

/**
 * Default where builder implementation
 * @param {Object} request the hapi request
 */
internals.defaultWhere = function (request) {
    return request.params;
};

/**
 * Default required expansions implementation
 * @param {Object} request the hapi request
 * @param {Object} Model the sequelize model
 * @return {Array}
 */
internals.defaultRequiredExpansions = function (request, Model) {
    return [];
};

/**
 * Creates a joi validation object for the route definition based on registered joi models
 * Note: This means that sequelize models should be registered before dependent route handlers
 * @param {Object} sequelize the sequelize instance
 * @return {Object} a joi schema for validating route options
 */
internals.optionsSchema = function (sequelize) {
    return {
        model: joi.string().required().valid(_.keys(sequelize.models)),
        where: joi.func().default(internals.defaultWhere),
        expand: joi.object().keys({
            required: joi.alternatives([
                joi.array().single().items(joi.string()),
                joi.func()
            ]).default(_.constant(internals.defaultRequiredExpansions), 'function factory'),
            valid: joi.array().items(joi.string()).single(),
            invalid: joi.array().items(joi.string()).single()
        }).default({ required: internals.defaultRequiredExpansions }),
        preLookup: joi.func().default(internals.defaultPreLookup),
        postLookup: joi.func().default(internals.defaultPostLookup),
        scope: joi.alternatives([joi.string(), joi.func(), joi.array().items(joi.string())]).allow(null),
        options: joi.object().default({}),
    };
};

/**
 * Creates a joi validation object for validating the http request's query parameters
 * @param Model
 * @param options
 */
internals.routeQuerySchema = function (Model, options) {
    var schema = {};

    var associations = options.expand.valid || Object.keys(Model.associations || {});

    // strip out invalid asosciations
    associations = _.difference(associations, options.expand.invalid);

    schema.expand = joi.array().single().items(joi.string().valid(associations)).default([]);

    // if (associations.length === 0) schema.expand = schema.expand.forbidden();

    return schema;
};

/**
 * Merges the query schema with any existing route validation. If no existing validation, the query validation
 * is returned
 * @param {Object} schemas the value of route.settings.validate
 * @param {Object} Model the sequelize model
 * @param {Object} options the route options
 * @return {Object} the combined joi schema
 */
internals.mergeRouteValidationSchemas = function (schemas, Model, options) {
    var querySchema = internals.routeQuerySchema(Model, options);

    schemas = _.merge({}, schemas);

    schemas.query = schemas.query ? compile(schemas.query).concat(compile(querySchema)) : compile(querySchema);

    return schemas;
};

/**
 * Builds an array of associations to include. The array is seeded by invoking the route's expand.required() method
 * @param req
 * @param Model
 * @param options
 * @return {*}
 */
internals.getIncludes = function (req, Model, options) {
    // joi will sanitize undefined query parameter into an empty array
    var expansions = req.query.expand;

    return []
        .concat(options.expand.required(req, Model))
        .concat(expansions.map(function (expansion) {
            return Model.associations[expansion];
        }));
};

/**
 * Builds the sequelize query options object
 * @param {Object} req the hapi request
 * @param {Object} Model the sequelize model
 * @param {Object} options the route options
 * @return {{ where: *, include: []= }} the query options
 */
internals.queryOptions = function (req, Model, options) {
    var queryOpts = { where: options.where(req) };

    var includes = internals.getIncludes(req, Model, options);
    if (includes.length > 0) queryOpts.include = includes;

    return _.assign(queryOpts, options.options);
};

/**
 * Post joi type coersion of route options
 * @param Model
 * @param options
 * @return {*}
 */
internals.processValidatedOptions = function (Model, options) {
    // compose a function out of array literals
    var required = options.expand.required;
    if (_.isArray(required)) {
        required = required.map(function (association) {
            return Model.associations[association];
        });
        // options.expand.required = () => required    some day :(
        options.expand.required = function () {
            return required;
        };
    }
    return options;
};

/**
 * Creates a Hapi route handler for looking up a sequelize model. Supports an expand query parameter for eagerly
 * loading defined sequelize relationships. Routes should anticipate expansions and define hal _embeds accordingly
 *
 * A curried version of this function is passed to the hapi server.handler() function with a partially applied
 * sequelize reference
 * @param {Object} sequelize the sequelize instance
 * @param route
 * @param options
 */
internals.createHandler = function (sequelize, route, options) {
    var Model;

    joi.validate(options, internals.optionsSchema(sequelize), function (err, validated) {
        if (err) throw new Error('Error in route ' + route.path + ': ' + err.message);

        // the sequelize model
        Model = sequelize.models[validated.model];

        options = internals.processValidatedOptions(Model, validated);
    });

    // combine joi schemas or apply the default query schema
    route.settings.validate = internals.mergeRouteValidationSchemas(route.settings.validate, Model, options);

    return function (req, reply) {
        let scope = _.isFunction(options.scope) ? options.scope(req) : options.scope;
        // non-null/undefined -> force array
        scope = (scope !== null && scope !== undefined) ? [].concat(scope) : scope;

        var ScopedModel = options.hasOwnProperty('scope') ?
            Model.scope(scope) :
            Model;

        // compile the options
        Sequelize.Promise.try(() => internals.queryOptions(req, ScopedModel, options))

        // tweak the options if necessary before querying
            .tap(options.preLookup.bind(null, req))

            // invoke the model finder
            .then(function (options) {
                return ScopedModel.find(options);
            })

            // possible 404
            .then(function (instance) {
                if (!instance) throw boom.notFound();

                return instance;
            })

            // tweak the output
            .tap(function (instance) {
                return options.postLookup(req, instance, reply);
            })

            .then(function (instance) {
                process.nextTick(function () {
                    if (!req.response) reply(null, instance);
                });
            })

            .catch(reply);
    };
};

module.exports = _.curry(internals.createHandler);