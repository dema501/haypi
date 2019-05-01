'use strict';
module.exports = (context, opts) => {

    if(!opts){
        opts = {}
    }
    if(!opts.ajv){
        opts.ajv = {}
    }

    const ajvIn = require('ajv')({
        v5: true,
        coerceTypes: opts.ajv.hasOwnProperty("coerceTypes") ? opts.ajv.coerceTypes : true,
        removeAdditional: opts.ajv.hasOwnProperty("removeAdditional") ? opts.ajv.removeAdditional : "all",
        useDefaults: opts.ajv.hasOwnProperty("useDefaults") ? opts.ajv.useDefaults : true,
        format: 'full',
        formats: {
            "zipcode": /^\d{5}(-\d{4})?$/,
        },
    });
    const ajvOut = require('ajv')({
        v5: true,
        removeAdditional: opts.ajv.hasOwnProperty("removeAdditional") ? opts.ajv.removeAdditional : "all",
        useDefaults: opts.ajv.hasOwnProperty("useDefaults") ? opts.ajv.useDefaults : true,
        coerceTypes: opts.ajv.hasOwnProperty("coerceTypes") ? opts.ajv.coerceTypes : false,
        format: 'full',
        formats: {
            "zipcode": /^\d{5}(-\d{4})?$/,
        },
    });

    let _ = require('lodash');
    let Promise = require('bluebird');
    let logger = require('./logger');

    function validator (ajv, schema, params) {
        let valid = null;
        try {
            valid = ajv.validate(schema, params);
        } finally {
            return !valid ? ajv.errorsText() : null;
        }
    };

    const errors = context.errors;

    function formatError (error) {
        return {
            error: {
                code: error.httpCode,
                type: error.type,
                internalCode: error.internalCode,
                message: error.message,
                details: error.details,
            },
        };
    }

    function redactValues (dict, schema) {
        const redactList = _.chain(dict).transform((result, val, key) => {
            if (_.get(schema, `properties.${key}.private`, false)) {
                result.push(key);
            };
        }, []).flatten([ 'password' ]).value();

        return _.transform(_.keys(dict), function (result, n) {
            result[n] = _.indexOf(redactList, n) !== -1 ? 'REDACTED' : dict[n];
        }, {});
    }

    function cleanParamsAndCallModelFn (name, schema, params, fn, errors, req) {
        opts.verbose && logger.info(name + " called with params:", JSON.stringify(redactValues(params, schema)));

        const validationErrors = validator(ajvIn, schema, params);
        if (validationErrors) {
            opts.verbose && logger.info(name + ' called with invalid params: ' + validationErrors);
            return Promise.reject(new errors.invalidParams("Invalid Params", validationErrors));
        }

        opts.verbose && logger.info(name + " cleaned params:", JSON.stringify(redactValues(params, schema)));

        let dataToReturn = null;
        // TODO write middleware and figure out what to pass through them
        return Promise.each(_.get(schema, 'middleware.before', []), (fn) => { return fn(params, req); })
        .then(() => Promise.try(() => fn(params, req)))
        .then((data) => {
            dataToReturn = data;
            return Promise.each(_.get(schema, 'middleware.after', []), (fn) => { return fn(params, req); });
        }).then(() => {
            const validationErrors = validator(ajvOut, schema.response, dataToReturn);
            if (validationErrors) {
                opts.verbose && logger.info(name + ' response params are invalid: ' + validationErrors, dataToReturn);
                throw new errors.server("Invalid Response Params", validationErrors);
            }

            return dataToReturn
        });
    }
    return {
        handler: (name, schema, fn) => {
            return (req, res) => {
                let params = _.extend(req.body, req.files, req.query, req.params);

                return cleanParamsAndCallModelFn(name, schema, params, fn, errors, req).then((result) => {
                    const meta = _.get(schema, 'response.meta');

                    return res.status(meta.code).json({
                        meta: meta,
                        response: result,
                    });
        		}).catch(function (err) {
                    const out = []
                    
                    if (_.get(err, 'code', _.get(err, 'httpCode', 500)) >= 500) {
                        out.push(`SERVER ERROR => ${req.originalUrl}:`, _.get(err, 'stack', err));
                    } else {
                        out.push(`CLIENT ERROR => ${req.originalUrl}:`, _.get(err, 'message', err), JSON.stringify(params));
                    }
                    
                    logger.error.apply({}, out)

                    return res.status(err.httpCode).json(formatError(_.get(err, 'internalCode') ? err : new errors.server()));
        		});
        	};
        },
        formatError: formatError,
    };
}
