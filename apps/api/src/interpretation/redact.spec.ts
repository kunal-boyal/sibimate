import { redactContactDetails } from './redact.js';

describe('redactContactDetails', () => {
  it('removes phone numbers however they are written', () => {
    expect(redactContactDetails('Call me on 98765 43210 when you reach')).toBe('Call me on [phone] when you reach');
    expect(redactContactDetails('my number is +91-9876543210.')).toBe('my number is [phone] .');
  });

  it('removes email addresses', () => {
    expect(redactContactDetails('send the bill to asha.k@example.com please')).toBe('send the bill to [email] please');
  });

  it('keeps ordinary numbers', () => {
    expect(redactContactDetails('carry 2 suitcases to floor 3, about 45 minutes')).toBe(
      'carry 2 suitcases to floor 3, about 45 minutes',
    );
  });
});
