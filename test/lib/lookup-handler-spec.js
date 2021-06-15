'use strict';

const chai = require('chai');
const should = chai.should();
const sinon = require('sinon');
chai.use(require('sinon-chai'));
const _ = require('lodash');
const factory = require('../../lib/lookup-handler');
const joi = require('joi');
const Sequelize = require('@entrinsik/informer-sequelize');
const hapi = require('hapi');

describe('Generic Lookup Handler', function () {
    let server, finder, thrower, sequelize, scope;

    beforeEach(function () {
        //setup mocks
        finder = sinon.spy(function (opts) {
            return Sequelize.Promise.resolve({ username: opts.where && opts.where.username });
        });

        thrower = sinon.spy(function () {
            return Sequelize.Promise.resolve(null);
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
                    find: finder,
                    scope: scope
                },
                Bar: {
                    attributes: {
                        name: {}
                    },
                    find: thrower,
                    associations: {}
                }
            }
        };
    });

    beforeEach(function (done) {
        server = new hapi.Server();
        server.connection();
        server.handler('db.lookup', factory(sequelize));
        server.register(require('inject-then'), done);
    });

    const addRoute = function (cfg) {
        server.route({ path: '/users/{username}', method: 'get', config: _.assign(cfg, { id: 'user.lookup' }) });
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
                    'db.lookup': {}
                }
            }).should.throw('Error in route /users/{username}: child "model" fails because ["model" is required]');

            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User'
                    }
                }
            }).should.not.throw();
        });

        it('should reject unknown model', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'Account'
                    }
                }
            }).should.throw('Error in route /users/{username}: child "model" fails because ["model" must be one of [User, Bar]]');
        });

        it('should support a where function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
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
                    'db.lookup': {
                        model: 'User',
                        where: { foo: 'bar' }
                    }
                }
            }).should.throw('Error in route /users/{username}: child "where" fails because ["where" must be a Function]');
        });

        it('should support a preLookup extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        preLookup: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a preLookup extension point that is not a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        preLookup: 'bar'
                    }
                }
            }).should.throw('Error in route /users/{username}: child "preLookup" fails because ["preLookup" must be a Function]');
        });

        it('should support a postLookup extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        postLookup: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a postLookup extension point that is not a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        postLookup: 'bar'
                    }
                }
            }).should.throw('Error in route /users/{username}: child "postLookup" fails because ["postLookup" must be a Function]');
        });

        it('should return a handler function when invoked', function () {
            factory(sequelize, { model: 'User' }).should.be.a('function');
        });

        it('should set route validation', function () {
            addRoute({
                handler: {
                    'db.lookup': {
                        model: 'User'
                    }
                }
            });

            const route = server.lookup('user.lookup');
            route.settings.validate.query.describe().children.should.have.property('expand');
        });

        it('should support a scope option', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        scope: 'customScope'
                    }
                }
            }).should.not.throw();
        });

        it('should support a null scope', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        scope: null
                    }
                }
            }).should.not.throw();
        });

        it('should support a scope option that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        scope: _.noop
                    }
                }
            }).should.not.throw();
        });

        it(`should support a scope option that is an array of strings`, () => {
            addRoute.bind(null, {
                handler: {
                    'db.lookup': {
                        model: 'User',
                        scope: ['scope_one', 'scope_two']
                    }
                }
            }).should.not.throw();
        });

        describe('handler', function () {
            it('should look up the model using path params as a natural id', function () {
                server.route({
                    method: 'get',
                    path: '/users/{username}',
                    handler: {
                        'db.lookup': {
                            model: 'User'
                        }
                    }
                });

                return server.injectThen({
                    method: 'get',
                    url: '/users/bleupen'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    finder.should.have.been.calledWith({ where: { username: 'bleupen' } });
                });
            });

            it('should use a configured where function', function () {
                server.route({
                    method: 'get',
                    path: '/users',
                    config: {
                        handler: {
                            'db.lookup': {
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
                    method: 'get',
                    url: '/users?username=hank'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    finder.should.have.been.calledWith({ where: { username: 'hank' } });
                });
            });

            it('should expand an entity', function () {
                server.route({
                    path: '/users/{username}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'User'
                        }
                    }
                });

                return server.injectThen({
                    method: 'get',
                    url: '/users/hank?expand=settings'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    finder.should.have.been.calledWith({
                        include: [sequelize.models.User.associations.settings],
                        where: { username: 'hank' }
                    });
                });
            });

            it('should reject an invalid expansion', function () {
                server.route({
                    path: '/users/{username}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'User'
                        }
                    }
                });

                return server.injectThen({
                    method: 'get',
                    url: '/users/hank?expand=boss'
                }).then(function (res) {
                    const body = JSON.parse(res.payload);
                    res.statusCode.should.equal(400);
                    body.message.should.equal('child "expand" fails because [single value of "expand" fails because ["expand" must be one of [settings]]]');
                });
            });

            it('should reject an expansion on an entity with no associations', function () {
                server.route({
                    path: '/bars/{barId}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'Bar'
                        }
                    }
                });

                return server.injectThen({
                    method: 'get',
                    url: '/bars/snookers?expand=patrons'
                }).then(function (res) {
                    const body = JSON.parse(res.payload);
                    res.statusCode.should.equal(400);
                    body.message.should.equal('child "expand" fails because [single value of "expand" fails because ["expand" must be one of []]]');
                });
            });

            it('should return the entity if found', function () {
                server.route({
                    path: '/users/{username}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'User'
                        }
                    }
                });

                return server.injectThen({
                    method: 'get',
                    url: '/users/hank'
                }).then(function (res) {
                    const body = JSON.parse(res.payload);
                    body.should.have.property('username', 'hank');
                });
            });

            it('should return a 404 if not found', function () {
                server.route({
                    path: '/bars/{barId}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'Bar'
                        }
                    }
                });

                return server.injectThen({
                    method: 'get',
                    url: '/bars/snookerz'
                }).then(function (res) {
                    res.should.have.property('statusCode', 404);
                });
            });

            it('should support a single required expansions', function () {
                server.route({
                    path: '/users/{username}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'User',
                            expand: {
                                required: 'settings'
                            }
                        }
                    }
                });

                return server.injectThen('/users/hank')
                    .then(function (res) {
                        res.should.have.property('statusCode', 200);
                        finder.should.have.been.calledWith({
                            where: { username: 'hank' },
                            include: [sequelize.models.User.associations.settings]
                        });
                    });
            });

            it('should support an array of required expansions', function () {
                server.route({
                    path: '/users/{username}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'User',
                            expand: {
                                required: ['settings']
                            }
                        }
                    }
                });

                return server.injectThen('/users/hank')
                    .then(function (res) {
                        res.should.have.property('statusCode', 200);
                        finder.should.have.been.calledWith({
                            where: { username: 'hank' },
                            include: [sequelize.models.User.associations.settings]
                        });
                    });
            });

            it('should not call postLookup method if not found', function () {
                const postLookup = sinon.spy(function () {
                    return null;
                });

                server.route({
                    path: '/bars/{barId}',
                    method: 'get',
                    handler: {
                        'db.lookup': {
                            model: 'Bar',
                            postLookup: postLookup
                        }
                    }
                });

                return server.injectThen('/bars/snookerz')
                    .then(function (res) {
                        res.should.have.property('statusCode', 404);
                        postLookup.callCount.should.equal(0);
                    });
            });

            it('should use a configured scope by name', function () {
                server.route({
                    method: 'get',
                    path: '/users/me',
                    handler: {
                        'db.lookup': {
                            model: 'User',
                            scope: 'customScope'
                        }
                    }
                });

                return server.injectThen({
                    method: 'GET',
                    url: '/users/me'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.have.been.calledWith(['customScope']);
                    });
            });

            it('should use a configured null scope to unset the default scope', function () {
                server.route({
                    method: 'GET',
                    path: '/users/me',
                    handler: {
                        'db.lookup': {
                            model: 'User',
                            scope: null
                        }
                    }
                });

                return server.injectThen({
                    method: 'GET',
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
                    method: 'GET',
                    path: '/users/me',
                    handler: {
                        'db.lookup': {
                            model: 'User',
                            scope: handlerScopeSpy
                        }
                    }
                });

                return server.injectThen({
                    method: 'GET',
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
                    method: 'get',
                    path: '/users/me',
                    handler: {
                        'db.lookup': {
                            model: 'User',
                            scope: ['scope_one', 'scope_two']
                        }
                    }
                });

                return server.injectThen({
                    method: 'GET',
                    url: '/users/me'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.have.been.calledWith(['scope_one', 'scope_two']);
                    });
            });

            it('should not invoke Model.scope() if no scope is supplied in the route definition', function () {
                server.route({
                    method: 'GET',
                    path: '/users/me',
                    handler: {
                        'db.lookup': {
                            model: 'User'
                        }
                    }
                });

                return server.injectThen({
                    method: 'GET',
                    url: '/users/me'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.not.have.been.called;
                    });
            });
        });
    });

});