'use strict';

var chai = require('chai');
var should = chai.should();
var sinon = require('sinon');
chai.use(require('sinon-chai'));
var _ = require('lodash');
var factory = require('../../lib/remove-handler');
var joi = require('joi');
var Sequelize = require('@entrinsik/informer-sequelize');
var P = Sequelize.Promise;
var hapi = require('hapi');

var $;

describe('Generic Remove Handler', function () {
    var server, destroyer, sequelize, transFunction, scope;

    beforeEach(function () {
        //setup mocks
        destroyer = sinon.spy(function (opts) {
            return Sequelize.Promise.resolve(opts);
        });

        scope = sinon.spy(function () {
            return sequelize.models.Foo;
        });

        sequelize = {
            models: {
                Foo: {
                    attributes: {
                        bar: {},
                        baz: {}
                    },
                    destroy: destroyer,
                    scope: scope
                }
            },
            requiresTransaction: function (transactedFunction) {
                transFunction = transactedFunction;
                return Sequelize.Promise.resolve(transactedFunction({ me: 'i am a transaction' }));
            }
        };
    });

    beforeEach(function (done) {
        server = new hapi.Server();
        server.connection();
        server.handler('db.remove', factory(sequelize, null));
        server.register(require('inject-then'), done);
    });

    var addRoute = function (cfg) {
        server.route({ path: '/my/route', method: 'delete', config: _.assign(cfg, { id: 'foo.delete' }) });
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
                    'db.remove': {}
                }
            }).should.throw('Error in route /my/route: child "model" fails because ["model" is required]');

            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo'
                    }
                }
            }).should.not.throw();
        });

        it('should reject unknown model', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Bar'
                    }
                }
            }).should.throw('Error in route /my/route: child "model" fails because ["model" must be one of [Foo]]');
        });

        it('should support a where function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        where: function () {

                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a non-function where', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        where: { foo: 'bar' }
                    }
                }
            }).should.throw('Error in route /my/route: child "where" fails because ["where" must be a Function]');
        });

        it('should support a preRemove extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        preRemove: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a preRemove extension point that is not a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        preRemove: 'bar'
                    }
                }
            }).should.throw('Error in route /my/route: child "preRemove" fails because ["preRemove" must be a Function]');
        });

        it('should support a postRemove extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        postRemove: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should reject a postRemove extension point that is not a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        postRemove: 'bar'
                    }
                }
            }).should.throw('Error in route /my/route: child "postRemove" fails because ["postRemove" must be a Function]');
        });

        it('should return a handler function when invoked', function () {
            factory(sequelize, null, { model: 'User' }).should.be.a('function');
        });

        it('should support a preRemove extension point that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        preRemove: function () {
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should accept sequelize options', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        options: {
                            limit: 1
                        }
                    }
                }
            }).should.not.throw();
        });

        it('should support a scope option', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        scope: 'customScope'
                    }
                }
            }).should.not.throw();
        });

        it('should support a null scope', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        scope: null
                    }
                }
            }).should.not.throw();
        });

        it('should support a scope option that is a function', function () {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        scope: _.noop
                    }
                }
            }).should.not.throw();
        });

        it(`should support a scope option that is an array of strings`, () => {
            addRoute.bind(null, {
                handler: {
                    'db.remove': {
                        model: 'Foo',
                        scope: ['scope_one', 'scope_two']
                    }
                }
            }).should.not.throw();
        });

        describe('handler', function () {
            it('should delete the model when no other options are given', function () {
                server.route({
                    method: 'delete',
                    path: '/my/route',
                    handler: {
                        'db.remove': {
                            model: 'Foo'
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/my/route'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    destroyer.should.have.been.calledWith({
                        transaction: { me: 'i am a transaction' },
                        individualHooks: true
                    });
                });
            });

            it('should use a configured where function', function () {
                server.route({
                    method: 'delete',
                    path: '/my/route',
                    handler: {
                        'db.remove': {
                            model: 'Foo',
                            where: function () {
                                return { some: 'value' };
                            }
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/my/route'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    destroyer.should.have.been.calledWith({
                        transaction: { me: 'i am a transaction' },
                        where: { some: 'value' },
                        individualHooks: true
                    });
                });
            });

            it('should use URL parameters in the where clause', function () {
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo'
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    destroyer.should.have.been.calledWith({
                        transaction: { me: 'i am a transaction' },
                        where: { bar: 'baz' },
                        individualHooks: true
                    });
                });
            });

            it('should apply sequelize options in the route definition', function () {
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo',
                            options: {
                                individualHooks: false
                            }
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                }).then(function (res) {
                    res.statusCode.should.equal(200);
                    destroyer.should.have.been.calledWith({
                        transaction: { me: 'i am a transaction' },
                        where: { bar: 'baz' },
                        individualHooks: false
                    });
                });
            });

            it('should use a configured scope by name', function () {
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo',
                            scope: 'customScope'
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.have.been.calledWith(['customScope']);
                    });
            });

            it('should use a configured null scope to unset the default scope', function () {
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo',
                            scope: null
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.have.been.calledWith(null);
                    });
            });

            it('should use a configured scope function', function () {
                const handlerScopeSpy = sinon.spy();
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo',
                            scope: handlerScopeSpy
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        handlerScopeSpy.should.have.been.calledOnce;
                        handlerScopeSpy.firstCall.args.should.have.length(1);
                    });
            });

            it(`should use a configured scope array of scope names`, () => {
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo',
                            scope: ['scope_one', 'scope_two']
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.have.been.calledWith(['scope_one', 'scope_two']);
                    });
            });

            it('should not invoke Model.scope() if no scope is supplied in the route definition', function () {
                server.route({
                    path: '/{bar}/foo',
                    method: 'delete',
                    handler: {
                        'db.remove': {
                            model: 'Foo'
                        }
                    }
                });

                return server.injectThen({
                    method: 'delete',
                    url: '/baz/foo'
                })
                    .then(res => {
                        res.statusCode.should.equal(200);
                        scope.should.not.have.been.called;
                    });
            });
        });
    });

});