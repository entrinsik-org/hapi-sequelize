'use strict';

const su = require('../lib');
const Sequelize = su.Sequelize;

su.enablePlugins();
su.enableBulkUpsert();
su.enableRequiresTransaction();

/**
 * Postgres 9.4+ is required
 *
 * prior to running test:
 *      - need user 'test'
 *      - need postgres db 'hapi_sequelize'
 *      - need connect permission configured for user/database on postgres db server
 *
 * 1) at a terminal (ubuntu):
 *      sudo -u postgres createuser -D -A -P test
 *              (no password when prompted)
 *      sudo -u postgres createdb -O test hapi_sequelize
 *
 * 2) in your pg_hba.conf:
 *      - add entry under local:
 *          local    hapi_sequelize    test                                    trust
 *      - add entry under IPv4 local connections:
 *          host    hapi_sequelize    test            127.0.0.1/32            trust
 */
const config = {
    host: 'localhost',
    database: 'hapi_sequelize',
    user: 'i5'
};

const sequelize = new Sequelize(config.database, config.user, config.password, {
    host: config.host,
    //logging: false,
    dialect: 'postgres'
});

exports.su = su;
exports.sequelize = sequelize;
exports.config = config;
