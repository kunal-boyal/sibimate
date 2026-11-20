import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

/** Delivers one-time codes. The SMS provider is chosen behind this class. */
export abstract class SmsSender {
  abstract sendOtp(phone: string, code: string): Promise<void>;
}

/** Development only: prints the code instead of sending it. Refused in production by loadEnv(). */
@Injectable()
export class ConsoleSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code}`);
  }
}

/**
 * Sends codes through MSG91's Send SMS API with a DLT-approved template
 * (https://docs.msg91.com/sms/send-sms.openapi.yml). The template's text is
 * set in MSG91; only the code is sent from here.
 */
@Injectable()
export class Msg91SmsSender extends SmsSender {
  constructor(
    @Inject(ENV) private readonly env: Env,
    /** Replaced in tests. */
    private readonly doFetch: typeof fetch = fetch,
  ) {
    super();
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const response = await this.doFetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: this.env.MSG91_AUTH_KEY!, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: this.env.MSG91_OTP_TEMPLATE_ID,
        short_url: '0',
        // MSG91 takes the number with its country code and no plus sign.
        recipients: [{ mobiles: phone.replace(/^\+/, ''), [this.env.MSG91_OTP_VARIABLE]: code }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => null)) as { type?: string; message?: string } | null;
    if (!response.ok || body?.type !== 'success') {
      throw new Error(`MSG91 did not send the code: ${response.status} ${body?.message ?? ''}`.trim());
    }
  }
}
