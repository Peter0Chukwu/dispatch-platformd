import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema, z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates and TRANSFORMS request data with a Zod schema, then hands the
 * controller a fully typed, trusted value.
 *
 * Why Zod instead of class-validator: the very same schema object is imported by
 * the React forms (via @dispatch/shared), so the frontend and backend can never
 * disagree about what a valid delivery booking looks like.
 *
 * The pipe converts Zod failures into our own AppError so the HTTP layer always
 * speaks one error language. (Relying on `instanceof ZodError` in the global
 * filter proved fragile: a bundler can load the same library twice, producing two
 * distinct classes. Detecting by shape is robust; converting here is explicit.)
 */
@Injectable()
export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const issues = (result.error as ZodError).issues ?? [];
    throw AppError.validation(
      issues.map((issue) => ({
        field: issue.path.join('.') || undefined,
        message: issue.message,
      })),
    );
  }
}
