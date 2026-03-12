import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

/**
 * Normalizes a phone number to standard E.164 format.
 * If the input doesn't have a country code, it assumes it's an Indian number ('IN').
 *
 * @param phone The raw phone number string (e.g. 7884551235, +917884551235, 0917884551235)
 * @returns The normalized E.164 string (e.g. +917884551235) or the original string if parsing fails.
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return phone;
  
  // Clean up any extraneous non-digit/non-plus characters before parsing
  const cleaned = phone.replace(/[^\d+]/g, '');

  try {
    // If it starts with 00, it's an international prefix. Replace with + to help the parser
    const withPlus = cleaned.startsWith('00') ? '+' + cleaned.substring(2) : cleaned;
    
    // Default country is IN, it'll be overridden if the number starts with + and a country code
    const phoneNumber = parsePhoneNumber(withPlus, 'IN');
    
    if (phoneNumber && phoneNumber.isValid()) {
      return phoneNumber.number; // e.g. +917884551235
    }
  } catch (error) {
    // Parsing threw an error, return original or cleaned string fallback
    console.warn(`Failed to normalize phone number: ${phone}`);
  }
  
  return cleaned;
}
