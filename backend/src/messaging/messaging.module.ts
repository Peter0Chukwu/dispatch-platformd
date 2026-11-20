import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { ChatService } from './chat.service';
import { ChatInboxController, DeliveryChatController } from './chat.controller';
import { VoiceService } from './voice.service';

@Global()
@Module({
  controllers: [DeliveryChatController, ChatInboxController],
  providers: [MessagingService, ChatService, VoiceService],
  exports: [MessagingService, ChatService, VoiceService],
})
export class MessagingModule {}
