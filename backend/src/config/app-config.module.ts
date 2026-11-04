import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app.config';

/**
 * Makes the typed AppConfig injectable anywhere without importing this module
 * into every feature module.
 */
@Global()
@Module({ providers: [AppConfig], exports: [AppConfig] })
export class AppConfigModule {}
