import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { RatingRecalculationService } from './rating-recalculation.service';
import { RatingController } from './rating.controller';
import { RatingService } from './service/rating.service';


@Module({
  controllers: [RatingController],
  providers: [
    RatingService,
    RatingRecalculationService,
    RedisService,
    PrismaService,
  ],
  exports: [RatingService],
})
export class RatingModule {}