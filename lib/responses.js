var _ = require('lodash');
const logger = require('./logger');

function errorHandler(context, req, res, err, message){
    logger.error(err, message);

    var data = {
        responseText: this.error,
        error: _.get(err, "body", err),
        message: message || _.get(err, "message", null) || _.get(err, "body.message", null),
        statusCode: this.statusCode
    };
    context.events.response.call(context, req, res, data);
    res.status(this.statusCode).json(data);
}

function negotiate(context, req, res, err, message, defaultStatus){
    if(!defaultStatus){
        defaultStatus = 500;
    }

    status = _.get(err, "statusCode", defaultStatus).toString();
    //search for more statuses and make smart decisions

    //if an internal service gives a 400 that's a 500 facing outward, bad requests should be stopped at crud service
    //if the crud service gives a 400 that's a 400
    //pretty much all others bubble up

    if(statusCodeMap[status]){
        return statusCodeMap[status](context, req, res, err, message);
    }
    return responses.serverError(context, req, res, err, message);
}

function successHandler(context, req, res, data){
    var resp = {};
    if(!data){
        data = {};
    }
    if(data.body){
        data = data.body;
    }
    if(typeof data === "object" && !(data instanceof Array)){
        resp = data;
    }
    else if(data instanceof Array){
        resp.data = data;
        resp.count = data.length;
    } else {
        resp.data = data;
    }
    context.events.response.call(context, req, res, data);
    res.status(this.statusCode).json(resp);
}

var responses = {
    ok: successHandler.bind({statusCode: 200}),
    created: successHandler.bind({statusCode: 201}),
    accepted: successHandler.bind({statusCode: 202}),
    badRequest: errorHandler.bind({statusCode: 400, error: "BAD REQUEST"}),
    unauthorized: errorHandler.bind({statusCode: 401, error: "UNAUTHORIZED"}),
    forbidden: errorHandler.bind({statusCode: 403, error: "FORBIDDEN"}),
    notFound: errorHandler.bind({statusCode: 404, error: "NOT FOUND"}),
    tooLarge: errorHandler.bind({statusCode: 413, error: "REQUEST ENTITY TOO LARGE"}),
    unsupportedMediaType: errorHandler.bind({statusCode: 415, error: "UNSUPPORTED MEDIA TYPE"}),
    serverError: errorHandler.bind({statusCode: 500, error: "SERVER ERROR"}),
    negotiate: negotiate
}

var statusCodeMap = {
    "200": responses.ok,
    "201": responses.created,
    "202": responses.accepted,
    "400": responses.badRequest,
    "401": responses.unauthorized,
    "403": responses.forbidden,
    "404": responses.notFound,
    "413": responses.tooLarge,
    "415": responses.unsupportedMediaType,
    "500": responses.serverError,
}

module.exports = function(req, res){
    var context = this;
    for(var resp in responses){
        res[resp] = responses[resp].bind(null, context, req, res);
    }
}