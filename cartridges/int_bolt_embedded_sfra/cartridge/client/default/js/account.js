'use strict';

var util = require('./util.js');
var constants = require('./constant.js');

/**
 * Auto log the user into their bolt account
 * @param {Object} authorizationComponent - authorization component
 * @returns {Promise} The returned promise to fetch account details
 */
async function autoLogin(authorizationComponent) {
    const authorizeResp = await authorizationComponent.authorize({});
    if (!authorizeResp) return;
    const OAuthResp = await authenticateUserWithCode(
        authorizeResp.authorizationCode,
        authorizeResp.scope
    );
    return getAccountDetails(OAuthResp.accessToken); // eslint-disable-line consistent-return
}

/**
 * This function uses the authCode and scope returned from authorizeWithEmail
 * after the user enters the 6 digits OTP code
 * It makes a call to Bolt-FetchOAuthToken controller to fetch Oauth token & refresh token
 * @param {string} authCode - auth Code
 * @param {string} scope - scope, both params are returned from authorizeWithEmail
 * @returns {Object} - an Ajax call to fetch oAuth token
 */
function authenticateUserWithCode(authCode, scope) {
    const authenticateUserUrl = $('.authenticate-bolt-user').val();
    const reqBody = {
        code: authCode,
        scope: scope
    };
    return $.ajax({
        url: authenticateUserUrl,
        method: 'GET',
        data: reqBody,
        error: function (jqXHR, error) {
            console.log(error);
        }
    });
}

/**
 * Get Account Details.
 * This function passes the Oauth token to bolt and retrieve the account details of a shopper
 * @param {string} oAuthToken - oAuth Token
 * @returns {Object} - an ajax call to fetch account details
 */
function getAccountDetails(oAuthToken) {
    const accountDetailUrl = $('.get-bolt-account-details').val();
    const reqBody = {
        bearerToken: oAuthToken
    };
    return $.ajax({
        url: accountDetailUrl,
        method: 'GET',
        data: reqBody,
        success: function (data) {
            window.location.href = data.redirectUrl;
        },
        error: function (jqXHR, error) {
            console.log(error);
        }
    });
}

/**
 * making an ajax call to sfcc backend to clear bolt account data
 */
exports.logout = function () {
    var url = $('.data-bolt-platform-side-logout-url').val();
    $.ajax({
        url: url,
        method: 'POST',
        success: function (data) {
            if (data.redirectUrl) {
                window.location.href = data.redirectUrl;
            }
        },
        error: function (err) {
            if (err.responseJSON.message) {
                $('.error-message').show();
                $('.error-message-text').text(err.responseJSON.message);
            }
        }
    });
};

/**
 * detect bolt auto login
 * @param {Object} authorizationComponent - authorization component
 */
exports.detectAutoLogin = function (authorizationComponent) {
    autoLogin(authorizationComponent);
};

/**
 * mount bolt login status component
 */
exports.mountLoginStatusComponent = function () {
    const boltPublishableKey = $('.bolt-publishable-key').val();
    const locale = $('.bolt-locale').val();
    const boltEmbedded = Bolt(boltPublishableKey, { // eslint-disable-line no-undef
        language: util.getISOCodeByLocale(locale)
    });
    const loginStatusComponent = boltEmbedded.create('login_status', {
        listeners: {
            logout: () => {
                this.logout();
            }
        }
    });
    if ($('#login-status').length > 0) {
        loginStatusComponent.mount('#login-status');
    }
};

/**
 * Display Bolt login status from iframe
 */
exports.displayBoltStatus = function () {
    $('#login-status').show();
    $('#bolt-platform-side-logout').hide();
    $('#default-customer-status').hide();
};

/**
 * Display Storefront Customer Information
 */
exports.displayCustomerInfo = function () {
    $('#bolt-platform-side-logout').show();
    $('#default-customer-status').show();
    $('#login-status').hide();
};

/**
 * Get cookie from browser
 * @param {string} cookieName - cookie name
 * @returns {string} cookie value
 */
exports.getCookie = function (cookieName) {
    let name = cookieName + '=';
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) { // eslint-disable-line no-plusplus
        let c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) === 0) {
            return c.substring(name.length, c.length);
        }
    }
    return '';
};

exports.setupListeners = async function () {
    // eslint-disable-next-line no-undef
    Bolt.getInstance().on('auto_authorize_complete', response => {
        if (!(response.result instanceof Error)) {
            (async function (authorizeResp) {
                const OAuthResp = await authenticateUserWithCode(
                    authorizeResp.authorizationCode,
                    authorizeResp.scope
                );
                return getAccountDetails(OAuthResp.accessToken);
            }(response.result));
        }
    });

    // eslint-disable-next-line no-undef
    Bolt.getInstance().on('auto_account_check_complete', response => {
        const $accountCheckbox = $('#acct-checkbox');
        if (response.result instanceof Error) {
            if (response.result.message === 'Invalid email') {
                $('.submit-customer').attr('disabled', 'true');
            }
            return;
        }
        if (response.result) {
            if ($accountCheckbox) {
                $accountCheckbox.hide();
            }
        } else {
            $('.submit-customer').removeAttr('disabled');
            if ($accountCheckbox) {
                $accountCheckbox.show();
            }
        }
        window.BoltAnalytics.checkoutStepComplete(constants.EventAccountRecognitionCheckPerformed, { hasBoltAccount: response.result, detectionMethod: 'email' });
    });
};
