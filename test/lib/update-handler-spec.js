'use strict';

var chai = require('chai');
var should = chai.should();
var expect = chai.expect;
var sinon = require('sinon');
chai.use(require('sinon-chai'));
var _ = require('lodash');
var factory = require('../../lib/update-handler');
var joi = require('joi');
var Sequelize = require('@entrinsik/informer-sequelize');
var hapi = require('hapi');

describe('Generic Update Handler', function () {
    var server, finder, thrower, sequelize, builder, saver, scope;

    beforeEach(function () {
        //setup mocks


        thrower = sinon.spy(function () {
            return Sequelize.Promise.resolve(null);
        });

        saver = sinon.spy(function () {
            return Sequelize.Promise.resolve(this);
        });

        finder = sinon.spy(function (opts) {
            var instance = {
                username: opts.where && opts.where.username,
                change: 'robert',
                set: sinon.spy(function (payload) {
                    _.merge(this, payload);
                }),
                save: saver,
                isNewRecord: false
            };

            return Sequelize.Promise.resolve(instance);
        });

        builder = sinon.spy(function (opts) {
            var instance = _.merge(opts, {
                set: sinon.spy(function (payload) {
                    _.merge(this, payload);
                }),
                save: saver,
                isNewRecord: true
            });

            return Sequelize.Promise.resolve(instance);
        });

        scope = sinon.spy(function () {
            return sequelize.models.User;
        });

        sequelize = {
            models: {
                User: {
                    attributes: {
                        firstName: {},
                        lastName: {}
                    },
                    associations: {
                        settings: {}
                    },
                    findOne: finder,
                    build: builder,
                    scope: scope
                },
                Bar: {
                    attributes: {
                        name: {}
                    },
                    findOne: thrower,
                    build: builder,
                    associations: {}
                }
            },
            model: function (model) {
                return sequelize.models[model];
            },
            requiresTransaction: function (func) {
                return func();
            }
        };
    });

    beforeEach(function (done) {
        server = new hapi.Server();
        server.connection();
        server.handler('db.update', factory(sequelize));
        server.register(require('inject-then'), done);
    });

    var addRoute = function (cfg) {
        server.route({ path: '/users/{username}', method: 'put', config: _.assign(cfg, { id: 'user.update' }) });
    };

    describe('registration', function () {
        it('should exist', function () {
            should.exist(factory);
        });

        it('should be a function', function () {
            factory.should.be.a('function');
        });

        it('should apply sequelize & return a function', function () {
            factory(sequelize).should.be.a('function');
        });

        it('should require a model', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {}
                }
            }).should.throw('Error in route /users/{username}: child "model" fails because ["model" is required]');

            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User'
                    }
                }
            }).should.not.throw();
        });

        it('should reject unknown model', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'Account'
                    }
                }
            }).should.throw('Error in route /users/{username}: child "model" fails because ["model" must be one of [User, Bar]]');
        });

        it('should support a where function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        where: function () {

                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a non-function where', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        where: { foo: 'bar' }
                    }
                }
            }).should.throw('Error in route /users/{username}: child "where" fails because ["where" must be a Function]');
        });

        it('should support a preLookup extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        preUpdate: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a preLookup extension point that is not a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        preUpdate: 'bar'
                    }
                }
            }).should.throw('Error in route /users/{username}: child "preUpdate" fails because ["preUpdate" must be a Function]');
        });

        it('should support a postLookup extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        postUpdate: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should support sequelize options', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        options: { validate: false }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a postLookup extension point that is not a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        postUpdate: 'bar'
                    }
                }
            }).should.throw('Error in route /users/{username}: child "postUpdate" fails because ["postUpdate" must be a Function]');
        });

        it('should support a create flag', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        create: true
                    }
                }
            }).should.not.throw();
        });

        it('should return a handler function when invoked', function () {
            factory(sequelize, { model: 'User' }).should.be.a('function');
        });

        it('should support a scope option', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: 'customScope'
                    }
                }
            }).should.not.throw();
        });

        it('should support a null scope to unset the default scope', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: null
                    }
                }
            }).should.not.throw();
        });

        it('should support a scope option that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: _.noop
                    }
                }
            }).should.not.throw();
        });

        it(`should support a scope option that is an array of strings`, () => {
            addRoute.bind(null, {
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: ['scope_one', 'scope_two']
                    }
                }
            }).should.not.throw();
        });
    });

    describe('handler', function () {
        it('should update the model using path params as a natural id', function () {
            server.route({
                method: 'put',
                path: '/users/{username}',
                handler: {
                    'db.update': {
                        model: 'User'
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/robert',
                payload: {
                    change: 'changeit'
                }
            }).then(function (res) {
                res.statusCode.should.equal(200);
                finder.should.have.been.calledWith({ transaction: undefined, where: { username: 'robert' } });
                saver.firstCall.thisValue.should.have.property('username', 'robert');
                saver.firstCall.thisValue.should.have.property('change', 'changeit');
            });
        });

        it('should require parameters', function () {
            server.route({
                method: 'put',
                path: '/users',
                handler: {
                    'db.update': {
                        model: 'User'
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users',
                payload: {
                    change: 'changeit'
                }
            }).then(function (res) {
                res.should.have.property('statusCode', 400);
            });
        });

        it('should use a configured where function', function () {
            server.route({
                method: 'put',
                path: '/users',
                config: {
                    handler: {
                        'db.update': {
                            model: 'User',
                            where: function (req) {
                                return { username: req.query.username };
                            }
                        }
                    },
                    validate: {
                        query: {
                            username: joi.string()
                        }
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users?username=robert',
                payload: {
                    change: 'changeit'
                }
            }).then(function (res) {
                res.statusCode.should.equal(200);
                finder.should.have.been.calledWith({ transaction: undefined, where: { username: 'robert' } });
                saver.firstCall.thisValue.should.have.property('username', 'robert');
                saver.firstCall.thisValue.should.have.property('change', 'changeit');
            });
        });

        it('should return the entity if found and updated', function () {
            server.route({
                path: '/users/{username}',
                method: 'put',
                handler: {
                    'db.update': {
                        model: 'User'
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/robert',
                payload: { change: 'changeit' }
            }).then(function (res) {
                var body = JSON.parse(res.payload);
                body.should.have.property('username', 'robert');
                body.should.have.property('change', 'changeit');
            });
        });

        it('should return a 404 if not found', function () {
            server.route({
                path: '/bars/{barId}',
                method: 'put',
                handler: {
                    'db.update': {
                        model: 'Bar'
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/bars/snookerz'
            }).then(function (res) {
                res.should.have.property('statusCode', 404);
            });
        });

        it('should create the entity if create option is present', function () {
            server.route({
                path: '/bars/{barId}',
                method: 'put',
                handler: {
                    'db.update': {
                        model: 'Bar',
                        create: true
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/bars/snookerz'
            }).then(function (res) {
                res.should.have.property('statusCode', 200);
            });
        });

        it('should allow postCreate to set the result status, location header', function () {
            server.route({
                path: '/bars/{barId}',
                method: 'put',
                handler: {
                    'db.update': {
                        model: 'Bar',
                        create: true,
                        postCreate: function (req, instance, reply) {
                            reply(instance).created('/bars/snookerz');
                        }
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/bars/snookerz'
            }).then(function (res) {
                res.should.have.property('statusCode', 201);
                expect(res.headers).to.have.property('location', '/bars/snookerz');
            });
        });

        it('should not call postLookup method if not found', function () {
            var postUpdate = sinon.spy(function () {
                return null;
            });

            server.route({
                path: '/bars/{barId}',
                method: 'put',
                handler: {
                    'db.update': {
                        model: 'Bar',
                        postUpdate: postUpdate
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/bars/snookerz'
            })
                .then(function (res) {
                    res.should.have.property('statusCode', 404);
                    postUpdate.callCount.should.equal(0);
                });
        });

        it('should apply extra sequelize options to the update command', function () {
            server.route({
                path: '/users/{username}',
                method: 'put',
                handler: {
                    'db.update': {
                        model: 'User',
                        options: { silent: true }
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/robert',
                payload: { change: 'changeit' }
            }).then(function (res) {
                res.statusCode.should.equal(200);
                saver.firstCall.thisValue.should.have.property('username', 'robert');
                saver.firstCall.thisValue.should.have.property('change', 'changeit');
                saver.firstCall.should.have.been.calledWith({
                    transaction: undefined,
                    silent: true
                });
            });
        });

        it('should use a configured scope by name', function () {
            server.route({
                method: 'put',
                path: '/users/{userId}',
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: 'customScope'
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/me'
            })
                .then(res => {
                    res.statusCode.should.equal(200);
                    scope.should.have.been.calledWith(['customScope']);
                });
        });

        it('should use a configured null scope to unset the default scope', function () {
            server.route({
                method: 'put',
                path: '/users/{userId}',
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: null
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/me'
            })
                .then(res => {
                    res.statusCode.should.equal(200);
                    scope.should.have.been.calledWith(null);
                });
        });

        it('should use a configured scope function', function () {
            const handlerScopeSpy = sinon.spy();
            server.route({
                method: 'put',
                path: '/users/{userId}',
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: handlerScopeSpy
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/me'
            })
                .then(res => {
                    res.statusCode.should.equal(200);
                    handlerScopeSpy.should.have.been.calledOnce;
                    handlerScopeSpy.firstCall.args.should.have.length(1);
                });
        });

        it(`should use a configured scope array of scope names`, () => {
            server.route({
                method: 'put',
                path: '/users/{userId}',
                handler: {
                    'db.update': {
                        model: 'User',
                        scope: ['scope_one', 'scope_two']
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/me'
            })
                .then(res => {
                    res.statusCode.should.equal(200);
                    scope.should.have.been.calledWith(['scope_one', 'scope_two']);
                });
        });

        it('should not invoke Model.scope() if no scope is supplied in the route definition', function () {
            server.route({
                method: 'put',
                path: '/users/{userId}',
                handler: {
                    'db.update': {
                        model: 'User'
                    }
                }
            });

            return server.injectThen({
                method: 'put',
                url: '/users/me'
            })
                .then(res => {
                    res.statusCode.should.equal(200);
                    scope.should.not.have.been.called;
                });
        });
    });

});