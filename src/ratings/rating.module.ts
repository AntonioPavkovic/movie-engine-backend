import { Module } from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { RatingController } from './rating.controller';
import { RatingService } from './rating.service';

@Module({
  controllers: [RatingController],
  providers: [RatingService, PrismaService],
  exports: [RatingService],
})
export class RatingModule {}
