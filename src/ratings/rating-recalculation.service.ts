import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';


@Injectable()
export class RatingRecalculationService implements OnModuleInit {
  private isProcessing = false;

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.startStreamProcessor();
  }

  private async startStreamProcessor() {
    console.log('Starting rating recalculation service...');
    
    while (true) {
      try {
        if (this.isProcessing) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        const results = await this.redis.xread(
          'BLOCK',
          5000,
          'STREAMS',
          'rating-events',
          '$',
        );

        if (results && results.length > 0) {
          this.isProcessing = true;
          await this.processEvents(results);
          this.isProcessing = false;
        }
      } catch (error) {
        console.error('Error processing rating events:', error);
        this.isProcessing = false;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processEvents(results: any[]) {
    const movieIds = new Set<number>();
    
    for (const [stream, messages] of results) {
      for (const [id, fields] of messages) {
        const eventData = JSON.parse(fields[1]);
        movieIds.add(eventData.movieId);
      }
    }

    for (const movieId of movieIds) {
      await this.recalculateMovieStats(movieId);
    }
  }

  private async recalculateMovieStats(movieId: number) {
    try {

      await this.redis.del(`movie:${movieId}:stats`);


      const ratings = await this.prisma.rating.findMany({
        where: { movieId },
        select: { stars: true },
      });

      if (ratings.length === 0) {
        return;
      }

      const totalRatings = ratings.length;
      const sumRatings = ratings.reduce((sum, rating) => sum + rating.stars, 0);
      const averageRating = Number((sumRatings / totalRatings).toFixed(2));

      const ratingDistribution = ratings.reduce(
        (dist, rating) => {
          dist[rating.stars as keyof typeof dist]++;
          return dist;
        },
        { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      );

      const stats = {
        movieId,
        averageRating,
        totalRatings,
        ratingDistribution,
      };


      await this.redis.setex(`movie:${movieId}:stats`, 300, JSON.stringify(stats));

      console.log(`Recalculated stats for movie ${movieId}:`, stats);
    } catch (error) {
      console.error(`Error recalculating stats for movie ${movieId}:`, error);
    }
  }
}