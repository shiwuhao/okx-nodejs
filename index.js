const redis = require('./lib/redis.js');
const {logToFile} = require('./lib/utils')
const {watchMarkPrice, watchPrivate, handleLogin} = require('./lib/websocket.js');
const order = require('./models/order')
const moment = require("moment/moment");
require('dotenv').config()
const debounce = require('lodash/debounce');

const args = process.argv.slice(2);

const user = {
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
};


const product1 = "ETH-USD-SWAP";
const product2 = "ETH-USDT-230929";
const buyPrice = 9;
const sellPrice = 15;

const buyKey1 = 'B' + product1.replaceAll('-', '');
const buyKey2 = 'B' + product2.replaceAll('-', '');
const sellKey1 = 'S' + product1.replaceAll('-', '');
const sellKey2 = 'S' + product2.replaceAll('-', '');

/**
 * 生成批量下单参数
 * @param side
 * @param _args
 * @returns {{args: {instId: *, clOrdId, side: string, posSide: string, sz: *, tdMode: string, tag: string, ordType: string}[], op: string, id: string}}
 */
const buildBatchOrderArgs = (side, _args = []) => {
    const prefix = side.charAt(0).toUpperCase();
    const batchId = prefix + moment().format('YYYYMMDDHHmmssSSS');
    const args = _args.map((item, index) => {
        return {
            side: side,
            tdMode: "cross",
            ordType: "market",
            posSide: 'long',
            tag: prefix + item?.instId.replaceAll('-', ''),
            clOrdId: batchId + prefix + (index + 1),
            // instId: item?.instId,
            // sz: item?.sz,
            ...item
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

const debouncedBatchOrder = debounce(handleBatchOrder, 2000);

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

    debouncedBatchOrder(ws, 'buy', _args);
}

/**
 * 卖出
 * @param ws
 * @param _args
 * @returns {Promise<boolean>}
 */
const handleSell = async (ws, _args) => {
    if (await redis.get('sellLock')) return false;

    await redis.set('sellLock', 1, 60);

    debouncedBatchOrder(ws, 'sell', _args);
}

/**
 * 计算两个产品的差价
 * @param products 产品列表
 * @param product1 产品1
 * @param product2 产品2
 * @returns {number}
 */
const computeDiff = (products, product1, product2) => {
    const diff = products?.[product1]?.['markPx'] - products?.[product2]?.['markPx']
    return parseFloat(Math.abs(diff).toFixed(2));
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
                    if (sCode === '0') { // 买入或卖出成功，更新订单状态
                        await order.update({ordId, status: 'successful'}, {where: {clOrdId}})
                        if (side === 'B') { // 买入成功，加入缓存，
                            await redis.set(tag, ordId)
                        } else if (side === 'S') { // 卖出成功，清理买入缓存
                            await redis.del(tag.replace('S', 'B'))
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
        products: [product1, product2],
        onMessage: async (response) => {
            const diff = computeDiff(response, product1, product2);
            if (args?.[0] === '--table') {
                console.clear();
                console.table(response)
                console.log('diff:', diff);
            }

            if (diff >= buyPrice && diff < sellPrice) { // 买入规则
                await handleBuy(ws, [{instId: product1, sz: 1}, {instId: product2, sz: 1}])
            }

            if (diff >= sellPrice) { // 卖出规则
                await handleSell(ws, [{instId: product1, sz: 1}, {instId: product2, sz: 1}])
            }
        }
    });
})()