const {db, Sequelize} = require("../lib/sqlite");
const moment = require('moment');

const Order = db.define('orders', {
    id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
    },
    batchId: {
        type: Sequelize.STRING,
        comment: '批次id',
        index: true,
    },
    ordId: {
        type: Sequelize.STRING,
        comment: '订单id',
        index: true,
    },
    clOrdId: {
        type: Sequelize.STRING,
        comment: '自定义订单id',
        index: true,
    },
    tag: {
        type: Sequelize.STRING,
        comment: '自定义标签',
    },
    ordType: {
        type: Sequelize.STRING,
        comment: '订单类型',
    },
    instId: {
        type: Sequelize.STRING,
        comment: '产品id',
    },
    sz: {
        type: Sequelize.STRING,
        comment: '委托数量',
    },
    px: {
        type: Sequelize.STRING,
        comment: '委托价格',
    },
    side: {
        type: Sequelize.STRING,
        comment: '交易方向',
    },
    tdMode: {
        type: Sequelize.STRING,
        comment: '交易模式',
    },
    status: {
        type: Sequelize.STRING,
        comment: '状态',
    },
    createdAt: {
        type: Sequelize.DATE,
        defaultValue: () => moment().add(8, 'hour').toDate() // 这里将当前时间增加了 8 小时
    },
    updatedAt: {
        type: Sequelize.DATE,
        defaultValue: () => moment().add(8, 'hour').toDate()
    },
}, {
    timestamps: true,
    hooks: {
        beforeUpdate: (order) => {
            order.updatedAt = moment().add(8, 'hour').toDate()
        },
    },
})

db.sync().then(() => console.log('Tables synced'));

module.exports = Order;