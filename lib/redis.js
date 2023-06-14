const redis = require('redis');
const {promisify} = require('util');

class Redis {
    constructor(host, port, password) {
        this.client = redis.createClient({host, port, password});
        this.getAsync = promisify(this.client.get).bind(this.client);
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.client.on('connect', () => {
                resolve();
            });
            this.client.on('error', (err) => {
                reject(err);
            });
        });
    }

    async set(key, value, expire) {
        const setAsync = promisify(this.client.set).bind(this.client);
        const expireAsync = promisify(this.client.expire).bind(this.client);
        await setAsync(key, value);
        if (expire) {
            await expireAsync(key, expire);
        }
    }

    async get(key) {
        return await this.getAsync(key);
    }

    async del(key) {
        const delAsync = promisify(this.client.del).bind(this.client);
        return await delAsync(key);
    }

    async close() {
        this.client.quit();
    }
}

module.exports = new Redis('127.0.0.1', 6379)
