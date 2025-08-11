import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MoviesModule } from './movies/movies.module';
import { RatingModule } from './ratings/rating.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, 
      envFilePath: '.env',
      cache: true,
    }),
    AuthModule, 
    MoviesModule,
    RatingModule,
    SearchModule,
  ],
})
export class AppModule {}
