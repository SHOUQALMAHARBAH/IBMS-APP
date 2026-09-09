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
 * Removes potentially dangerous characters from a string.
 * More aggressive than HTML escaping - removes tags entirely.
 */
export function stripTags(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Sanitizes a string for use in SQL-like contexts.
 * Note: This should NOT be used instead of parameterized queries.
 * This is a defense-in-depth measure only.
 */
export function sanitizeSqlString(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/'/g, "''")
    .replace(/"/g, '""')
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
}

/**
 * Validates and sanitizes an email address.
 */
export function sanitizeEmail(email: string): string {
  if (typeof email !== 'string') {
    return '';
  }
  return email.toLowerCase().trim();
}

/**
 * Validates and sanitizes a URL to prevent XSS via javascript: protocol.
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    // Invalid URL
    return '';
  }
}

/**
 * Sanitizes a phone number to only allow digits and common formatting chars.
 */
export function sanitizePhoneNumber(phone: string): string {
  if (typeof phone !== 'string') {
    return '';
  }
  return phone.replace(/[^\d+\-().\s]/g, '');
}

/**
 * Validates that a value is a safe JSON string (not a script injection).
 */
export function validateJsonString(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}
