'use strict';
/**
* Module dependencies.
*/

const _ = require('lodash');
const path = require("path");
const EventEmitter = require('events');
const express = require('express');
const Promise = require('bluebird');
Promise.config({cancellation: true});
const taskSetup = require("./tasks.js");
const logger = require('./logger');

module.exports = function (info) {
    var context = this;
    context.errors = require('./errors')(context);
    context.utils = require('./utils');
    if(context.helpers && typeof context.helpers == "function"){
        context.helpers = context.helpers();
    }

    if (!info) {
        info = {};
    }
    if (!info.protocol) {
        info.protocol = "http";
    }
    if (!info.host) {
        info.host = "0.0.0.0";
    }
    if (!info.port) {
        info.port = 3000;
    }
    info.name = context.name;
    //------------------------------------------------
    logger.info("STARTING UP");
    logger.info("INITIALIZING CONFIG VARS");
    //------------------------------------------------


    //normalize paths of all directories in context

    //------------------------------------------------
    logger.info("INITIALIZING GLOBALS")
    //------------------------------------------------
    var globalsHandler = context.globals;

    var app = require('./app')(context, info);

    //------------------------------------------------
    logger.info("ON INIT");
    //------------------------------------------------
    context.events.init.call(context, app, function () {
        let schemaHelpers = require('./schemaHelpers')(context, info);
        if(context.middleware && typeof context.middleware == "function"){
            context.middleware = context.middleware();
        }

        if(context.drivers && typeof context.drivers == "function"){
            var userDrivers = context.drivers()
        } else {
            var userDrivers = {}
        }

        return Promise.props(_.transform(userDrivers, (result, val, key) => {
            result[key] = val(context);
        }, {})).then((initializedDrivers) => {
            context.drivers = initializedDrivers;
            return;
        }).then(() => {
            let appDb = context.db;
            let appInterfaces = context.interfaces;
            let appSchemas = context.schemas;
            let appControllers = context.controllers;

            context.db = {};
            context.interfaces = {};
            context.schemas = {};
            context.controllers = {};

            if (!_.isArray(context.plugins)) {
                throw Error('plugins must be an array')
            }
            for (let p of context.plugins) {
                let plugin = p();
                _.assign(context.db, plugin.db)
                _.assign(context.errors, plugin.errors());
                _.assign(context.interfaces, plugin.interfaces());

                let schema = plugin.schemas();
                if (plugin.options.rootUri) {
                    schema = _.transform(schema, (result, val, key) => {
                        result[key] = _.assign(val, { rootUri: path.join(plugin.options.rootUri, val.rootUri) })
                    })
                }
                _.assign(context.schemas, schema);
                _.assign(context.controllers, plugin.controllers());
            }

            if (!context.env.get('frontend') && appDb && typeof appDb == "function") {
                _.assign(context.db, appDb());
            }
            _.assign(context.interfaces, appInterfaces());
            _.assign(context.schemas, appSchemas());
            _.assign(context.controllers, appControllers());

            const docs = require('json-schema-docs')({
                title: context.name,
                schema: schemaHelpers.formatSchemaForDocs(_.cloneDeep(context.schemas)),
            });

            app.get('/docs', function (req, res) {
                res.send(docs);
            });

            context.test = require('./test')(context);

            for (let p of context.plugins) {
                let plugin = p();
                context.test.addToSuite(plugin.tests());
            }

            app.use(context.rootUri, schemaHelpers.buildRouterFromSchema(express.Router(), context.schemas, context.controllers));
            app.use(context.mockRootUri + context.rootUri, schemaHelpers.buildMockRoutesFromSchema(express.Router(), context.schemas));

            if(context.tasks && (typeof context.tasks == "object" || typeof context.tasks == "function")){

                var taskObj = context.tasks;

                if(typeof context.tasks == "function"){
                    taskObj = context.tasks();
                }

                context.runTasks = taskSetup.call(context, taskObj)

            }

            context.events.postInit(app, function () {
                // catch and send 404
                const notFoundError = new context.errors.notFound();
                app.use(function (req, res) {
                    res.status(notFoundError.httpCode).json({
                        error: {
                            code: notFoundError.httpCode,
                            type: notFoundError.type,
                            internalCode: notFoundError.internalCode,
                            message: notFoundError.message,
                        },
                    });
                });

                // generic server error if something bad gets through request handler
                const serverError = new context.errors.server();
                app.use(function(err, req, res, next) {
                    console.log(err)
                    res.status(err.status || serverError.httpCode).json({
                        error: {
                            code: err.status || serverError.httpCode,
                            type: err.type || serverError.type,
                            internalCode: serverError.internalCode,
                            message: err.message || serverError.message,
                        },
                    })
                });


                var http = require('http');
                /**
                * Get port from environment and store in Express.
                */

                info.port = normalizePort(info.port);

                app.set('port', info.port);

                let server = http.createServer(app);

                /**
                * Listen on provided port, on all network interfaces.
                */

                context.events.start(server, function (err) {
                    if(err){
                        throw err;
                    }
                    startServer.call(context, server, info, {
                        afterStart: context.events.up,
                        shutdown: context.events.shutdown,
                    });
                });
            });
        })
    });
}

function normalizePort (val) {
    const port = parseInt(val, 10);

    if (isNaN(port)) {
        return val; // named pipe
    } else if (port >= 0) {
        return port; // port number
    } else {
        return false;
    }
}

function startServer (server, info, callbacks) {
    var context = this;
    let serverStatus = new EventEmitter();

    serverStatus.on("start", function(){
        server.listen(info.port, info.host);
        server.on('error', onError);
        server.on('listening', onListening);
    })

    serverStatus.on("started", function(bind){
        onClose(callbacks.shutdown)
        var serverInfo = {
            protocol: info.protocol,
            host: server.address().address,
            port: bind,
            name: info.name
        };
        context.serverInfo = serverInfo;
        callbacks.afterStart(serverInfo)
        var replMode = process.argv.slice(2).indexOf("repl") > -1 ? true : false;
        if(replMode){
            const repl = require('repl');
            var r = repl.start({prompt: `haypi:${context.name}>`})
            r.context.haypi = context;
            r.on("exit", () => {
                process.kill(process.pid, "SIGINT")
            })
            r.on("reset", replContext => {
                replContext.haypi = context;
            })
        }
    })

    function onError (error) {
        if (error.syscall !== 'listen') {
            throw error;
        }

        // handle specific listen errors with friendly messages
        switch (error.code) {
            case 'EACCES':
                console.error("PORT" + ' requires elevated privileges');
                process.exit(1);
                break;
            case 'EADDRINUSE':
                console.error("Port " + info.port + ' is already in use');
                info.port += 1;
                server.removeListener("error", onError);
                server.removeListener("listening", onListening);
                serverStatus.emit("start");
                break;
            default:
                throw error;
        }
    }

    function onListening () {
        let addr = server.address();
        logger.info(`Listening on port ${addr.port}`);
        serverStatus.emit("started", addr.port);
    }

    function onClose (cb) {
        process.on("beforeExit", function(){
            logger.info("BEFORE EXIT")
        })
        // process.on("exit", function(type){
        //     console.log("exiting")
        // });
        process.on("SIGTERM", function(){
            cb("SIGTERM", () => {
                process.exit();
            })
        });
        process.on("SIGINT", function(){
            cb("SIGINT", function(){
                process.exit()
            })
        });
        process.on("uncaughtException", function(err){
            console.error(err.stack)
            cb("EXCEPTION", () => {
                process.exit()
            })
        })
    }

    serverStatus.emit("start");
}
