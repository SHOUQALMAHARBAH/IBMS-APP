/**
 * Input sanitization utilities for preventing XSS and injection attacks.
 * These functions should be used for any user-supplied input that might
 * be reflected or stored in the API response or database.
 */

/**
 * Escapes special HTML characters to prevent XSS attacks.
 * Use this for any string that will be rendered as HTML.
 */
export function escapeHtml(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }

  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };

  return text.replace(/[&<>"'\/]/g, (char) => htmlEscapes[char] || char);
}


/**
 * Validates that a value is valid JSON.
 * Returns the parsed object if valid, null if invalid.
 * Use this instead of parsing twice (once for validation, once for use).
 */
export function validateJsonString(
  str: string,
): { valid: true; data: unknown } | { valid: false; data: null } {
  if (typeof str !== 'string') {
    return { valid: false, data: null };
  }

  try {
    const data = JSON.parse(str);
    return { valid: true, data };
  } catch {
    return { valid: false, data: null };
  }
}
