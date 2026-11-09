import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { sendMessageSchema, type SendMessageInput } from '@dispatch/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireType } from '../auth/decorators/require-type.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthPrincipal } from '../auth/auth.types';
import { ChatService } from './chat.service';
import { VoiceService } from './voice.service';

/**
 * The customer ↔ rider thread for one delivery.
 *
 * One controller for both portals because it is the same conversation seen from
 * two sides; `@RequireType` keeps staff out, and the service decides *which* side
 * the caller is — a customer token can never speak as the rider.
 */
@Controller('deliveries')
@RequireType('CUSTOMER', 'RIDER')
export class DeliveryChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly voice: VoiceService,
  ) {}

  /** What the Contact area shows: whether masked calling is live for this app. */
  @Get(':id/contact')
  @RateLimit({ points: 60, windowSeconds: 60, keyBy: 'ip+route' })
  async contact(@Param('id', new ParseUUIDPipe()) id: string) {
    void id;
    return this.voice.status();
  }

  /** Ask for a masked number. Refuses honestly until a provider is connected. */
  @Post(':id/contact/call')
  @RateLimit({ points: 10, windowSeconds: 60, keyBy: 'ip+route' })
  async call(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.voice.requestCall(user, id);
  }

  @Get(':id/messages')
  @RateLimit({ points: 120, windowSeconds: 60, keyBy: 'ip+route' })
  async list(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.chat.list(user, id);
  }

  @Post(':id/messages')
  @RateLimit({ points: 30, windowSeconds: 60, keyBy: 'ip+route' })
  async send(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) input: SendMessageInput,
  ) {
    return this.chat.send(user, id, input);
  }
}
