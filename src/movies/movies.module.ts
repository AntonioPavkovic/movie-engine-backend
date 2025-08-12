import { Module } from '@nestjs/common';
import { MoviesController } from './movies.controller';
import { MoviesService } from './movies.service';
import { PrismaService } from 'prisma/prisma.service';
import { SearchModule } from 'src/search/search.module';
import { RatingModule } from 'src/ratings/rating.module';
import { AuthModule } from 'src/auth/auth.module';
import { OpenSearchService } from 'src/search/opensearch.service';
import { QueryParserService } from 'src/search/services/query-parser.service';

@Module({
  imports: [
    SearchModule, 
    RatingModule,
    AuthModule
  ],
  controllers: [MoviesController],
  providers: [MoviesService, PrismaService, OpenSearchService, QueryParserService],
  exports: [MoviesService],
})
export class MoviesModule {}
