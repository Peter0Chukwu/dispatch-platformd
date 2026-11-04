import { Body, Param, Query } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

/** @ZodBody(createDeliverySchema) dto — validated + transformed + typed. */
export const ZodBody = <T extends ZodSchema>(schema: T) => Body(new ZodValidationPipe(schema));

/** @ZodQuery(paginationSchema) query */
export const ZodQuery = <T extends ZodSchema>(schema: T) => Query(new ZodValidationPipe(schema));

/** @ZodParam(schema) param */
export const ZodParam = <T extends ZodSchema>(schema: T) => Param(new ZodValidationPipe(schema));
