import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, type ErrorCode, type ErrorDetail } from '../errors/app-error';

/**
 * Single error boundary. Guarantees every failure — validation, auth, Prisma,
 * or an unexpected crash — returns the same JSON shape, never a stack trace,
 * never a SQL fragment, and always a requestId the owner can quote to support.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = request.id ?? 'unknown';

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side. Please try again.';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (isZodLike(exception)) {
      // Duck-typed: a Zod error thrown by a schema that never reached our pipe
      // (e.g. a queue payload) still produces a clean 422 instead of a 500.
      const issues = (exception as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = 'VALIDATION_FAILED';
      message = 'Some fields need your attention';
      details = issues.map((issue) => ({ field: issue.path.join('.') || undefined, message: issue.message }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? message);
      }
      code =
        status === HttpStatus.UNAUTHORIZED ? 'UNAUTHORIZED'
        : status === HttpStatus.FORBIDDEN ? 'FORBIDDEN'
        : status === HttpStatus.NOT_FOUND ? 'NOT_FOUND'
        : status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED'
        : status === HttpStatus.CONFLICT ? 'CONFLICT'
        : 'VALIDATION_FAILED';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      status = mapped.status;
      code = mapped.code;
      message = mapped.message;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_FAILED';
      message = 'The request contained invalid data';
    }

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.originalUrl} → ${status} ${code}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`[${requestId}] ${request.method} ${request.originalUrl} → ${status} ${code}: ${message}`);
    }

    response.status(status).json({
      error: { code, message, details, requestId, timestamp: new Date().toISOString() },
    });
  }
}

function isZodLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; issues?: unknown };
  return candidate.name === 'ZodError' && Array.isArray(candidate.issues);
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: ErrorCode;
  message: string;
} {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      return { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: `That ${target} is already in use` };
    }
    case 'P2000':
      return { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_FAILED', message: 'A value is too long for its field' };
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Record not found' };
    case 'P2003':
      return { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_FAILED', message: 'Related record does not exist' };
    case 'P2034':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'The record was changed by another request. Please retry.',
      };
    default:
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'A database error occurred' };
  }
}
