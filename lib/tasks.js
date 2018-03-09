"use strict";
const Promise = require('bluebird');
const _ = require('lodash');
const logger = require('./logger');

module.exports = function setup(taskObj){
    var context = this;
    var tasks = getDeep(taskObj);
    var taskRunnerArray = [];

    for(var i in tasks){
        if(tasks[i][context.mode]){
            taskRunnerArray.push(runner(`${i}-${context.mode}`, tasks[i][context.mode]).bind(context));
        }
        if(tasks[i].all){
            taskRunnerArray.push(runner(`${i}-all`, tasks[i].all).bind(context));
        }
    }

    if(taskRunnerArray.length > 0){
        return function taskRunner(){
            return taskRunnerArray.reduce((acc, func) => {
                return acc.then(() => {
                    return func()
                })
            }, Promise.resolve(true))
        }
    } else {
        return function(){ logger.warn(`No Tasks Registered for ${context.mode} mode.`); return Promise.resolve(false) }
    }
}

function runner(name, taskPromiseArr){
    return function(){
        var context = this;
        var errorCount = 0;
        logger.info(`Running ${name} tasks...`)
        return taskPromiseArr.reduce((acc, val) => {
            return acc.then(function(){
                if(!val.precheck || typeof val.precheck != "function"){
                    val.precheck = function(){ return Promise.resolve(false) };
                }
                if(!val.complete || typeof val.complete != "function"){
                    val.complete = function(taskValue){ return Promise.resolve(false) };
                }
                let taskName = val.name || val.task.name || "task";
                return Promise.try(function(){
                    return val.precheck()
                })
                .catch(err => {
                    throw new context.errors.taskPrecheckError(err.message, err)
                })
                .then(alreadyPerformed => {
                    if(alreadyPerformed == true){
                        logger.warn(`${taskName} already performed, skipping...`)
                        return Promise.resolve();
                    } else {
                        logger.info(`Running ${taskName}...`)
                        return Promise.try(function(){
                            return val.task()
                        })
                        .catch(err => {
                            throw new context.errors.taskRunError(err.message, err)
                        })
                    }
                })
                .then(taskValue => {
                    return Promise.try(function(){
                        return val.complete(taskValue)
                    })
                    .catch(err => {
                        throw new context.errors.taskCompleteError(err.message, err)
                    })
                })
                .catch(context.errors.taskPrecheckError, err => {
                    logger.error("Error on task precheck...", JSON.stringify(err))
                    errorCount += 1;
                })
                .catch(context.errors.taskRunError, err => {
                    logger.error("Error on task run...", JSON.stringify(err))

                    errorCount += 1;
                })
                .catch(context.errors.taskCompleteError, err => {
                    logger.error("Error on task complete...", JSON.stringify(err))

                    errorCount += 1;
                })
                .catch(err => {
                    logger.error("Uncaught Error...", JSON.stringify(err))

                    errorCount += 1;
                })

            })
        }, Promise.resolve(true))
        .then(function(){
            logger.info(`${name} tasks completed with ${errorCount} errors.`)
        })
    }
}

function getDeep(taskObj, key){
    if(!key){
        key = "all";
    }
    var tasks = {};
    for(var i in taskObj){
        if(taskObj[i] instanceof Array){
            var taskSet = {};
            taskSet[i] = taskObj[i];
            tasks[key] = _.merge(tasks[key], taskSet)
            continue;
        }
        if(typeof taskObj[i] == "object"){
            var item = getDeep(taskObj[i], i);
            var key = Object.keys(item)[0];
            tasks[key] = _.merge(tasks[key], item[key]);
            continue;
        }
    }
    return tasks;
}