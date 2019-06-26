'use strict';

const db = require('../db');
const su = require('../../lib');
const sequelize = exports.sequelize = db.sequelize;
const config = db.config;
const pg = require('pg');
const P = require('bluebird');

exports.models = require('../test-models')(sequelize);

//create associations after all models are defined
su.associate(sequelize);
su.enableLobSupport();

sequelize.patchUpsert();
// chai assertions
exports.sinon = require('sinon');
const chai = exports.chai = require('chai');
chai.use(require('sinon-chai'));
exports.should = chai.should();
exports.expect = chai.expect;

before(function () {
    return new P(function (resolve) {
        pg.connect({
            user: config.user,
            host: config.host,
            database: 'postgres'
        }, function (err, client, done) {
            if (err) {
                done(true);
                resolve(false);
                return;
            }

            client.query(`CREATE DATABASE ${config.database}`, function (err) {
                done(true);

                if (err) {
                    return resolve(false);
                }

                resolve(su.afterCreateDatabase(sequelize));
            });
        });
    });
});

//always sync the db prior to running a test
beforeEach(function () {
    return sequelize.sync({ force: true });
});