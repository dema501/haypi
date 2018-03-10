const logLocal = (type) => {
    const log = console[type];

    return (...params) => {
        if (type.indexOf('time') === -1) {
            params.unshift('[' + type.toUpperCase() + ']');
            params.unshift(new Date());
        }

        log(...params);
    };
}

/* shim for allowing a different logger in production while keeping the same interface for the app.
you can use an if/else based on env, if you want to use something other than just console for logs  */
module.exports = {
    debug: logLocal('log'),
    info: logLocal('info'),
    error: logLocal('error'),
    warn: logLocal('warn'),
    time: logLocal('time'),
    timeEnd: logLocal('timeEnd'),
};
