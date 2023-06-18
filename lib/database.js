const Sequelize = require('sequelize');
const moment = require('moment');

let db;
if (process.env.DB_CONNECTION === 'mysql') {
    db = new Sequelize(process.env.DB_DATABASE, process.env.DB_USERNAME, process.env.DB_PASSWORD, {
        host: process.env.DB_HOST,
        dialect: 'mysql'
    });
} else {
    db = new Sequelize({dialect: 'sqlite', storage: './database/db.sqlite'});
}

module.exports = {db, Sequelize}