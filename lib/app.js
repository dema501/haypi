var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser');
var path = require('path');
var _ = require('lodash');

logger.token("time", function(req, res){
  return new Date().toUTCString()
})

logger.token("status", function(req, res){
  return res.statusCode;
})

// Retrieve ln-app-device header.
logger.token('token', function getId(req) {
  return req.headers['token'];
});


module.exports = function (context, info) {
  var app = express();

  app.use(logger(':time :method :url :status [:response-time] ms - :res[content-length] - :token'));

  var opts = _.pick(info, ["limit"])
  app.use(bodyParser.json(opts));
  app.use(bodyParser.urlencoded({ extended: false }));

  if(context.viewEngine){
    app.set('view engine', context.viewEngine);
    app.use(express.static(context.publicDirectory));
    app.set('views', context.publicDirectory + "/views");
  }

  app.use(function(req, res, next){
    context.events.request.call(context, req, res, next);
  })

  return app;
}
