/**
 * Removes phone numbers and email addresses before text leaves the API for a
 * model provider. Street addresses are never sent: the app collects the
 * address in its own field.
 */
export function redactContactDetails(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?:\+?\d[\s-]?){10,13}/g, '[phone] ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
