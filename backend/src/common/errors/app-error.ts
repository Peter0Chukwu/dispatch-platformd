import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  | 'DELIVERY_NOT_CANCELLABLE'
  | 'PRICING_UNAVAILABLE'
  | 'PROMO_INVALID'
  | 'OFFER_EXPIRED'
  | 'OFFER_TAKEN'
  | 'DELIVERY_TAKEN'
  | 'RIDER_BUSY'
  | 'RIDER_NOT_APPROVED'
  | 'RIDER_INACTIVE'
  | 'EMAIL_ALREADY_EXISTS'
  | 'SELF_ACTION_FORBIDDEN'
  | 'LAST_SUPER_ADMIN'
  | 'DOCUMENTS_INCOMPLETE'
  | 'OTP_MISSING'
  | 'OTP_LOCKED'
  | 'INSUFFICIENT_BALANCE'
  | 'OFFER_EXPIRED'
  | 'DUPLICATE_REQUEST'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

export type ErrorDetail = { field?: string; message: string };

/**
 * The only error type application code should throw.
 * Keeps HTTP status, machine-readable code and safe message together, so the
 * global filter can produce a consistent shape for all three portals.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }

  static notFound(entity = 'Resource') {
    return new AppError('NOT_FOUND', `${entity} not found`, HttpStatus.NOT_FOUND);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
  static conflict(message: string, code: ErrorCode = 'CONFLICT') {
    return new AppError(code, message, HttpStatus.CONFLICT);
  }
  static validation(details: ErrorDetail[]) {
    return new AppError('VALIDATION_FAILED', 'Some fields need your attention', HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}
