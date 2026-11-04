import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  DeliveryStatus,
  cancelDeliverySchema,
  createDeliverySchema,
  quoteDeliverySchema,
  type CreateDeliveryInput,
  type QuoteDeliveryInput,
} from '@dispatch/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import type { AuthPrincipal } from '../auth/auth.types';
import { DeliveriesService } from './deliveries.service';

/**
 * Customer-facing delivery API.
 *
 * Every route is CUSTOMER-only (@RequireType) AND scoped to the caller's own
 * customerId — portal separation plus ownership, not one or the other.
 */
@Controller('deliveries')
@RequireType('CUSTOMER')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** Price preview — deliberately cheap and repeatable: the UI calls it as the pin moves. */
  @Post('quote')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  async quote(
    @CurrentUser('customerId') customerId: string,
    @Body(new ZodValidationPipe(quoteDeliverySchema)) input: QuoteDeliveryInput,
  ) {
    return this.deliveries.quote(customerId, input);
  }

  /** Create a booking. The price is recomputed server-side — the client never sends one. */
  @Post()
  @RateLimit({ points: 10, windowSeconds: 60, keyBy: 'ip+route' })
  async create(
    @CurrentUser('customerId') customerId: string,
    @Body(new ZodValidationPipe(createDeliverySchema)) input: CreateDeliveryInput,
  ) {
    return this.deliveries.create(customerId, input);
  }

  @Get()
  async list(
    @CurrentUser('customerId') customerId: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
  ) {
    const parsedStatus =
      status && Object.values(DeliveryStatus).includes(status as DeliveryStatus)
        ? (status as DeliveryStatus)
        : undefined;
    return this.deliveries.listMine(customerId, {
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
      status: parsedStatus,
    });
  }

  @Get('summary')
  async summary(@CurrentUser('customerId') customerId: string) {
    return this.deliveries.summary(customerId);
  }

  @Get(':id')
  async getOne(
    @CurrentUser('customerId') customerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.deliveries.getMine(customerId, id);
  }

  @Post(':id/cancel')
  @RateLimit({ points: 10, windowSeconds: 60, keyBy: 'ip+route' })
  async cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(cancelDeliverySchema)) input: z.infer<typeof cancelDeliverySchema>,
  ) {
    return this.deliveries.cancel(
      { customerId: user.customerId!, userId: user.userId },
      id,
      input.reason,
    );
  }
}
