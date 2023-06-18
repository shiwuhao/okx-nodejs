const Sequelize = require('sequelize');
require('dotenv').config()

let db;
console.log(process.env.DB_CONNECTION);
if (process.env.DB_CONNECTION === 'mysql') {
    db = new Sequelize(process.env.DB_DATABASE, process.env.DB_USERNAME, process.env.DB_PASSWORD, {
        host: process.env.DB_HOST,
        dialect: 'mysql'
    });
} else {
    db = new Sequelize({dialect: 'sqlite', storage: './database/db.sqlite'});
}

module.exports = {db, Sequelize}