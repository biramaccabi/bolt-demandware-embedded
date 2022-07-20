'use strict';

// API Includes
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var BasketMgr = require('dw/order/BasketMgr');
var StringUtils = require('dw/util/StringUtils');
var Site = require('dw/system/Site');
var HttpResult = require('dw/svc/Result');

// Script includes
var collections = require('*/cartridge/scripts/util/collections');
var boltHttpUtils = require('~/cartridge/scripts/services/httpUtils');
var constants = require('~/cartridge/scripts/util/constants');
var boltAccountUtils = require('~/cartridge/scripts/util/boltAccountUtils');
var logUtils = require('~/cartridge/scripts/util/boltLogUtils');
var log = logUtils.getLogger('Auth');

/**
 * Verify credit card information and create a payment instrument.
 * @param {dw.order.Basket} currentBasket - current basket
 * @param {Object} paymentInformation - object with payment information
 * @param {string} paymentMethodID - current payment method id
 * @param {Object} req - request
 * @returns {Object} JSON Object
 */
function handle(currentBasket, paymentInformation, paymentMethodID, req) {
    var useCreditCardToken = !empty(paymentInformation.creditCardToken);
    var useExistingCard = boltAccountUtils.loginAsBoltUser() && !empty(paymentInformation.selectedBoltPaymentID);
    if (!useCreditCardToken && !useExistingCard) {
        return {
            fieldErrors: {},
            serverErrors: [
                Resource.msg('payment.info.missing.error', 'bolt', null)
            ],
            error: true
        };
    }
    var paymentInstrument;
    // reset bolt related payment instrument
    Transaction.wrap(function () {
        var paymentInstruments = currentBasket.getPaymentInstruments(constants.BOLT_PAY);
        collections.forEach(paymentInstruments, function (item) {
            currentBasket.removePaymentInstrument(item);
        });
        var nonGCTotal = currentBasket.totalGrossPrice.subtract(currentBasket.giftCertificateTotalGrossPrice);
        paymentInstrument = currentBasket.createPaymentInstrument(paymentMethodID, nonGCTotal);
    });

    if (useExistingCard) {
        var selectedPaymentID = paymentInformation.selectedBoltPaymentID;
        var selectedBoltPayment = boltAccountUtils.getBoltPayment(currentBasket, selectedPaymentID);
        if (selectedBoltPayment === null) {
            return {
                fieldErrors: {},
                serverErrors: [
                    Resource.msg('payment.info.missing.error', 'bolt', null)
                ],
                error: true
            };
        }
        Transaction.wrap(function () {
            paymentInstrument.setCreditCardNumber(constants.CC_MASKED_DIGITS + selectedBoltPayment.last4);
            paymentInstrument.setCreditCardType(selectedBoltPayment.network);
            paymentInstrument.setCreditCardExpirationMonth(selectedBoltPayment.exp_month);
            paymentInstrument.setCreditCardExpirationYear(selectedBoltPayment.exp_year);
            paymentInstrument.custom.boltPaymentMethodId = selectedPaymentID;
            paymentInstrument.custom.basketId = currentBasket.UUID;
        });
    } else {
        Transaction.wrap(function () {
            paymentInstrument.setCreditCardNumber(constants.CC_MASKED_DIGITS + paymentInformation.lastFourDigits);
            paymentInstrument.setCreditCardType(paymentInformation.cardType);
            paymentInstrument.setCreditCardExpirationMonth(paymentInformation.expirationMonth);
            paymentInstrument.setCreditCardExpirationYear(paymentInformation.expirationYear);
            paymentInstrument.setCreditCardToken(paymentInformation.creditCardToken);
            paymentInstrument.custom.basketId = currentBasket.UUID;
            paymentInstrument.custom.boltCardBin = paymentInformation.bin;
            paymentInstrument.custom.boltTokenType = paymentInformation.token_type;
            paymentInstrument.custom.boltCreateAccount = paymentInformation.createAccount;
        });
    }

    return { fieldErrors: {}, serverErrors: [], error: false };
}

