// Product names shown in the app. "Robo Advisor" is a placeholder: TheraNetrix will
// supply a trademarkable name, and this is the one place to change it. Components and
// lib code read these constants and never spell the name out
// (tests/product-names.test.mjs enforces that).
export const ADVISOR_NAME='Robo Advisor';

// Strings the app saves into workspace records and later matches on. They derive from
// the name, so a rename also changes what new records store. Records saved under the
// old name then stop matching: migrate these specific fields (message sender, review
// source) at the same time, never with a blind text rewrite of notes or audit history.
/** Message.sender on advisor replies in the patient conversation. */
export const ADVISOR_SENDER=ADVISOR_NAME;
/** Review.source on care-team handoffs created from an advisor conversation. */
export const ADVISOR_HANDOFF_SOURCE=`${ADVISOR_NAME} handoff`;
/** EngineSource.label for the latest advisor exchange cited by an engine run. */
export const ADVISOR_SUMMARY_LABEL=`${ADVISOR_NAME} summary`;
/** Audit action written for each advisor exchange. */
export const ADVISOR_EXCHANGE_LABEL=`${ADVISOR_NAME} exchange`;
/** Title of the integration card that covers Shadow AI and the advisor. */
export const ADVISOR_INTEGRATION_NAME=`Shadow AI & ${ADVISOR_NAME}`;

/** The name earlier builds wrote into saved records. lib/relabel.ts matches old wording
 *  on it, so it stays fixed when ADVISOR_NAME changes. */
export const LEGACY_ADVISOR_NAME='Robo Advisor';
