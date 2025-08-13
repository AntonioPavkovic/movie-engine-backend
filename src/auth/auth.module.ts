import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiKeyGuard } from './guards/api-key.guard';
import google_oauthConfig from './google_oauth.config';

@Module({
  imports: [ConfigModule, ConfigModule.forFeature(google_oauthConfig)],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class AuthModule {}