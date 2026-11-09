import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { ChatService } from './chat.service';
import { DeliveryChatController } from './chat.controller';
import { VoiceService } from './voice.service';

@Global()
@Module({
  controllers: [DeliveryChatController],
  providers: [MessagingService, ChatService, VoiceService],
  exports: [MessagingService, ChatService, VoiceService],
})
export class MessagingModule {}
