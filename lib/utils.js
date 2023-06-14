const fs = require('fs');
const moment = require('moment');

function logToFile(message,logData, logDir = './logs') {
    const today = moment().format('YYYY-MM-DD');
    const date = moment().format('YYYY-MM-DD HH:mm:ss');
    const fileName = `log-${today}.txt`;
    if (typeof logData === 'object') {
        logData = JSON.stringify(logData)
    }

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
    }

    const logFile = `${logDir}/${fileName}`;
    fs.appendFile(logFile, `[${date}] ${message}: ${logData}\n`, (err) => {
        if (err) throw err;
    });
}

module.exports = {logToFile}