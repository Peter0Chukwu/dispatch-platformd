import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { DeliveriesService } from './deliveries.service';

/**
 * Staff-facing delivery reads.
 *
 * A separate controller (not a decorated method on the customer one) so that the
 * security boundary is visible at a glance: nothing in here is reachable with a
 * customer token, and nothing in the customer controller is reachable with staff.
 */
@Controller('staff/deliveries')
@RequireType('STAFF')
@RequirePermissions('delivery:read')
export class DeliveriesStaffController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.deliveries.listAll({
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
    });
  }

  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.deliveries.getAny(id);
  }
}
