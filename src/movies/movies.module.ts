import { Module } from '@nestjs/common';
import { MoviesController } from './movies.controller';
import { MoviesService } from './movies.service';
import { PrismaService } from 'prisma/prisma.service';
import { RatingModule } from 'src/ratings/rating.module';
import { AuthModule } from 'src/auth/auth.module';
import { QueryParserService } from 'src/search/services/query_parser.service';
import { SearchModule } from 'src/search/search.module';
import { InitialSyncService } from 'src/sync/initial_sync.service';

@Module({
  imports: [
    RatingModule,
    SearchModule,
    AuthModule
  ],
  controllers: [MoviesController],
  providers: [MoviesService, PrismaService, QueryParserService, InitialSyncService],
  exports: [MoviesService],
})
export class MoviesModule {}
