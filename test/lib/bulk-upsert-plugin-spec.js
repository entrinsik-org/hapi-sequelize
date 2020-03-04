'use strict';

const common = require('./common');
const Foo = common.models.Foo;
const Bar = common.models.Bar;
const TestBaz = common.models.TestBaz;
const TestBlah = common.models.TestBlah;
const sequelize = common.sequelize;
const DataTypes = sequelize.Sequelize;
const should = common.should;
const _ = require('lodash');
const stream = require('stream');
const es = require('ent-streams');
const P = sequelize.Sequelize.Promise;

describe('bulk upsert plugin', function () {

    describe('.bulkUpsertStream()', function () {

        it('should add the function to the prototype of Model', function () {
            Foo.should.respondTo('bulkUpsertStream');
        });

        it('should reject attempts to bulk upsert an undefined value', function () {
            return Foo.bulkUpsertStream().should.be.rejectedWith(Error);
        });

        it('should reject attemps to bulk upsert a non-Readable stream', function () {
            return Foo.bulkUpsertStream(new stream.Writable()).should.be.rejectedWith(Error);
        });

        it('should reject attempts to bulk upsert a non-Array object', function () {
            return Foo.bulkUpsertStream({}).should.be.rejectedWith(Error);
        });

        it('should gracefully continue if passed an empty array', function () {
            return Foo.bulkUpsertStream([]).should.become(Foo);
        });

        it('should insert from an array', function () {
            const defns = [];
            _.times(5, n => defns.push({
                id: `id${n}`,
                immutableAttr: `immutable value ${n}`,
                name: `My Foo ${n}`,
                deepMerge: {
                    [n]: {
                        [`${n}property`]: n
                    }
                }
            }));
            return sequelize.requiresTransaction(t => Foo.bulkUpsertStream(defns, {
                omit: ['_changes'],
                transaction: t
            }))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(5);
                    _(foos)
                        .map(f => f.get())
                        .forEach((f, idx) => {
                            f.should.have.property('id', `id${idx}`);
                            f.should.have.property('immutableAttr', `immutable value ${idx}`);
                            f.should.have.property('name', `My Foo ${idx}`);
                            f.deepMerge[idx][`${idx}property`].should.equal(idx);
                        });
                });
        });

        it('should insert from a stream', function () {
            const defns = [];
            _.times(5, n => defns.push({
                id: `id${n}`,
                immutableAttr: `immutable value ${n}`,
                name: `My Foo ${n}`,
                deepMerge: {
                    [n]: {
                        [`${n}property`]: n
                    }
                }
            }));
            const $stream = es.readArray(defns);
            return sequelize.requiresTransaction(t => Foo.bulkUpsertStream($stream, {
                omit: ['_changes'],
                transaction: t
            }))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(5);
                    _(foos)
                        .map(f => f.get())
                        .forEach((f, idx) => {
                            f.should.have.property('id', `id${idx}`);
                            f.should.have.property('immutableAttr', `immutable value ${idx}`);
                            f.should.have.property('name', `My Foo ${idx}`);
                            f.deepMerge[idx][`${idx}property`].should.equal(idx);
                        });
                });
        });

        it('should update from a stream', function () {
            const $records = es.readArray([{
                id: 'foo',
                immutableAttr: 'asdf',
                name: 'My Foo',
                deepMerge: {
                    current: {
                        one: true
                    }
                },
                overwrite: {
                    current: {
                        one: true
                    }
                }
            },
                {
                    id: 'bar',
                    immutableAttr: 'fdas',
                    name: 'My Bar',
                    deepMerge: {
                        old: {
                            two: false
                        }
                    },
                    overwrite: {
                        old: {
                            two: false
                        }
                    }
                }]);
            return Foo.create({
                id: 'foo',
                immutableAttr: 'Foo\'s immutable value',
                name: 'Foo',
                deepMerge: {
                    old: {
                        two: false
                    }
                },
                overwrite: {
                    old: {
                        two: false
                    }
                }
            })
                .then(() => Foo.create({
                    id: 'bar',
                    immutableAttr: 'Bar\s immutable value',
                    name: 'Bar',
                    deepMerge: {
                        current: {
                            one: true
                        }
                    },
                    overwrite: {
                        current: {
                            one: true
                        }
                    }
                }))
                .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsertStream($records, {
                    omit: ['_changes'],
                    transaction: t
                })))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(2);
                    _.forEach(foos, f => {
                        ['foo', 'bar'].should.include(f.id);
                        if (f.id === 'foo') {
                            f.name.should.equal('My Foo');
                            f.overwrite.current.one.should.equal(true);
                            should.not.exist(f.overwrite.old);
                            should.exist(f.deepMerge.old);
                            should.exist(f.deepMerge.current);
                        } else {
                            f.name.should.equal('My Bar');
                            f.overwrite.old.two.should.equal(false);
                            should.not.exist(f.overwrite.current);
                            should.exist(f.deepMerge.old);
                            should.exist(f.deepMerge.current);
                        }
                    });
                });
        });

        it('should update from an array', function () {
            const records = [{
                id: 'foo',
                immutableAttr: 'asdf',
                name: 'My Foo',
                deepMerge: {
                    current: {
                        one: true
                    }
                },
                overwrite: {
                    current: {
                        one: true
                    }
                }
            },
                {
                    id: 'bar',
                    immutableAttr: 'fdas',
                    name: 'My Bar',
                    deepMerge: {
                        old: {
                            two: false
                        }
                    },
                    overwrite: {
                        old: {
                            two: false
                        }
                    }
                }];
            return Foo.create({
                id: 'foo',
                immutableAttr: 'Foo\'s immutable value',
                name: 'Foo',
                deepMerge: {
                    old: {
                        two: false
                    }
                },
                overwrite: {
                    old: {
                        two: false
                    }
                }
            })
                .then(() => Foo.create({
                    id: 'bar',
                    immutableAttr: 'Bar\s immutable value',
                    name: 'Bar',
                    deepMerge: {
                        current: {
                            one: true
                        }
                    },
                    overwrite: {
                        current: {
                            one: true
                        }
                    }
                }))
                .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsertStream(records, {
                    omit: ['_changes'],
                    transaction: t
                })))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(2);
                    _.forEach(foos, f => {
                        ['foo', 'bar'].should.include(f.id);
                        if (f.id === 'foo') {
                            f.name.should.equal('My Foo');
                            f.overwrite.current.one.should.equal(true);
                            should.not.exist(f.overwrite.old);
                            should.exist(f.deepMerge.old);
                            should.exist(f.deepMerge.current);
                        } else {
                            f.name.should.equal('My Bar');
                            f.overwrite.old.two.should.equal(false);
                            should.not.exist(f.overwrite.current);
                            should.exist(f.deepMerge.old);
                            should.exist(f.deepMerge.current);
                        }
                    });
                });
        });

        it('should insert and update from a stream', function () {
            const $records = es.readArray([
                {
                    id: 'bar',
                    immutableAttr: 'aaa',
                    name: 'Bar',
                    deepMerge: {
                        old: {
                            two: false
                        }
                    },
                    overwrite: {
                        old: {
                            two: false
                        }
                    }
                },
                {
                    id: 'foo',
                    immutableAttr: 'zzz',
                    name: 'Upserted Foo',
                    deepMerge: {
                        current: {
                            one: true
                        }
                    },
                    overwrite: {
                        current: {
                            one: true
                        }
                    }
                },
                {
                    id: 'baz',
                    immutableAttr: 'bbb',
                    name: 'BAZZZZZ',
                    deepMerge: {
                        extra: {
                            three: true
                        }
                    },
                    overwrite: {
                        extra: {
                            three: true
                        }
                    }
                }
            ]);
            return Foo.create({
                id: 'foo',
                immutableAttr: 'immutable',
                name: 'Foo',
                deepMerge: {
                    start: {
                        three: true
                    }
                },
                overwrite: {
                    start: {
                        three: true
                    }
                }
            })
                .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsertStream($records, {
                    omit: ['_changes'],
                    transaction: t
                })))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(3);
                    _.forEach(foos, foo => {
                        ['foo', 'bar', 'baz'].should.include(foo.id);
                        if (foo.id === 'foo') {
                            foo.name.should.equal('Upserted Foo');
                            foo.immutableAttr.should.equal('zzz');
                            foo.deepMerge.current.one.should.equal(true);
                            foo.deepMerge.start.three.should.equal(true);
                            foo.overwrite.current.one.should.equal(true);
                        } else if (foo.id === 'bar') {
                            foo.name.should.equal('Bar');
                            foo.immutableAttr.should.equal('aaa');
                            foo.deepMerge.old.two.should.equal(false);
                            foo.overwrite.old.two.should.equal(false);
                        } else if (foo.id === 'baz') {
                            foo.name.should.equal('BAZZZZZ');
                            foo.immutableAttr.should.equal('bbb');
                            foo.deepMerge.extra.three.should.equal(true);
                            foo.overwrite.extra.three.should.equal(true);
                        } else {
                            throw new Error(`Got an unknown id: ${foo.id}`);
                        }
                    });
                });
        });

        it('should insert and update from an array', function () {
            const records = [
                {
                    id: 'bar',
                    immutableAttr: 'aaa',
                    name: 'Bar',
                    deepMerge: {
                        old: {
                            two: false
                        }
                    },
                    overwrite: {
                        old: {
                            two: false
                        }
                    }
                },
                {
                    id: 'foo',
                    immutableAttr: 'zzz',
                    name: 'Upserted Foo',
                    deepMerge: {
                        current: {
                            one: true
                        }
                    },
                    overwrite: {
                        current: {
                            one: true
                        }
                    }
                },
                {
                    id: 'baz',
                    immutableAttr: 'bbb',
                    name: 'BAZZZZZ',
                    deepMerge: {
                        extra: {
                            three: true
                        }
                    },
                    overwrite: {
                        extra: {
                            three: true
                        }
                    }
                }
            ];
            return Foo.create({
                id: 'foo',
                immutableAttr: 'immutable',
                name: 'Foo',
                deepMerge: {
                    start: {
                        three: true
                    }
                },
                overwrite: {
                    start: {
                        three: true
                    }
                }
            })
                .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsertStream(records, {
                    omit: ['_changes'],
                    transaction: t
                })))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(3);
                    _.forEach(foos, foo => {
                        ['foo', 'bar', 'baz'].should.include(foo.id);
                        if (foo.id === 'foo') {
                            foo.name.should.equal('Upserted Foo');
                            foo.immutableAttr.should.equal('zzz');
                            foo.deepMerge.current.one.should.equal(true);
                            foo.deepMerge.start.three.should.equal(true);
                            foo.overwrite.current.one.should.equal(true);
                        } else if (foo.id === 'bar') {
                            foo.name.should.equal('Bar');
                            foo.immutableAttr.should.equal('aaa');
                            foo.deepMerge.old.two.should.equal(false);
                            foo.overwrite.old.two.should.equal(false);
                        } else if (foo.id === 'baz') {
                            foo.name.should.equal('BAZZZZZ');
                            foo.immutableAttr.should.equal('bbb');
                            foo.deepMerge.extra.three.should.equal(true);
                            foo.overwrite.extra.three.should.equal(true);
                        } else {
                            throw new Error(`Got an unknown id: ${foo.id}`);
                        }
                    });
                });
        });

        it('should always add timestamp attribute values to records if a model has timestamp fields', function () {
            const records = [{ id: 'bar', name: 'Bar', birthday: new Date() }, {
                id: 'foo',
                name: 'Foo',
                birthday: new Date()
            }];
            return sequelize.requiresTransaction(t => Bar.bulkUpsertStream(records, { transaction: t }))
                .then(() => Bar.findAll())
                .then(bars => {
                    should.exist(bars);
                    bars.should.have.length(2);
                    _.every(bars, bar => {
                        should.exist(bar.createdAt);
                        should.exist(bar.updatedAt);
                    });
                });
        });

        it('should trim virtual fields from records', function () {
            let error;
            const Baz = sequelize.define('Baz', {
                name: { type: DataTypes.STRING, primaryKey: true }
            }, {
                tableName: 'bazz',
                getterMethods: {
                    id() {
                        return this.name.toUpperCase();
                    }
                }
            });
            return sequelize.sync({ force: true })
                .then(() => sequelize.requiresTransaction(t => Baz.bulkUpsertStream([
                    { id: 1, name: 'firstBaz' },
                    { id: 2, name: 'secondBaz' }
                ], { transaction: t, idFields: ['name'] }))
                    .then(() => Baz.findAll())
                    .then(bazz => {
                        should.exist(bazz);
                        bazz.should.have.length(2);
                        _.every(bazz, b => {
                            should.exist(b.id);
                            b.id.should.not.be.a('number');
                            b.id.should.be.a('string');
                            b.id.should.equal(b.name.toUpperCase());
                        });
                    }));

        });

        it('should remap record values for field with different db column name', function () {
            let error;
            const Baz = sequelize.define('Baz', {
                name: { type: DataTypes.STRING, primaryKey: true },
                data: { type: DataTypes.STRING, field: 'my_data_field' }
            }, { tableName: 'bazz', timestamps: false });
            return sequelize.sync({ force: true })
                .then(() => sequelize.requiresTransaction(t => Baz.bulkUpsertStream([{
                    name: 'BazBaz',
                    data: 'Some data for BazBaz'
                }], {
                    transaction: t,
                    idFields: ['name']
                }))
                    .then(() => Baz.findAll())
                    .then(bazz => {
                        should.exist(bazz);
                        bazz.should.have.length(1);
                        _.first(bazz).name.should.equal('BazBaz');
                        _.first(bazz).data.should.equal('Some data for BazBaz');
                    }));
        });

        it('should remap record values for primary key field with different db column name', function () {
            let error;
            const Baz = sequelize.define('Baz', {
                name: { type: DataTypes.STRING, primaryKey: true, field: 'my_custom_name' }
            }, { tableName: 'bazz' });
            return sequelize.sync({ force: true })
                .then(() => sequelize.requiresTransaction(t => Baz.bulkUpsertStream([{ name: 'BazBaz' }], {
                    transaction: t,
                    idFields: ['name']
                }))
                    .then(() => Baz.findAll())
                    .then(bazz => {
                        should.exist(bazz);
                        bazz.should.have.length(1);
                        _.first(bazz).name.should.equal('BazBaz');
                    })
                    .catch(err => error = err));
        });

        describe('errors', function () {
            it('should not do anything to the database if an error occurs', function () {
                let upsertError;
                const $records = es.readArray([{
                    id: 'foo',
                    immutableAttr: 'asdf',
                    name: 'My Foo',
                    deepMerge: {
                        current: {
                            one: true
                        }
                    },
                    overwrite: {
                        current: {
                            one: true
                        }
                    }
                },
                    {
                        id: 'foo',
                        immutableAttr: 'this wont be a value',
                        name: 'FOO',
                        deepMerge: {
                            current: {
                                one: false
                            }
                        },
                        overwrite: {
                            current: {
                                one: false
                            }
                        }
                    }]);
                return Foo.create({
                    id: 'foo',
                    immutableAttr: 'Foo\'s immutable value',
                    name: 'Foo',
                    deepMerge: {
                        old: {
                            two: false
                        }
                    },
                    overwrite: {
                        old: {
                            two: false
                        }
                    }
                })
                    .then(() => Foo.bulkUpsertStream($records, { omit: ['_changes'] }))
                    .catch(err => upsertError = err)
                    .finally(() => {
                        should.exist(upsertError);
                        return Foo.findAll()
                            .then(foos => {
                                foos.should.have.length(1);
                                _.first(foos).id.should.equal('foo');
                                _.first(foos).immutableAttr.should.equal(`Foo's immutable value`);
                                _.first(foos).name.should.equal('Foo');
                                _.first(foos).deepMerge.old.two.should.equal(false);
                                _.first(foos).overwrite.old.two.should.equal(false);
                            });
                    });
            });

            it('should not prevent further interaction if an error occurs', function () {
                const badRecords = [
                    {
                        id: 'bar',
                        immutableAttr: 'aaa',
                        name: 'Bar',
                        deepMerge: {
                            current: {
                                one: true
                            }
                        },
                        overwrite: {
                            current: {
                                one: true
                            }
                        }
                    },
                    {
                        id: 'bar',
                        immutableAttr: 'aaaaaa',
                        name: 'BarBar',
                        deepMerge: {
                            current: {
                                one: false
                            }
                        },
                        overwrite: {
                            current: {
                                one: false
                            }
                        }
                    }
                ];
                const goodRecords = [
                    {
                        id: 'bar',
                        immutableAttr: 'aaa',
                        name: 'BAR',
                        deepMerge: {
                            current: {
                                one: true
                            }
                        },
                        overwrite: {
                            current: {
                                one: true
                            }
                        }},
                    {
                        id: 'foo',
                        immutableAttr: 'aaaaaa',
                        name: 'FOOFOO',
                        deepMerge: {
                            current: {
                                one: false
                            }
                        },
                        overwrite: {
                            current: {
                                one: false
                            }
                        }
                    }
                ];
                let badRecErr, goodRecErr;
                return Foo.create({
                    id: 'foo',
                    immutableAttr: 'immutable',
                    name: 'Foo',
                    deepMerge: {
                        old: {
                            one: true
                        }
                    },
                    overwrite: {
                        old: {
                            one: true
                        }
                    }
                })
                    .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsertStream(badRecords, {
                        omit: ['_changes'],
                        transaction: t
                    })))
                    .catch(err => {
                        badRecErr = err;
                        return sequelize.requiresTransaction(t => Foo.bulkUpsertStream(goodRecords, {
                            omit: ['_changes'],
                            transaction: t
                        }))
                            .catch(err => goodRecErr = err);
                    })
                    .finally(() => {
                        should.exist(badRecErr);
                        should.not.exist(goodRecErr);
                        return Foo.findAll()
                            .then(foos => {
                                foos.should.have.length(2);
                                _.forEach(foos, foo => {
                                    ['foo', 'bar'].should.include(foo.id);
                                    if (foo.id === 'foo') {
                                        foo.name.should.equal('FOOFOO');
                                        foo.immutableAttr.should.equal('aaaaaa');
                                    } else {
                                        foo.name.should.equal('BAR');
                                        foo.immutableAttr.should.equal('aaa');
                                    }
                                });
                            });
                    });
            });

            it('should not prevent further interaction if a constraint violation occurs', function () {
                let error;
                const records = [{ id: 'bar', name: 'Bar' }, { id: 'foo', name: 'Foo' }];
                return sequelize.requiresTransaction(t => Bar.bulkUpsertStream(records, { transaction: t }))
                    .then(() => should.not.exist(`should not succeed`))
                    .catch(err => error = err)
                    .finally(() => {
                        let secondError;
                        should.exist(error);
                        return sequelize.requiresTransaction(t => Bar.bulkUpsertStream(_.map(records, r => _.set(r, 'birthday', new Date())), { transaction: t }))
                            .then(() => Bar.findAll())
                            .then(bars => {
                                should.exist(bars);
                                bars.should.have.length(2);
                                _.every(bars, bar => {
                                    should.exist(bar.createdAt);
                                    should.exist(bar.updatedAt);
                                    should.exist(bar.birthday);
                                });
                            })
                            .catch(err => secondError = err)
                            .finally(() => should.not.exist(secondError));
                    });
            });

            it('should forward db-related writing errors that occur to the dialect for formatting & packaging', function () {
                const ensure = (Model, rec) => P.resolve()
                    .then(() => {
                        const instance = Model.build(rec);
                        instance.set({ parentId: 1 });
                        return instance.get();
                    })
                    .then(recs => [].concat(recs || []));

                const bazRecordsNoOptional = () => ensure(TestBaz, { bazId: 'myBaz' });
                const blahRecordsOptional = () => ensure(TestBlah, {
                    optionalId: 'myOptional',
                    bazId: 'myBaz',
                    blahId: 'myBlah'
                });

                return P.resolve()
                    .then(() => sequelize.requiresTransaction(t => bazRecordsNoOptional().then(recs => TestBaz.bulkUpsertStream(recs, { transaction: t }))))
                    .then(() => sequelize.requiresTransaction(t => blahRecordsOptional().then(recs => TestBlah.bulkUpsertStream(recs, { transaction: t }))))
                    .should.eventually.be.rejectedWith(sequelize.ForeignKeyConstraintError);
            });

            it('should fail properly if the source stream errors initially during an upstream piped-to transform', function () {
                // this.timeout(5000);
                class InStreamError extends Error {
                    constructor (message) {
                        super(message);
                        this.name = 'InStreamError';
                    }
                }
                const $stream = new stream.Transform({ objectMode: true });
                $stream._transform = function (rec, end, next) {
                    next(new InStreamError('Error while streaming'));
                };
                const $source = new stream.PassThrough({ objectMode: true });
                return P.resolve()
                    .then(() => sequelize.requiresTransaction(t => {
                        setTimeout(() => $source.write('foo'), 100);
                        return TestBaz.bulkUpsertStream($source.pipe($stream), { transaction: t });
                    }))
                    .then(() => should.not.exist(`should not succeed`))
                    .finally(() => TestBaz.findAll()
                        .then(bazz => bazz.should.have.length(0)))
                    .should.eventually.be.rejectedWith(InStreamError);
            });

            it('should properly fail if the source record stream immediately emits an error', function () {
                // this.timeout(5000);
                class InStreamError extends Error {
                    constructor (message) {
                        super(message);
                        this.name = 'InStreamError';
                    }
                }
                const $stream = new stream.Readable({ objectMode: true });
                $stream._read = function () {
                    this.emit('error', new InStreamError('Error while streaming'));
                };

                return P.resolve()
                    .then(() => sequelize.requiresTransaction(t => TestBaz.bulkUpsertStream($stream, { transaction: t })))
                    .then(() => should.not.exist(`should not succeed`))
                    .finally(() => TestBaz.findAll()
                        .then(bazz => bazz.should.have.length(0)))
                    .should.eventually.be.rejectedWith(InStreamError);
            });

            it('should properly fail if the source record stream emits an error later', function () {
                // this.timeout(5000);
                class InStreamError extends Error {
                    constructor (message) {
                        super(message);
                        this.name = 'InStreamError';
                    }
                }
                const recs = [
                    { id: 'bar', immutableAttr: 'aaa', name: 'Bar' },
                    { id: 'foo', immutableAttr: 'zzz', name: 'Upserted Foo' }
                ];
                const $stream = new stream.Readable({ objectMode: true });
                $stream._read = function () {
                    if (recs.length) {
                        return this.push(recs.pop());
                    } else {
                        setTimeout(() => this.emit('error', new InStreamError('Error while streaming')), 500);
                    }
                };
                return P.resolve()
                    .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsertStream($stream, { transaction: t })))
                    .then(() => should.not.exist(`should not succeed`))
                    .finally(() => Foo.findAll()
                        .then(foos => foos.should.have.length(0)))
                    .should.eventually.be.rejectedWith(InStreamError);
            });
        });

    });

    describe('.bulkUpsert()', function () {
        it('should add the function to a Model', function () {
            Foo.should.respondTo('bulkUpsert');
        });

        it('should gracefully continue if passed an empty array', function () {
            return Foo.bulkUpsert([]).should.become(Foo);
        });

        it('should insert and update', function () {
            const records = [
                {
                    id: 'bar',
                    immutableAttr: 'aaa',
                    name: 'Bar',
                    deepMerge: {
                        old: {
                            two: false
                        }
                    },
                    overwrite: {
                        old: {
                            two: false
                        }
                    }
                },
                {
                    id: 'foo',
                    immutableAttr: 'zzz',
                    name: 'Upserted Foo',
                    deepMerge: {
                        current: {
                            one: true
                        }
                    },
                    overwrite: {
                        current: {
                            one: true
                        }
                    }
                }
            ];
            return Foo.create({
                id: 'foo',
                immutableAttr: 'immutable',
                name: 'Foo',
                deepMerge: {
                    start: {
                        three: true
                    }
                },
                overwrite: {
                    start: {
                        three: true
                    }
                }
            })
                .then(() => sequelize.requiresTransaction(t => Foo.bulkUpsert(records, {
                    omit: ['_changes'],
                    transaction: t
                })))
                .then(() => Foo.findAll())
                .then(foos => {
                    foos.should.have.length(2);
                    _(foos)
                        .forEach(foo => {
                            if (foo.id === 'foo') {
                                foo.name.should.equal('Upserted Foo');
                                foo.immutableAttr.should.equal('zzz');
                                foo.deepMerge.current.one.should.equal(true);
                                foo.deepMerge.start.three.should.equal(true);
                                foo.overwrite.current.one.should.equal(true);
                                should.not.exist(foo.overwrite.start);
                            } else if (foo.id === 'bar') {
                                foo.name.should.equal('Bar');
                                foo.immutableAttr.should.equal('aaa');
                                foo.deepMerge.old.two.should.equal(false);
                                foo.overwrite.old.two.should.equal(false);
                            } else {
                                throw new Error(`Got an unknown id: ${foo.id}`);
                            }
                        });
                });
        });

        it('should trim virtual fields from records', function () {
            let error;
            const Baz = sequelize.define('Baz', {
                name: { type: DataTypes.STRING, primaryKey: true }
            }, {
                tableName: 'bazz',
                getterMethods: {
                    id() {
                        return this.name.toUpperCase();
                    }
                }
            });
            return sequelize.sync({ force: true })
                .then(() => sequelize.requiresTransaction(t => Baz.bulkUpsert([
                    { id: 1, name: 'firstBaz' },
                    { id: 2, name: 'secondBaz' }
                ], { transaction: t, idFields: ['name'] }))
                    .then(() => Baz.findAll())
                    .then(bazz => {
                        should.exist(bazz);
                        bazz.should.have.length(2);
                        _.every(bazz, b => {
                            should.exist(b.id);
                            b.id.should.not.be.a('number');
                            b.id.should.be.a('string');
                            b.id.should.equal(b.name.toUpperCase());
                        });
                    }));

        });

        it('should remap record values for field with different db column name', function () {
            let error;
            const Baz = sequelize.define('Baz', {
                name: { type: DataTypes.STRING, primaryKey: true },
                data: { type: DataTypes.STRING, field: 'my_data_field' }
            }, { tableName: 'bazz', timestamps: false });
            return sequelize.sync({ force: true })
                .then(() => sequelize.requiresTransaction(t => Baz.bulkUpsert([{
                    name: 'BazBaz',
                    data: 'Some data for BazBaz'
                }], {
                    transaction: t,
                    idFields: ['name']
                }))
                    .then(() => Baz.findAll())
                    .then(bazz => {
                        should.exist(bazz);
                        bazz.should.have.length(1);
                        _.first(bazz).name.should.equal('BazBaz');
                        _.first(bazz).data.should.equal('Some data for BazBaz');
                    }));
        });

        it('should remap record values for primary key field with different db column name', function () {
            let error;
            const Baz = sequelize.define('Baz', {
                name: { type: DataTypes.STRING, primaryKey: true, field: 'my_custom_name' }
            }, { tableName: 'bazz' });
            return sequelize.sync({ force: true })
                .then(() => sequelize.requiresTransaction(t => Baz.bulkUpsert([{ name: 'BazBaz' }], {
                    transaction: t,
                    idFields: ['name']
                }))
                    .then(() => Baz.findAll())
                    .then(bazz => {
                        should.exist(bazz);
                        bazz.should.have.length(1);
                        _.first(bazz).name.should.equal('BazBaz');
                    }));
        });
    });
});