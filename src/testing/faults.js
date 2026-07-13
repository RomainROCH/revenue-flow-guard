'use strict';

const FaultId = Object.freeze({
  NONE: 'NONE',
  AUTH_BYPASS: 'AUTH_BYPASS',
  CLIENT_PRICE_TRUST: 'CLIENT_PRICE_TRUST',
  DUPLICATE_ORDER: 'DUPLICATE_ORDER',
  EMPTY_CART_ACCEPTED: 'EMPTY_CART_ACCEPTED',
  PAYMENT_DECLINE_HIDDEN: 'PAYMENT_DECLINE_HIDDEN',
  SUBMIT_CONTROL_MISSING: 'SUBMIT_CONTROL_MISSING',
});

const faultIds = new Set(Object.values(FaultId));

function isFaultId(value) {
  return typeof value === 'string' && faultIds.has(value);
}

function validateFaultId(value) {
  if (!isFaultId(value)) {
    throw new TypeError('faultId must be a supported fault identifier.');
  }

  return value;
}

function createFaultDecision(initialFaultId = FaultId.NONE) {
  let activeFaultId = validateFaultId(initialFaultId);

  return Object.freeze({
    get id() {
      return activeFaultId;
    },

    is(faultId) {
      return activeFaultId === validateFaultId(faultId);
    },

    reset() {
      activeFaultId = FaultId.NONE;
    },

    activate(faultId) {
      activeFaultId = validateFaultId(faultId);
    },
  });
}

module.exports = {
  FaultId,
  FAULT_IDS: FaultId,
  createFaultDecision,
  isFaultId,
  validateFaultId,
};
