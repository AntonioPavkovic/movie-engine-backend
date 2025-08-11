import { Module } from '@nestjs/common';
import { MoviesController } from './movies.controller';
import { MoviesService } from './movies.service';
import { PrismaService } from 'prisma/prisma.service';
import { SearchModule } from 'src/search/search.module';
import { RatingModule } from 'src/ratings/rating.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    SearchModule, 
    RatingModule,
    AuthModule
  ],
  controllers: [MoviesController],
  providers: [MoviesService, PrismaService],
  exports: [MoviesService],
})
export class MoviesModule {}
