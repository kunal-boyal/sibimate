import { Public, TokenService } from '@nestjs/authentication';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  PRIVACY_NOTICE_VERSION,
  type LogoutRequest,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerify,
  type OtpVerifyResponse,
  type RefreshRequest,
  type TokenPair,
  logoutSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  otpRequestResponseSchema,
  otpVerifyResponseSchema,
  tokenPairSchema,
} from '@sibimate/shared';
import { ApiException } from '../common/api-exception.js';
import { UsersRepository, toUser } from '../users/users.repository.js';
import { OtpService } from './otp.service.js';
import { ApiResult } from '../openapi/openapi.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly usersRepository: UsersRepository,
  ) {}

  @Post('otp/request')
  @ApiResult(otpRequestResponseSchema)
  @HttpCode(200)
  requestOtp(@Body({ schema: otpRequestSchema }) body: OtpRequest): Promise<OtpRequestResponse> {
    return this.otpService.request(body.phone, body.deviceId);
  }

  @Post('otp/verify')
  @ApiResult(otpVerifyResponseSchema)
  @HttpCode(200)
  async verifyOtp(@Body({ schema: otpVerifySchema }) body: OtpVerify): Promise<OtpVerifyResponse> {
    await this.otpService.verify(body.phone, body.code, body.deviceId);

    const { user, created } = await this.usersRepository.findOrCreateByPhone(body.phone);
    if (user.status !== 'active') {
      throw new ApiException(403, 'forbidden', 'This account cannot sign in.');
    }
    await this.usersRepository.recordConsent(user.id, PRIVACY_NOTICE_VERSION);

    // `did` ties the refresh-token family to the device that signed in.
    const tokens = await this.tokenService.issue(user.id, {
      method: 'otp',
      claims: { amr: ['sms'], did: body.deviceId },
    });
    return { ...tokens, user: toUser(user), isNewUser: created };
  }

  @Post('refresh')
  @ApiResult(tokenPairSchema)
  @HttpCode(200)
  async refresh(@Body({ schema: refreshSchema }) body: RefreshRequest): Promise<TokenPair> {
    const tokens = await this.tokenService.refresh(body.refreshToken);
    // The family's claims are copied into every access token it mints.
    if (readClaim(tokens.accessToken, 'did') !== body.deviceId) {
      await this.tokenService.revoke(tokens.refreshToken);
      throw new ApiException(401, 'unauthorized', 'Sign in again.');
    }
    return tokens;
  }

  /** Signs this device out. Answers the same for unknown tokens. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Body({ schema: logoutSchema }) body: LogoutRequest): Promise<void> {
    await this.tokenService.revoke(body.refreshToken);
  }
}

/** Reads a claim from a token this process has just signed. */
function readClaim(jwt: string, name: string): unknown {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
  return payload[name];
}
