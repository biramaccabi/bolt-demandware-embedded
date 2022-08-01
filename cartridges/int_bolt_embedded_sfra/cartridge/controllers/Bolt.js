'use strict';

/* API Includes */
var server = require('server');
var HttpResult = require('dw/svc/Result');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');

// Script includes
var LogUtils = require('~/cartridge/scripts/util/boltLogUtils');
var httpUtils = require('~/cartridge/scripts/services/httpUtils');
var constants = require('~/cartridge/scripts/util/constants');
var oAuth = require('~/cartridge/scripts/services/oAuth');
var account = require('~/cartridge/scripts/services/account');
var boltAccountUtils = require('~/cartridge/scripts/util/boltAccountUtils');

var log = LogUtils.getLogger('Bolt');

server.get('AccountExists', server.middleware.https, function (req, res, next) {
    var email = req.querystring.email;
    var response = httpUtils.restAPIClient('GET', constants.CHECK_ACCOUNT_EXIST_URL + encodeURIComponent(email));

    var returnObject = {};
    if (response.status === HttpResult.OK) {
        returnObject.hasBoltAccount = response.result.has_bolt_account;
    } else {
        returnObject.hasBoltAccount = false;
        returnObject.errorMessage = response.errors;
    }
    log.debug('{0} has bolt account: {1}', req.querystring.email, returnObject.hasBoltAccount);

    res.json(returnObject);
    next();
});

server.get('FetchOAuthToken', server.middleware.https, function (req, res, next) {
    var response = oAuth.fetchNewToken(req.querystring.code, req.querystring.scope);
    var returnObject = {};

    if (response.status === HttpResult.OK) {
        returnObject.accessToken = response.result.access_token;
        returnObject.refreshToken = response.result.refresh_token;
        session.custom.boltOAuthToken = response.result.access_token;
        session.custom.boltRefreshToken = response.result.refresh_token;
        session.custom.boltRefreshTokenScope = response.result.refresh_token_scope;
        // store OAuth token expire time in milliseconds, 1000 -> ONE_SECOND
        session.custom.boltOAuthTokenExpire = response.result.expires_in * 1000 + new Date().getTime();
        log.info('fetching oauth token succeeded');
    } else {
        var errorMsg = "Failed to fetch OAuth Token." + !empty(response.errors) && !empty(response.errors[0].message) ? response.errors[0].message : "";
        log.error(errorMsg);
        returnObject.errorMessage = errorMsg;
    }

    res.json(returnObject);
    next();
});

server.get('GetAccountDetails', server.middleware.https, function (req, res, next) {
    var boltOAuthToken = oAuth.getOAuthToken();
    if (empty(boltOAuthToken)) {
        let errorMessage = 'Bolt OAuth Token is missing';
        log.error(errorMessage);
        res.json({
            success: false,
            errorMessage: errorMessage
        });
    }

    var bearerToken = 'Bearer '.concat(boltOAuthToken);
    var response = httpUtils.restAPIClient('GET', constants.ACCOUNT_DETAILS_URL, null, '', bearerToken);

    var returnObject = {};
    if (response.status === HttpResult.OK) {
        var shopperDetails = response.result;
        var addAccountDetailsResult = account.addAccountDetailsToBasket(shopperDetails);
        if (addAccountDetailsResult.redirectShipping) {
            returnObject.redirectUrl = URLUtils.https('Checkout-Begin').append('stage', 'shipping').toString();
        } else if (addAccountDetailsResult.redirectBilling) {
            returnObject.redirectUrl = URLUtils.https('Checkout-Begin').append('stage', 'payment').toString();
        } else {
            returnObject.redirectUrl = URLUtils.https('Checkout-Begin').append('stage', 'placeOrder').toString();
        }
        returnObject.success = true;
    } else {
        returnObject.errorMessage = response.errors;
    }

    res.json(returnObject);
    next();
});

/**
 * Bolt-AccountLogOut : This endpoint is used to clear Bolt user information in the SFCC basket and session
 * @param {middleware} - server.middleware.https
 * @param {category} - sensitive
 * @param {returns} - json
 * @param {serverfunction} - post
 */
server.post('AccountLogOut', server.middleware.https, function (req, res, next) {
    try {
        boltAccountUtils.clearBoltSessionData();
        boltAccountUtils.clearShopperDataInBasket();
        var redirectURL = URLUtils.https('Checkout-Begin').append('stage', 'shipping');
        res.json({
            success: true,
            redirectUrl: redirectURL.toString()
        });
        log.info('logout succeed');
    } catch (e) {
        log.error('Bolt Account Logout: ' + e.message + ' ' + e.stack);
        res.setStatusCode('500');
        res.json({
            status: 'error',
            message: Resource.msg('account.logout.error.general', 'bolt', null)
        });
    }
    next();
});

module.exports = server.exports();
