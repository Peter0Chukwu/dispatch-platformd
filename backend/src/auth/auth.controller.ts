import { Body, Controller, Delete, Get, Ip, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  avatarUploadSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  otpVerifySchema,
  registerCustomerSchema,
  registerRiderSchema,
  resetPasswordSchema,
} from '@dispatch/shared';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ZodBody } from '../common/decorators/zod.decorators';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { AppError } from '../common/errors/app-error';
import type { AuthPrincipal, AuthSession } from './auth.types';

export const REFRESH_COOKIE = 'dispatch_refresh';

const verifyEmailSchema = z.object({ token: z.string().min(20) });
const resendOtpSchema = z.object({ phone: z.string().min(7) });
const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(60).optional(),
  lastName: z.string().trim().min(2).max(60).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── Cookie handling ───────────────────────────────────────────────────────
  // The refresh token lives in an HttpOnly cookie: JavaScript (and therefore any
  // XSS payload) cannot read it. It is scoped to the auth routes so it is not
  // sent with every ordinary API call.
  private setRefreshCookie(res: Response, session: AuthSession): void {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: session.refreshTokenMaxAgeMs,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  // ── Registration ──────────────────────────────────────────────────────────

  @Public()
  @RateLimit({ points: 5, windowSeconds: 600, keyBy: 'ip', message: 'Too many sign-up attempts. Please try again later.' })
  @Post('register/customer')
  async registerCustomer(
    @ZodBody(registerCustomerSchema) body: z.infer<typeof registerCustomerSchema>,
    @Ip() ip: string,
    @Req() request: { headers: Record<string, string | undefined> },
  ) {
    return this.auth.registerCustomer(body, { ip, userAgent: request.headers['user-agent'] });
  }

  @Public()
  @RateLimit({ points: 5, windowSeconds: 600, keyBy: 'ip' })
  @Post('register/rider')
  async registerRider(
    @ZodBody(registerRiderSchema) body: z.infer<typeof registerRiderSchema>,
    @Ip() ip: string,
    @Req() request: { headers: Record<string, string | undefined> },
  ) {
    return this.auth.registerRider(body, { ip, userAgent: request.headers['user-agent'] });
  }

  // ── Login / logout ────────────────────────────────────────────────────────

  @Public()
  @RateLimit({
    points: 10,
    windowSeconds: 300,
    keyBy: 'body',
    bodyField: 'identifier',
    message: 'Too many sign-in attempts for this account. Please wait a few minutes.',
  })
  @Post('login')
  async login(
    @ZodBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Ip() ip: string,
    @Req() request: { headers: Record<string, string | undefined> },
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(body, { ip, userAgent: request.headers['user-agent'] });
    this.setRefreshCookie(res, session);
    // The refresh token is NOT returned in the body — cookie only.
    const { refreshToken: _ignored, refreshTokenMaxAgeMs: _maxAge, ...safe } = session;
    return safe;
  }

  @Public()
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip' })
  @Post('refresh')
  async refresh(
    @Req() request: { cookies?: Record<string, string>; headers: Record<string, string | undefined>; body?: { refreshToken?: string } },
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Mobile clients (and automated tests) may send the token explicitly.
    const token = request.cookies?.[REFRESH_COOKIE] ?? request.body?.refreshToken;
    if (!token) throw new AppError('UNAUTHORIZED', 'No active session. Please sign in.', 401);

    const session = await this.auth.refresh(token, { ip, userAgent: request.headers['user-agent'] });
    this.setRefreshCookie(res, session);
    const { refreshToken: _ignored, refreshTokenMaxAgeMs: _maxAge, ...safe } = session;
    return safe;
  }

  @Public()
  @Post('logout')
  async logout(
    @Req() request: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE]);
    this.clearRefreshCookie(res);
    return { message: 'Signed out.' };
  }

  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthPrincipal, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logoutAll(user);
    this.clearRefreshCookie(res);
    return { message: 'Signed out of all devices.', ...result };
  }

  // ── Verification ──────────────────────────────────────────────────────────

  @Public()
  @RateLimit({ points: 10, windowSeconds: 300, keyBy: 'ip' })
  @Post('verify-email')
  async verifyEmail(@ZodBody(verifyEmailSchema) body: z.infer<typeof verifyEmailSchema>) {
    return this.auth.verifyEmailToken(body.token);
  }

  @Post('resend-verification')
  @RateLimit({ points: 3, windowSeconds: 300, keyBy: 'ip' })
  async resendVerification(@CurrentUser() user: AuthPrincipal) {
    return this.auth.resendEmailVerification(user);
  }

  @Public()
  @RateLimit({ points: 5, windowSeconds: 300, keyBy: 'body', bodyField: 'phone' })
  @Post('otp/request')
  async requestOtp(@ZodBody(resendOtpSchema) body: z.infer<typeof resendOtpSchema>) {
    return this.auth.requestOtpForPhone(body.phone);
  }

  @Public()
  @RateLimit({ points: 10, windowSeconds: 300, keyBy: 'body', bodyField: 'phone' })
  @Post('otp/verify')
  async verifyOtp(@ZodBody(otpVerifySchema) body: z.infer<typeof otpVerifySchema>) {
    return this.auth.verifyOtpForPhone(body.phone, body.code);
  }

  // ── Password ──────────────────────────────────────────────────────────────

  @Public()
  @RateLimit({ points: 5, windowSeconds: 900, keyBy: 'ip' })
  @Post('password/forgot')
  async forgotPassword(@ZodBody(forgotPasswordSchema) body: z.infer<typeof forgotPasswordSchema>) {
    return this.auth.forgotPassword(body.identifier);
  }

  @Public()
  @RateLimit({ points: 10, windowSeconds: 900, keyBy: 'ip' })
  @Post('password/reset')
  async resetPassword(@ZodBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>) {
    return this.auth.resetPasswordWithToken(body.token, body.password);
  }

  @Patch('password')
  async changePassword(
    @CurrentUser() user: AuthPrincipal,
    @ZodBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>,
  ) {
    return this.auth.changePassword(user, body.currentPassword, body.newPassword);
  }

  // ── Profile & sessions ────────────────────────────────────────────────────

  @Get('me')
  async me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.getProfile(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthPrincipal,
    @ZodBody(updateProfileSchema) body: z.infer<typeof updateProfileSchema>,
  ) {
    return this.auth.updateProfile(user, body);
  }

  /**
   * Display picture. JSON + base64, like every other upload in this product: one
   * size cap, one MIME allow-list, no multipart parser to keep in sync.
   */
  @Post('me/avatar')
  @RateLimit({ points: 10, windowSeconds: 300, keyBy: 'ip' })
  async uploadAvatar(
    @CurrentUser() user: AuthPrincipal,
    @ZodBody(avatarUploadSchema) body: z.infer<typeof avatarUploadSchema>,
  ) {
    return this.auth.setAvatar(user, body);
  }

  @Delete('me/avatar')
  async deleteAvatar(@CurrentUser() user: AuthPrincipal) {
    return this.auth.removeAvatar(user);
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthPrincipal) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/others')
  async revokeOtherSessions(@CurrentUser() user: AuthPrincipal) {
    return this.auth.revokeOtherSessions(user);
  }
}
