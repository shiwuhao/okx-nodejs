const Sequelize = require('sequelize');
const moment = require('moment');

const db = new Sequelize({
    dialect: 'sqlite',
    storage: './database/db.sqlite',
});


module.exports = {db, Sequelize}