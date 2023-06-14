const WebSocket = require('ws');
const CryptoJS = require("crypto-js");

/**
 * ws 心跳
 * @param ws
 * @returns {NodeJS.Timer}
 */
const heartbeat = (ws) => setInterval(() => ws.send('ping'), 5000);

/**
 * 公共频道
 * 监控标记价格
 * @param options {onMessage:()=>({}),products:['product1','product2']}
 * @returns {WebSocket}
 */
const watchMarkPrice = (options) => {
    const {onMessage = () => ({}), products = []} = options || {};
    let interval = 0;
    const result = {};

    // 订阅标记价格
    const subscribeMarkPrice = (ws) => {
        const args = products.map(item => ({channel: "mark-price", instId: item}))
        ws.send(JSON.stringify({op: "subscribe", args: args}));
    }

    const ws = new WebSocket('wss://wspap.okx.com:8443/ws/v5/public?brokerId=9999');
    ws.onopen = () => {
        interval = heartbeat(ws)
        subscribeMarkPrice(ws)
    }
    ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        const {arg, data} = JSON.parse(event.data);
        switch (arg.channel) {
            case 'mark-price':
                result[arg.instId] = data?.[0];
                onMessage(result, ws)
                break;
            default:
                console.log('未知的响应');
        }
    }
    ws.onclose = () => clearInterval(interval);

    return ws;
}

/**
 * 私有频道
 * @param options {onMessage:()=>({})}
 * @returns {WebSocket}
 */
const watchPrivate = (options = {}) => {
    const {onOpen = () => ({}), onMessage = () => ({}),} = options || {};
    const ws = new WebSocket('wss://wspap.okx.com:8443/ws/v5/private?brokerId=9999');
    let interval = 0;

    ws.onopen = () => {
        interval = heartbeat(ws);
        onOpen(ws);
    }
    ws.onclose = () => clearInterval(interval);
    ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        const result = JSON.parse(event.data);
        onMessage(ws, result);
    }
    return ws;
}

/**
 * 生成签名
 * @param timestamp
 * @param secret
 * @returns {*}
 */
const getSign = (timestamp, secret) => {
    return CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(timestamp + 'GET' + '/users/self/verify', secret));
}

/**
 * 登录
 * @param ws
 * @param options = {apiKey: string, apiSecret: string, passphrase: string}
 */
const handleLogin = (ws, options) => {
    const {apiKey, passphrase, apiSecret} = options || {};
    const timestamp = (Date.now() / 1000) + '';
    const args = [{apiKey, passphrase, timestamp, sign: getSign(timestamp, apiSecret)}];
    ws.send(JSON.stringify({op: "login", args: args}));
}

module.exports = {
    watchMarkPrice,
    watchPrivate,
    handleLogin,
}