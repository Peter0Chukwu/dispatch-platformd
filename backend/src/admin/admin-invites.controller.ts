import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  acceptStaffInviteSchema,
  createStaffInviteSchema,
  type AcceptStaffInviteInput,
  type CreateStaffInviteInput,
} from '@dispatch/shared';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { AdminInvitesService } from './admin-invites.service';
import type { AuthPrincipal } from '../auth/auth.types';

/**
 * ADMIN SIDE — minting, listing and revoking invitations.
 *
 * `staff:write` gates the route; the service then insists on super admin. Two
 * separate checks on purpose: the permission answers "may this role touch staff
 * at all", the service answers "may this person hand out administrative access".
 */
@Controller('admin/invites')
@RequireType('STAFF')
export class AdminInvitesController {
  constructor(private readonly invites: AdminInvitesService) {}

  @Post()
  @RequirePermissions('staff:write')
  @RateLimit({ points: 20, windowSeconds: 3600, keyBy: 'ip' })
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createStaffInviteSchema)) body: CreateStaffInviteInput,
  ) {
    return this.invites.create(user, body);
  }

  @Get()
  @RequirePermissions('staff:read')
  list(@CurrentUser() user: AuthPrincipal) {
    return this.invites.list(user);
  }

  @Delete(':id')
  @RequirePermissions('staff:write')
  revoke(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invites.revoke(user, id);
  }
}

/**
 * THE INVITATION ITSELF — public, because the person using it has no account yet.
 *
 * The token is the credential, so the two routes are rate limited by IP and the
 * "wrong link" answer is a 404 rather than a hint about which token shape exists.
 */
@Controller('auth/invites')
export class StaffInviteAcceptController {
  constructor(private readonly invites: AdminInvitesService) {}

  @Public()
  @Get(':token')
  @RateLimit({ points: 30, windowSeconds: 300, keyBy: 'ip' })
  resolve(@Param('token') token: string) {
    return this.invites.resolve(token);
  }

  @Public()
  @Post(':token/accept')
  @HttpCode(201)
  @RateLimit({ points: 10, windowSeconds: 900, keyBy: 'ip' })
  accept(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acceptStaffInviteSchema)) body: AcceptStaffInviteInput,
    @Req() request: { headers: Record<string, string | undefined> },
  ) {
    return this.invites.accept(token, body);
  }
}
