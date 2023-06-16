const redis = require('./lib/redis.js');
const {logToFile} = require('./lib/utils')
const {watchMarkPrice, watchPrivate, handleLogin} = require('./lib/websocket.js');
const order = require('./models/order')
const moment = require("moment/moment");
require('dotenv').config()
const throttle = require('lodash/throttle');

const cliArgs = process.argv.slice(2);

const user = {
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
};

const futuresInst = "ETH-USDT-230929";// 交割
const swapInst = "ETH-USDT-SWAP";  // 永续
const kcDiff = 9;// 开仓差价
const pcDiff = 12.10;// 平仓差价
const sz = 1;//数量

const POSITION_KC = 'KC';// 开仓标识
const POSITION_PC = 'PC';// 平仓标识

/**
 * 生成批量下单参数
 * @param position
 * @param _args
 * @returns {{args: (*&{clOrdId, tdMode: string, tag, ordType: string})[], op: string, id: string}}
 */
const buildBatchOrderArgs = (position, _args = []) => {
    const batchId = position + moment().format('YYYYMMDDHHmmssSSS');
    const args = _args.map((item, index) => {
        return {
            tdMode: "cross",
            ordType: "market",
            tag: position + item?.instId.replaceAll('-', ''),
            clOrdId: batchId + position + (index + 1),
            ...item,
        }
    });
    return {id: batchId, op: "batch-orders", args: args};
}

/**
 * 批量下单
 * @param ws
 * @param side
 * @param _args
 */
const handleBatchOrder = (ws, side, _args) => {
    const params = buildBatchOrderArgs(side, _args)

    const orders = params.args.map((item) => ({batchId: params.id, ...item}))
    order.bulkCreate(orders).then(() => logToFile('批量下单请求', params))

    ws.send(JSON.stringify(params));
}

/**
 * 开仓
 * @param ws
 * @param _args
 * @returns {Promise<boolean>}
 */
const handleKC = async (ws, _args) => {
    const lockKey = POSITION_KC + ':lock';
    if (await redis.get(lockKey) || await redis.get(POSITION_KC)) return false; // 校验锁和开仓订单

    await redis.set(lockKey, 1, 60); // 锁定60秒

    handleBatchOrder(ws, POSITION_KC, _args);
}

/**
 * 平仓
 * @param ws
 * @param _args
 * @returns {Promise<boolean>}
 */
const handlePC = async (ws, _args) => {
    const lockKey = POSITION_PC + ':lock';
    if (await redis.get(lockKey)) return false;

    await redis.set(lockKey, 1, 60);// 锁定60秒

    handleBatchOrder(ws, POSITION_PC, _args);
}

const throttleHandleKC = throttle(handleKC, 2000);
const throttleHandlePC = throttle(handlePC, 2000);

/**
 * 计算两个产品的差价
 * @param products 产品列表
 * @param product1 产品1
 * @param product2 产品2
 * @returns {number}
 */
const computeDiff = (products, product1, product2) => {
    const diff = products?.[product1]?.['markPx'] - products?.[product2]?.['markPx']
    return parseFloat(diff.toFixed(2));
}

/**
 * cli面板
 * @param response
 * @param diff
 */
const consoleTable = (response, diff) => {
    console.clear();
    console.table(response)
    console.log('diff ', diff);
}

/**
 * 批量下单响应
 * @param result
 * @returns {Promise<void>}
 */
const handleBatchOrderCallback = async (result) => {
    const {id: batchId, op, code, data} = result || {};
    const position = batchId.substring(0, 2);// 截取前两位标识，用于判断开仓还是平仓

    if (code === '0') {
        logToFile('批量下单响应:successful', result);
        // 全部成功,更新数据库状态
        data.map(({ordId, clOrdId}) => order.update({ordId, status: 'successful'}, {where: {clOrdId}}));

        // 开仓成功，缓存批次订单号
        if (position === POSITION_KC) await redis.set(position, batchId);

        // 平仓成功，清理缓存，一个买卖周期结束
        if (position === POSITION_PC) {
            await redis.del(POSITION_KC);
        }

    } else { // 有失败,更新状态，并删除下单锁
        logToFile('批量下单响应:failed', result);
        data.map(({ordId, clOrdId}) => order.update({ordId, status: 'failed'}, {where: {clOrdId}}));
        await redis.del(position); // 缓存标记成功
    }
}

(async () => {

    // 私有频道自动登录
    const privateWs = watchPrivate({
        onOpen: (ws) => handleLogin(ws, user),
        onMessage: async (ws, result) => {
            switch (result?.op) {
                case 'batch-orders': // 批量下单响应
                    await handleBatchOrderCallback(result);
                    break;
                default:
                    logToFile('未知的响应', result);
            }
        }
    });

    // 公共频道标记价格
    watchMarkPrice({
        products: [futuresInst, swapInst],
        onMessage: async (response) => {
            const diff = computeDiff(response, futuresInst, swapInst); // 交割和永续差价
            const diffAbs = Math.abs(diff); // 差价绝对值
            if (cliArgs?.[0] === '--table') consoleTable(response, diff);
            if (diffAbs >= kcDiff && diffAbs < pcDiff) { // 开仓规则
                if (diff > 0) { // 交割大于永续
                    await throttleHandleKC(privateWs, [
                        {instId: futuresInst, side: 'buy', posSide: 'long', sz: sz},
                        {instId: swapInst, side: 'sell', posSide: 'short', sz: sz}
                    ])
                } else {// 交割小于永续
                    await throttleHandleKC(privateWs, [
                        {instId: futuresInst, side: 'buy', posSide: 'long', sz: sz},
                        {instId: swapInst, side: 'sell', posSide: 'short', sz: sz}
                    ])
                }
            }

            if (diffAbs >= pcDiff) { // 平仓规则
                const batchId = await redis.get(POSITION_KC);
                const orderList = await order.findAll({where: {batchId}, raw: true});
                if (!batchId || !orderList) return logToFile('平仓异常:', '找不到订单信息');

                const args = orderList.map(item => {
                    const {instId, sz, posSide, side} = item;
                    return {instId, posSide, sz, side: side === 'buy' ? 'sell' : 'buy'};
                })

                await throttleHandlePC(privateWs, args);
            }
        }
    });
})()