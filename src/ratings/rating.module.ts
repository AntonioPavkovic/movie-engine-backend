import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { RatingService } from './service/rating.service';
import { SearchModule } from 'src/search/search.module';
import { PrismaModule } from 'prisma/prisma.module';
import { DataSyncService } from 'src/sync/data_sync.service';
import { RatingCacheService } from './service/rating_cache.service';
import { RatingStreamConsumer } from './rating-stream.consumer';

@Module({
  imports: [PrismaModule, SearchModule],
  controllers: [],
  providers: [
    RedisService,
    DataSyncService,
    RatingService,
    RatingStreamConsumer,
    RatingCacheService,
  ],
  exports: [RatingService],
})
export class RatingModule {}