const redis = require('./lib/redis.js');
const {logToFile} = require('./lib/utils')
const {watchMarkPrice, watchPrivate, handleLogin} = require('./lib/websocket.js');
const order = require('./models/order')
const moment = require("moment/moment");
require('dotenv').config()
const debounce = require('lodash/debounce');

const cliArgs = process.argv.slice(2);

const user = {
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
};

const futuresInst = "ETH-USDT-230929";// 交割
const swapInst = "ETH-USDT-SWAP";  // 永续
const kcDiff = 9;// 开仓差价
const pcDiff = 14.5;// 平仓差价

const POSITION_KC = 'KC';// 开仓标识
const POSITION_PC = 'PC';// 平仓标识

const kcKey1 = POSITION_KC + futuresInst.replaceAll('-', '');
const kcKey2 = POSITION_KC + swapInst.replaceAll('-', '');
const pcKey1 = POSITION_PC + futuresInst.replaceAll('-', '');
const pcKey2 = POSITION_PC + swapInst.replaceAll('-', '');

/**
 * 生成批量下单参数
 * @param position KC PC
 * @param _args
 * @returns {{args: {instId: *, clOrdId, side: string, posSide: string, sz: *, tdMode: string, tag: string, ordType: string}[], op: string, id: string}}
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
            // side: side,
            // posSide: 'long',
            // instId: item?.instId,
            // sz: item?.sz,
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
 * 买入
 * @param ws
 * @param _args
 * @returns {Promise<boolean>}
 */
const handleBuy = async (ws, _args) => {
    if (await redis.get('buyLock')) return false;
    if (await redis.get(buyKey1) && await redis.get(buyKey2)) return false;

    await redis.set('buyLock', 1, 60); // 锁定60秒

    handleBatchOrder(ws, 'buy', _args);
}

const debouncedHandleBuy = debounce(handleBuy, 2000);

/**
 * 卖出
 * @param ws
 * @param _args
 * @returns {Promise<boolean>}
 */
const handleSell = async (ws, _args) => {
    if (await redis.get('sellLock')) return false;

    await redis.set('sellLock', 1, 60);

    handleBatchOrder(ws, 'sell', _args);
}

const debouncedHandleSell = debounce(handleSell, 2000);

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


(async () => {

    // 私有频道
    const ws = watchPrivate({
        onOpen: (ws) => handleLogin(ws, user),
        onMessage: (ws, result) => {
            if (result?.op === 'batch-orders') {
                logToFile('批量下单响应', result);
                result?.data.map(async ({sCode, clOrdId, ordId, tag}) => {
                    const side = tag.charAt(0);
                    if (sCode === '0') { // 下单成功，更新订单状态
                        await order.update({ordId, status: 'successful'}, {where: {clOrdId}})
                        if (side === POSITION_KC) { // 开仓成功，加入缓存，
                            await redis.set(tag, ordId)
                        } else if (side === POSITION_PC) { // 平仓成功，清理缓存
                            await redis.del(tag)
                        }
                    } else { // 买入或卖出失败
                        await order.update({ordId, status: 'failed'}, {where: {clOrdId}})
                        if (side === 'B') { // 买
                            console.log('重新买入')
                        } else if (side === 'S') { // 卖
                            console.log('重新卖出')
                        }
                    }
                })
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
                    await debouncedHandleBuy(ws, [
                        {instId: futuresInst, side: 'buy', posSide: 'long', sz: 1},
                        {instId: swapInst, side: 'sell', posSide: 'short', sz: 1}
                    ])
                } else {// 交割小于永续
                    await debouncedHandleBuy(ws, [
                        {instId: futuresInst, side: 'buy', posSide: 'long', sz: 1},
                        {instId: swapInst, side: 'sell', posSide: 'short', sz: 1}
                    ])
                }

            }

            if (diffAbs >= pcDiff) { // 卖出规则
                await debouncedHandleSell(ws, [{instId: futuresInst, sz: 1}, {instId: swapInst, sz: 1}])
            }
        }
    });
})()