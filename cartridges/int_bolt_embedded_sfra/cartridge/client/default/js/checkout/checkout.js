'use strict';

var base = require('base/checkout/checkout');
var shippingHelpers = require('base/checkout/shipping');
var customerHelpers = require('base/checkout/customer');
var formHelpers = require('base/checkout/formErrors');
var scrollAnimate = require('base/components/scrollAnimate');

var billingHelpers = require('./billing');
var addressHelpers = require('./address');
var constants = require('../constant');

(function ($) {
    /**
     * This wrap function is to used to keep the logic in sync way
     * @param {function} fn - function
     * @returns {Object} - Deferred Object
     */
    function wrapQ(fn) {
        var defer = $.Deferred();
        fn().then(defer.resolve).catch(defer.reject);
        return defer;
    }
    /**
     * Trigger event and keep it sync
     * @param {string} name - event name
     * @returns {Promise} - Promise
     */
    function triggerEvent(name) {
        return new Promise((resolve, reject) => {
            $('body').trigger(name, { resolve, reject });
        });
    }

    $.fn.checkout = function () { // eslint-disable-line
        var plugin = this;

        //
        // Collect form data from user input
        //
        var formData = {
            // Customer Data
            customer: {},

            // Shipping Address
            shipping: {},

            // Billing Address
            billing: {},

            // Payment
            payment: {},

            // Gift Codes
            giftCode: {}
        };

        //
        // The different states/stages of checkout
        //
        var checkoutStages = [
            'customer',
            'shipping',
            'payment',
            'placeOrder',
            'submitted'
        ];

        /**
         * Updates the URL to determine stage
         * @param {number} currentStage - The current stage the user is currently on in the checkout
         */
        function updateUrl(currentStage) {
            history.pushState( // eslint-disable-line no-restricted-globals
                checkoutStages[currentStage],
                document.title,
                location.pathname // eslint-disable-line no-restricted-globals
                + '?stage='
                + checkoutStages[currentStage]
                + '#'
                + checkoutStages[currentStage]
            );
        }

        //
        // Local member methods of the Checkout plugin
        //
        var members = {

            // initialize the currentStage variable for the first time
            currentStage: 0,

            /**
             * Set or update the checkout stage (AKA the shipping, billing, payment, etc... steps)
             * @returns {Promise} a promise
             */
            updateStage: function () {
                var stage = checkoutStages[members.currentStage];
                var defer = $.Deferred(); // eslint-disable-line

                if (stage === 'customer') {
                    //
                    // Clear Previous Errors
                    //
                    customerHelpers.methods.clearErrors();
                    //
                    // Submit the Customer Form
                    //
                    var customerFormSelector = customerHelpers.methods.isGuestFormActive()
                        ? customerHelpers.vars.GUEST_FORM : customerHelpers.vars.REGISTERED_FORM;
                    var customerForm = $(customerFormSelector);
                    $.ajax({
                        url: customerForm.attr('action'),
                        type: 'post',
                        data: customerForm.serialize(),
                        success: function (data) {
                            if (data.redirectUrl) {
                                window.location.href = data.redirectUrl;
                            } else {
                                customerHelpers.methods.customerFormResponse(defer, data);
                            }
                        },
                        error: function (err) {
                            if (err.responseJSON && err.responseJSON.redirectUrl) {
                                window.location.href = err.responseJSON.redirectUrl;
                            }
                            // Server error submitting form
                            defer.reject(err.responseJSON);
                        }
                    });
                    return defer;
                } if (stage === 'shipping') {
                    //
                    // Clear Previous Errors
                    //
                    formHelpers.clearPreviousErrors('.shipping-form');

                    //
                    // Submit the Shipping Address Form
                    //
                    var isMultiShip = $('#checkout-main').hasClass('multi-ship');
                    var formSelector = isMultiShip
                        ? '.multi-shipping .active form' : '.single-shipping .shipping-form';
                    var form = $(formSelector);

                    if (isMultiShip && form.length === 0) {
                        // disable the next:Payment button here
                        $('body').trigger('checkout:disableButton', '.next-step-button button');
                        // in case the multi ship form is already submitted
                        var url = $('#checkout-main').attr('data-checkout-get-url');
                        $.ajax({
                            url: url,
                            method: 'GET',
                            success: function (data) {
                                // enable the next:Payment button here
                                $('body').trigger('checkout:enableButton', '.next-step-button button');
                                if (!data.error) {
                                    $('body').trigger(
                                        'checkout:updateCheckoutView',
                                        { order: data.order, customer: data.customer }
                                    );
                                    defer.resolve();
                                } else if (data.message && $('.shipping-error .alert-danger').length < 1) {
                                    var errorMsg = data.message;
                                    var errorHtml = '<div class="alert alert-danger alert-dismissible valid-cart-error '
                                        + 'fade show" role="alert">'
                                        + '<button type="button" class="close" data-dismiss="alert" aria-label="Close">'
                                        + '<span aria-hidden="true">&times;</span>'
                                        + '</button>' + errorMsg + '</div>';
                                    $('.shipping-error').append(errorHtml);
                                    scrollAnimate($('.shipping-error'));
                                    defer.reject();
                                } else if (data.redirectUrl) {
                                    window.location.href = data.redirectUrl;
                                }
                            },
                            error: function () {
                                // enable the next:Payment button here
                                $('body').trigger('checkout:enableButton', '.next-step-button button');
                                // Server error submitting form
                                defer.reject();
                            }
                        });
                    } else {
                        var shippingFormData = form.serialize();

                        $('body').trigger('checkout:serializeShipping', {
                            form: form,
                            data: shippingFormData,
                            callback: function (data) {
                                shippingFormData = data;
                            }
                        });
                        // disable the next:Payment button here
                        $('body').trigger('checkout:disableButton', '.next-step-button button');
                        $.ajax({
                            url: form.attr('action'),
                            type: 'post',
                            data: shippingFormData,
                            success: function (data) {
                                // enable the next:Payment button here
                                $('body').trigger('checkout:enableButton', '.next-step-button button');
                                shippingHelpers.methods.shippingFormResponse(defer, data);
                            },
                            error: function (err) {
                                // enable the next:Payment button here
                                $('body').trigger('checkout:enableButton', '.next-step-button button');
                                if (err.responseJSON && err.responseJSON.redirectUrl) {
                                    window.location.href = err.responseJSON.redirectUrl;
                                }
                                // Server error submitting form
                                defer.reject(err.responseJSON);
                            }
                        });
                    }
                    const isBoltShopperLoggedIn = $('.bolt-is-shopper-logged-in').val();
                    const eventPayload = { loginStatus: isBoltShopperLoggedIn ? 'logged-in' : 'guest' };

                    // sending both shipping event here as we don't know
                    // when the action is complete unless shopper clicks continue button
                    window.BoltAnalytics.checkoutStepComplete(
                        constants.EventShippingDetailsFullyEntered,
                        eventPayload
                    );
                    window.BoltAnalytics.checkoutStepComplete(
                        constants.EventShippingMethodStepComplete
                    );
                    return defer;
                } if (stage === 'payment') {
                    return wrapQ(async () => { // eslint-disable-line consistent-return
                        //
                        // Submit the Billing Address Form
                        //

                        formHelpers.clearPreviousErrors('.payment-form');

                        var billingAddressForm = $('#dwfrm_billing .billing-address-block :input').serialize();

                        $('body').trigger('checkout:serializeBilling', {
                            form: $('#dwfrm_billing .billing-address-block'),
                            data: billingAddressForm,
                            callback: function (data) {
                                if (data) {
                                    billingAddressForm = data;
                                }
                            }
                        });

                        var contactInfoForm = $('#dwfrm_billing .contact-info-block :input').serialize();

                        $('body').trigger('checkout:serializeBilling', {
                            form: $('#dwfrm_billing .contact-info-block'),
                            data: contactInfoForm,
                            callback: function (data) {
                                if (data) {
                                    contactInfoForm = data;
                                }
                            }
                        });

                        var activeTabId = $('.tab-pane.active').attr('id');
                        var paymentInfoSelector = '#dwfrm_billing .' + activeTabId + ' .payment-form-fields :input';
                        var paymentInfoForm = $(paymentInfoSelector).serialize();

                        const boltPaymentATag = $('[data-method-id="BOLT_PAY"] a');
                        const boltPaymentFields = $('bolt-pay');
                        const shouldTokenize = boltPaymentATag && boltPaymentATag.hasClass('active') && !boltPaymentFields.hasClass('d-done');
                        if (shouldTokenize) {
                            await triggerEvent('checkout:tokenize');
                        }

                        $('body').trigger('checkout:serializeBilling', {
                            form: $(paymentInfoSelector),
                            data: paymentInfoForm,
                            callback: function (data) {
                                if (data) {
                                    paymentInfoForm = data;
                                }
                            }
                        });

                        var paymentForm = billingAddressForm + '&' + contactInfoForm + '&' + paymentInfoForm;

                        if ($('.data-checkout-stage').data('customer-type') === 'registered') {
                            // if payment method is credit card
                            if ($('.payment-information').data('payment-method-id') === 'CREDIT_CARD') {
                                if (!($('.payment-information').data('is-new-payment'))) {
                                    var cvvCode = $('.saved-payment-instrument.'
                                        + 'selected-payment .saved-payment-security-code').val();

                                    if (cvvCode === '') {
                                        var cvvElement = $('.saved-payment-instrument.'
                                            + 'selected-payment '
                                            + '.form-control');
                                        cvvElement.addClass('is-invalid');
                                        scrollAnimate(cvvElement);
                                        defer.reject();
                                        return defer;
                                    }

                                    var $savedPaymentInstrument = $('.saved-payment-instrument'
                                        + '.selected-payment');

                                    paymentForm += '&storedPaymentUUID='
                                        + $savedPaymentInstrument.data('uuid');

                                    paymentForm += '&securityCode=' + cvvCode;
                                }
                            }
                        }
                        // disable the next:Place Order button here
                        $('body').trigger('checkout:disableButton', '.next-step-button button');

                        // reset payment error message
                        $('.bolt-error-message').attr('hidden', true);
                        $('.bolt-error-message-text').text('');

                        // submit payment info to SFCC BED
                        await new Promise((resolve, reject) => {
                            $.ajax({
                                url: $('#dwfrm_billing').attr('action'),
                                method: 'POST',
                                data: paymentForm,
                                success: function (data) {
                                    // enable the next:Place Order button here
                                    $('body').trigger('checkout:enableButton', '.next-step-button button');
                                    // look for field validation errors
                                    if (data.error) {
                                        if (data.fieldErrors.length) {
                                            // check if it's bolt payment validation error
                                            const tokenKey = 'dwfrm_billing_boltCreditCard_token';
                                            // eslint-disable-next-line max-len
                                            const boltPaymentError = data.fieldErrors.find(function (error) {
                                                return tokenKey in error;
                                            });
                                            if (boltPaymentError) {
                                                /* eslint-disable max-len */
                                                // Actually tokenization process will do the cc field validation
                                                // So if token or other data is missing, it means the tokenization process is not success
                                                // We should display a general error message to remind shopper to check the credit card information
                                                /* eslint-disable max-len */
                                                $('.bolt-error-message').removeAttr('hidden');
                                                $('.bolt-error-message-text').text(boltPaymentError[tokenKey]);
                                            } else {
                                                data.fieldErrors.forEach(function (error) {
                                                    if (Object.keys(error).length) {
                                                        formHelpers.loadFormErrors('.payment-form', error);
                                                    }
                                                });
                                            }
                                        }

                                        if (data.serverErrors.length) {
                                            data.serverErrors.forEach(function (error) {
                                                $('.error-message').show();
                                                $('.error-message-text').text(error);
                                                scrollAnimate($('.error-message'));
                                            });
                                        }

                                        if (data.cartError) {
                                            window.location.href = data.redirectUrl;
                                        }

                                        reject();
                                    } else {
                                        //
                                        // Populate the Address Summary
                                        //
                                        $('body').trigger(
                                            'checkout:updateCheckoutView',
                                            { order: data.order, customer: data.customer }
                                        );

                                        if (data.renderedPaymentInstruments) {
                                            $('.stored-payments').empty().html(
                                                data.renderedPaymentInstruments
                                            );
                                        }

                                        if (data.customer.registeredUser
                                            && data.customer.customerPaymentInstruments.length
                                        ) {
                                            $('.cancel-new-payment').removeClass('checkout-hidden');
                                        }

                                        scrollAnimate();
                                        resolve(data);
                                    }
                                },
                                error: function (err) {
                                    // enable the next:Place Order button here
                                    $('body').trigger('checkout:enableButton', '.next-step-button button');
                                    if (err.responseJSON && err.responseJSON.redirectUrl) {
                                        window.location.href = err.responseJSON.redirectUrl;
                                    }
                                    reject();
                                }
                            });
                        });
                        // sending both shipping event here as we don't know when the action is complete unless
                        // shopper clicks continue button
                        window.BoltAnalytics.checkoutStepComplete(constants.EventPaymentMethodSelected);
                        window.BoltAnalytics.checkoutStepComplete(constants.EventPaymentDetailsFullyEntered);
                    });
                    // return defer;
                } if (stage === 'placeOrder') {
                    // disable the placeOrder button here
                    $('body').trigger('checkout:disableButton', '.next-step-button button');
                    $.ajax({
                        url: $('.place-order').data('action'),
                        method: 'POST',
                        success: function (data) {
                            // enable the placeOrder button here
                            $('body').trigger('checkout:enableButton', '.next-step-button button');
                            if (data.error) {
                                if (data.cartError) {
                                    window.location.href = data.redirectUrl;
                                    defer.reject();
                                } else {
                                    // go to appropriate stage and display error message
                                    defer.reject(data);
                                }
                            } else {
                                var redirect = $('<form>')
                                    .appendTo(document.body)
                                    .attr({
                                        method: 'POST',
                                        action: data.continueUrl
                                    });

                                $('<input>')
                                    .appendTo(redirect)
                                    .attr({
                                        name: 'orderID',
                                        value: data.orderID
                                    });

                                $('<input>')
                                    .appendTo(redirect)
                                    .attr({
                                        name: 'orderToken',
                                        value: data.orderToken
                                    });

                                window.BoltAnalytics.checkoutStepComplete(constants.EventPaymentComplete);
                                redirect.submit();
                                defer.resolve(data);
                            }
                        },
                        error: function () {
                            // enable the placeOrder button here
                            window.BoltAnalytics.checkoutStepComplete(constants.EventPaymentRejected);
                            $('body').trigger('checkout:enableButton', $('.next-step-button button'));
                        }
                    });
                    window.BoltAnalytics.checkoutStepComplete(constants.EventClickPayButton);

                    return defer;
                }
                var p = $('<div>').promise(); // eslint-disable-line
                setTimeout(function () {
                    p.done(); // eslint-disable-line
                }, 500);
                return p; // eslint-disable-line
            },

            /**
             * Initialize the checkout stage.
             *
             */
            initialize: function () {
                // set the initial state of checkout
                members.currentStage = checkoutStages
                    .indexOf($('.data-checkout-stage').data('checkout-stage'));
                $(plugin).attr('data-checkout-stage', checkoutStages[members.currentStage]);

                $('body').on('click', '.submit-customer-login', function (e) {
                    e.preventDefault();
                    members.nextStage();
                });

                $('body').on('click', '.submit-customer', function (e) {
                    e.preventDefault();
                    members.nextStage();
                });

                //
                // Handle Payment option selection
                //
                $('input[name$="paymentMethod"]', plugin).on('change', function () {
                    $('.credit-card-form').toggle($(this).val() === 'CREDIT_CARD');
                });

                //
                // Handle Next State button click
                //
                $(plugin).on('click', '.next-step-button button', function () {
                    members.nextStage();
                });

                //
                // Handle Edit buttons on shipping and payment summary cards
                //
                $('.customer-summary .edit-button', plugin).on('click', function () {
                    members.gotoStage('customer');
                });

                $('.shipping-summary .edit-button', plugin).on('click', function () {
                    if (!$('#checkout-main').hasClass('multi-ship')) {
                        $('body').trigger('shipping:selectSingleShipping');
                    }

                    members.gotoStage('shipping');
                });

                $('.payment-summary .edit-button', plugin).on('click', function () {
                    members.gotoStage('payment');
                });

                //
                // remember stage (e.g. shipping)
                //
                updateUrl(members.currentStage);

                //
                // Listen for foward/back button press and move to correct checkout-stage
                //
                $(window).on('popstate', function (e) {
                    //
                    // Back button when event state less than current state in ordered
                    // checkoutStages array.
                    //
                    if (e.state === null
                        || checkoutStages.indexOf(e.state) < members.currentStage) {
                        members.handlePrevStage(false);
                    } else if (checkoutStages.indexOf(e.state) > members.currentStage) {
                        // Forward button  pressed
                        members.handleNextStage(false);
                    }
                });

                //
                // Set the form data
                //
                plugin.data('formData', formData);
            },

            /**
             * The next checkout state step updates the css for showing correct buttons etc...
             */
            nextStage: function () {
                var promise = members.updateStage();

                promise.done(function () {
                    // Update UI with new stage
                    $('.error-message').hide();
                    members.handleNextStage(true);
                });

                promise.fail(function (data) {
                    // show errors
                    if (data) {
                        if (data.errorStage) {
                            members.gotoStage(data.errorStage.stage);

                            if (data.errorStage.step === 'billingAddress') {
                                var $billingAddressSameAsShipping = $(
                                    'input[name$="_shippingAddressUseAsBillingAddress"]'
                                );
                                if ($billingAddressSameAsShipping.is(':checked')) {
                                    $billingAddressSameAsShipping.prop('checked', false);
                                }
                            }
                        }

                        if (data.errorMessage) {
                            $('.error-message').show();
                            $('.error-message-text').text(data.errorMessage);
                        }
                    }
                });
            },

            /**
             * The next checkout state step updates the css for showing correct buttons etc...
             *
             * @param {boolean} bPushState - boolean when true pushes state using the history api.
             */
            handleNextStage: function (bPushState) {
                if (members.currentStage < checkoutStages.length - 1) {
                    // move stage forward
                    members.currentStage++; // eslint-disable-line no-plusplus

                    //
                    // show new stage in url (e.g.payment)
                    //
                    if (bPushState) {
                        updateUrl(members.currentStage);
                    }
                }

                // Set the next stage on the DOM
                $(plugin).attr('data-checkout-stage', checkoutStages[members.currentStage]);
            },

            /**
             * Previous State
             */
            handlePrevStage: function () {
                if (members.currentStage > 0) {
                    // move state back
                    members.currentStage--; // eslint-disable-line no-plusplus
                    updateUrl(members.currentStage);
                }

                $(plugin).attr('data-checkout-stage', checkoutStages[members.currentStage]);
            },

            /**
             * Use window history to go to a checkout stage
             * @param {string} stageName - the checkout state to goto
             */
            gotoStage: function (stageName) {
                members.currentStage = checkoutStages.indexOf(stageName);
                updateUrl(members.currentStage);
                $(plugin).attr('data-checkout-stage', checkoutStages[members.currentStage]);
            }
        };

        //
        // Initialize the checkout
        //
        members.initialize();

        return this;
    };
}(jQuery));

[billingHelpers, addressHelpers].forEach(function (library) {
    Object.keys(library).forEach(function (item) {
        if (typeof library[item] === 'object') {
            base[item] = $.extend({}, base[item], library[item]);
        } else {
            base[item] = library[item];
        }
    });
});

module.exports = base;
