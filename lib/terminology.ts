// Agreed product terminology (M07): the product is a clinical decision support system,
// "CDSS" for short. Clinician-facing only: patient-facing surfaces keep plain language
// and do not use "CDSS". Clinician decisions stay "decisions"; nothing here renames
// them "recommendations".
export const CDSS='CDSS';
export const CDSS_EXPANDED='clinical decision support system';
export const PRODUCT_CATEGORY=`${CDSS_EXPANDED} (${CDSS})`;
/** Page metadata description. */
export const PRODUCT_DESCRIPTION=`TheraNetrix: a ${PRODUCT_CATEGORY} for chronic pain care, with patient insights and clinician-led pathways.`;
/** Clinical area shown before "CDSS" under the program name in the sidebar. */
export const PRODUCT_AREA='Chronic pain';
