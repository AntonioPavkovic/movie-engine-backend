import { Module } from '@nestjs/common';
import { MoviesController } from './movies.controller';
import { MoviesService } from './movies.service';
import { PrismaService } from 'prisma/prisma.service';
import { SearchModule } from 'src/search/search.module';
import { RatingModule } from 'src/ratings/rating.module';

@Module({
  imports: [SearchModule, RatingModule],
  controllers: [MoviesController],
  providers: [MoviesService, PrismaService],
  exports: [MoviesService],
})
export class MoviesModule {}