/**
 * Send authorize request to Bolt
 * @param {string} orderNumber - order number
 * @param {dw.order.PaymentInstrument} paymentInstrument - payment instrument to authorize
 * @param {dw.order.PaymentProcessor} paymentProcessor -  payment processor of current payment method
 * @return {Object} returns an response object
 */
function authorize(orderNumber, paymentInstrument, paymentProcessor) {
    Transaction.wrap(function () {
        paymentInstrument.paymentTransaction.setPaymentProcessor(paymentProcessor);
    });

    // build auth request
    var order = OrderMgr.getOrder(orderNumber);
    var authRequestObj = getAuthRequest(order, paymentInstrument);
    if (authRequestObj.error) {
        log.error(authRequestObj.errorMsg);
    }

    // send auth call
    var response = boltHttpUtils.restAPIClient(
        constants.HTTP_METHOD_POST,
        constants.AUTH_CARD_URL,
        JSON.stringify(authRequestObj.authRequest)
    );
    if (response.status && response.status === HttpResult.ERROR) {
        log.error(
            'Payment authorization failed, error: '
        + (!empty(response.errors) && !empty(response.errors[0].message)
            ? response.errors[0].message
            : '')
        );
        return { error: true };
    }

    // set payment transaction
    Transaction.wrap(function () {
        var transactionRef = response.transaction && response.transaction.reference
            ? response.transaction.reference
            : orderNumber;
        paymentInstrument.getPaymentTransaction().setTransactionID(transactionRef);
    });

    // save card to bolt account
    if (boltAccountUtils.loginAsBoltUser() && !empty(paymentInstrument.getCreditCardToken())) {
        boltAccountUtils.saveCardToBolt(order, paymentInstrument);
    }

    // save shipping address to bolt account
    var shippingAddress = order.getDefaultShipment().getShippingAddress();
    if (boltAccountUtils.loginAsBoltUser() && shippingAddress.custom.saveShippingToBolt === true) {
        boltAccountUtils.saveAddressToBolt(shippingAddress);
    }

    return { error: false };
}

/**
 * Create Authorization Request Body
 * @param {string} order - SFCC order object
 * @param {dw.order.PaymentInstrument} paymentInstrument - payment instrument to authorize
 * @return {Object} returns an response object
 */
function getAuthRequest(order, paymentInstrument) {
    if (empty(paymentInstrument)) {
        return { error: true, errorMsg: 'Missing payment instrument.' };
    }

    if (empty(paymentInstrument.custom.basketId)) {
        return { error: true, errorMsg: 'SFCC basket ID not found.' };
    }

    var userIdentifier = {
        email: order.getCustomerEmail(),
        phone: order.getBillingAddress().getPhone()
    };
    var userIdentity = {
        first_name: order.getBillingAddress().getFirstName(),
        last_name: order.getBillingAddress().getLastName()
    };

    var request = {
        cart: {
            order_reference: paymentInstrument.custom.basketId
        },
        division_id:
      Site.getCurrent().getCustomPreferenceValue('boltMerchantDivisionID')
      || '',
        source: constants.DIRECT_PAYMENTS,
        user_identifier: userIdentifier,
        user_identity: userIdentity,
        create_bolt_account: paymentInstrument.custom.boltCreateAccount
    };

    // use Bolt payment ID for Bolt
    if (boltAccountUtils.loginAsBoltUser() && paymentInstrument.custom.boltPaymentMethodId) {
        request.credit_card_id = paymentInstrument.custom.boltPaymentMethodId;
    } else {
        request.credit_card = {
            token: paymentInstrument.getCreditCardToken(),
            last4: paymentInstrument.getCreditCardNumberLastDigits(),
            bin: paymentInstrument.custom.boltCardBin,
            number: '',
            expiration:
        StringUtils.formatNumber(
            paymentInstrument.getCreditCardExpirationYear(),
            '0000'
        )
        + '-'
        + StringUtils.formatNumber(
            paymentInstrument.getCreditCardExpirationMonth(),
            '00'
        ),
            postal_code: order.getBillingAddress().getPostalCode(),
            token_type: constants.BOLT_TOKEN_TYPE
        };
    }

    return {
        authRequest: request,
        error: false
    };
}

module.exports = {
    Handle: handle,
    Authorize: authorize
};
