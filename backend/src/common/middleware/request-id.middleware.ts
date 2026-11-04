import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Implemented as MIDDLEWARE (not an interceptor) so it also runs for requests
 * that never reach a route — 404s, malformed URLs, body-parser failures. Every
 * response therefore carries an X-Request-Id the owner can quote to support.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request & { id?: string }, response: Response, next: NextFunction): void {
    const inbound = request.headers['x-request-id'];
    const id = typeof inbound === 'string' && inbound.length <= 64 ? inbound : randomUUID();
    request.id = id;
    response.setHeader('X-Request-Id', id);
    next();
  }
}
