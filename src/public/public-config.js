'use strict';

function isValidText(value, maximumLength) {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value.trim() === value;
}

function isValidContactUrl(value) {
  if (!isValidText(value, Number.MAX_SAFE_INTEGER)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function parsePublicConfig(environment) {
  const contactUrl = environment?.PUBLIC_CONTACT_URL;
  const contactLabel = environment?.PUBLIC_CONTACT_LABEL;
  const offerName = environment?.PUBLIC_OFFER_NAME;
  const offerSummary = environment?.PUBLIC_OFFER_SUMMARY;

  if (
    !isValidContactUrl(contactUrl) ||
    !isValidText(contactLabel, 80) ||
    !isValidText(offerName, 80) ||
    !isValidText(offerSummary, 240)
  ) {
    return { publicationReady: false };
  }

  return {
    publicationReady: true,
    contact: {
      url: contactUrl,
      label: contactLabel,
    },
    offer: {
      name: offerName,
      summary: offerSummary,
    },
  };
}

module.exports = { parsePublicConfig };
