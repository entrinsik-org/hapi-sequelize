'use strict';

var _ = require('lodash');
var joi = require('joi');
var compile = require('hapi/lib/validation').compile;
var eu = require('ent-utils');
var Sequelize = require('@entrinsik/informer-sequelize');

var internals = {};

/**
 * Default pre-query lifecycle method. This method may change the query via side effect only. Return values
 * are ignored
 * @param {Object} request the hapi request
 * @param {Object} query the compiled query options to be sent to sequelize
 */
internals.defaultPreQuery = function (request, query) {
};

/**
 * Default post-query lifecycle method. This method may change the query via side effect only. Return values
 * are ignored
 * @param {Object} request the hapi request
 * @param {{start: number, total: number, count: number, items: Object[]}} result the collection object
 */
internals.defaultPostQuery = function (request, result) {
};

/**
 * Default where builder implementation
 * @param {Object} request the hapi request
 */
internals.defaultWhere = function (request) {
    return Object.keys(request.params).length > 0 ? request.params : null;
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
 * @param {{ limit: number }} defaults the default page size
 * @return {Object} a joi schema for validating route options
 */
internals.optionsSchema = function (sequelize, defaults) {
    return {
        model: joi.string().required().valid(_.keys(sequelize.models)),
        sort: joi.array().items(joi.string()).single().default([]),
        query: joi.array().items(joi.string()).single().default([]),
        where: joi.func().default(internals.defaultWhere),
        limit: joi.number().integer().default(defaults.limit),
        expand: joi.object().keys({
            required: joi.alternatives([
                joi.array().single().items(joi.string()),
                joi.func()
            ]).default(_.constant(internals.defaultRequiredExpansions), 'function factory'),
            valid: joi.array().items(joi.string()).single(),
            invalid: joi.array().items(joi.string()).single()
        }).default({ required: internals.defaultRequiredExpansions }),
        scope: joi.alternatives([joi.string(), joi.func(), joi.array().items(joi.string())]).allow(null),
        options: joi.object().default({}),
        queryOptions: joi.object().default({}),
        preQuery: joi.func().default(internals.defaultPreQuery),
        postQuery: joi.func().default(internals.defaultPostQuery)
    };
};

/**
 * Creates a joi validation object for validating the http request's query parameters
 * @param Model
 * @param options
 */
internals.routeQuerySchema = function (Model, options) {
    // [ 'field1', '-field1', ...]
    var sorts = _.keys(Model.attributes).reduce(function (acc, field) {
        acc.push(field);
        acc.push('-' + field);
        return acc;
    }, []);

    var schema = {
        start: joi.number().integer().default(0),
        limit: joi.number().integer().default(options.limit),
        sort: joi.array().single().items(joi.string().valid(sorts)).default(options.sort)
    };

    // q is a valid query parameter only if query fields have been specified
    if (options.query.length > 0) {
        schema.q = joi.string().empty('');
    }

    var associations = options.expand.valid || Object.keys(Model.associations || {});

    // strip out invalid asosciations
    associations = _.difference(associations, options.expand.invalid);

    schema.expand = joi.array().single().items(joi.string().valid(associations)).default([]);

    // if (associations.length === 0) schema.expand = schema.expand.forbidden();

    return compile(schema);
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

    schemas.query = schemas.query ? compile(schemas.query).concat(querySchema) : querySchema;

    return schemas;
};

/**
 * Creates the query's where clause
 * @param {Object} req the hapi request
 * @param {Object} options the route options
 * @return {*}
 */
internals.where = function (req, options) {
    var subQuery;

    // this function is always valid but may return null to indicate no criteria
    var where = options.where(req);

    // req.query.q should be sufficient test but just being safe
    if (options.query.length > 0 && req.query.q) {
        req.query.q = req.query.q.endsWith('*') ? req.query.q : `${req.query.q}*`;

        subQuery = Sequelize.or.apply(Sequelize, options.query.map(function (field) {
            var queryPart = {};
            queryPart[field] = { ilike: req.query.q.replace(/\*/g, '%') };
            return queryPart;
        }));

        where = where ? Sequelize.and(where, subQuery) : subQuery;
    }
    return where;
};

/**
 * Builds an array of associations to include. The array is seeded by invoking the route's expand.required() method
 * @param req
 * @param Model
 * @param options
 * @return {*}
 */
internals.getIncludes = function (req, Model, options) {
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
 * @return {{}} the query options
 */
internals.queryOptions = function (req, Model, options) {
    var queryOpts = { offset: req.query.start };

    // only assign the where if not null
    var where = internals.where(req, options);
    if (where) queryOpts.where = where;

    // work-around for embedded sorting
    // http://stackoverflow.com/questions/22534339/sequelize-js-limit-and-sorting-bug

    // coerce '-username' into ['username', 'DESC']
    var order = req.query.sort.map(function (field) {
        return field.charAt(0) === '-' ? [[field.substring(1), 'DESC']] : [[field, 'ASC']];
    });

    if (order.length > 0) queryOpts.order = order;

    // 0 disables limit
    if (req.query.limit > 0) queryOpts.limit = req.query.limit;

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
 * Creates a Hapi route handler for querying a sequelize model. Supports and validates common
 * options, such as sort, expand, start, limit, etc. Validation rules are implemented as a joi object
 * rather than a function so that swagger / lout can inspect the route definition.
 *
 * A curried version of this function is passed to the hapi server.handler() function with a partially applied
 * sequelize reference
 * @param {Object} sequelize the sequelize instance
 * @param {{ limit: number }} defaults
 * @param route
 * @param routeOptions
 */
internals.createHandler = function (sequelize, defaults, route, routeOptions) {
    var Model, validated;

    joi.validate(routeOptions, internals.optionsSchema(sequelize, defaults), function (err, validated) {
        if (err) throw new Error('Error in route ' + route.path + ': ' + err.message);

        // the sequelize model
        Model = sequelize.models[validated.model];

        routeOptions = internals.processValidatedOptions(Model, validated);
    });

    // combine joi schemas or apply the default query schema
    route.settings.validate = internals.mergeRouteValidationSchemas(route.settings.validate, Model, routeOptions);

    return function (req, reply) {
        let scope = _.isFunction(routeOptions.scope) ? routeOptions.scope(req) : routeOptions.scope;
        // non-null/undefined -> force array
        scope = (scope !== null && scope !== undefined) ? [].concat(scope) : scope;

        var ScopedModel = routeOptions.hasOwnProperty('scope') ?
            Model.scope(scope) :
            Model;

        // compile the options
        Sequelize.Promise.try(() => internals.queryOptions(req, ScopedModel, routeOptions))

        // tweak the options if necessary before querying
            .tap(routeOptions.preQuery.bind(null, req))

            // invoke the model finder
            .then(function (options) {
                return ScopedModel.findAndCountAll(options, routeOptions.queryOptions);
            })

            // build a collection object
            .then(function (results) {
                return eu.collection(results.rows, req.query.start, results.count);
            })

            // tweak the output
            .tap(routeOptions.postQuery.bind(null, req))

            // done
            .nodeify(reply);
    };
};

module.exports = _.curry(internals.createHandler);