import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MoviesModule } from './movies/movies.module';
import { RatingModule } from './ratings/rating.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MoviesModule, 
    RatingModule,
    ConfigModule.forRoot({
      isGlobal: true, 
    }),
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
