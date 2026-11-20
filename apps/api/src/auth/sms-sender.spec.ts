import type { Env } from '../config/env.js';
import { Msg91SmsSender } from './sms-sender.js';

const env = { MSG91_AUTH_KEY: 'test-key', MSG91_OTP_TEMPLATE_ID: 'tmpl-1', MSG91_OTP_VARIABLE: 'otp' } as Env;

describe('Msg91SmsSender', () => {
  it('sends the code with the template, to the number without its plus sign', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: 'success', message: 'abc' })));
    await new Msg91SmsSender(env, fetchMock as unknown as typeof fetch).sendOtp('+919876543210', '123456');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://control.msg91.com/api/v5/flow');
    expect((init.headers as Record<string, string>).authkey).toBe('test-key');
    expect(JSON.parse(init.body as string)).toEqual({
      template_id: 'tmpl-1',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', otp: '123456' }],
    });
  });

  it('throws when MSG91 does not accept the message, so the customer is not told a code is coming', async () => {
    const refused = vi.fn(
      async () => new Response(JSON.stringify({ type: 'error', message: 'Template not approved' })),
    );
    await expect(
      new Msg91SmsSender(env, refused as unknown as typeof fetch).sendOtp('+919876543210', '1'),
    ).rejects.toThrow(/Template not approved/);
  });
});
