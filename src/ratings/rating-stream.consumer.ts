import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { OpenSearchEngineService } from 'src/search/opensearch_engine.service';
import { RatingCacheService } from './service/rating_cache.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RatingStreamConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RatingStreamConsumer.name);
  private readonly streamKey = 'rating-events';
  private readonly group = 'rating-consumers';
  private readonly consumer = `consumer-${uuidv4()}`;
  private isProcessing = false;
  private running = true;

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
    private search: OpenSearchEngineService,
  ) {}

  async onModuleInit() {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, this.group, '$', 'MKSTREAM');
      this.logger.log(`Created consumer group ${this.group}`);
    } catch (err: any) {
      if (err.message && err.message.includes('BUSYGROUP')) {
        this.logger.log(`Consumer group ${this.group} already exists`);
      } else {
        this.logger.error('Failed to create consumer group', err);
      }
    }

    this.startStreamProcessor();
  }

  async onModuleDestroy() {
    this.running = false;
    this.logger.log('Rating stream consumer shutting down');
  }

  private async startStreamProcessor() {
    this.logger.log('Starting rating stream processor...');
    
    while (this.running) {
      try {
        if (this.isProcessing) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        const results = await this.redis.xreadgroup(
          'GROUP',
          this.group,
          this.consumer,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          this.streamKey,
          '>'
        );

        if (results && results.length > 0) {
          this.isProcessing = true;
          await this.processEvents(results);
          this.isProcessing = false;
        }
      } catch (error) {
        this.logger.error('Error processing rating events:', error);
        this.isProcessing = false;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processEvents(results: any[]) {
    for (const [stream, messages] of results) {
      for (const [messageId, fields] of messages) {
        try {
          // Parse the event data
          const dataIndex = fields.findIndex((field: string) => field === 'data');
          if (dataIndex === -1 || !fields[dataIndex + 1]) {
            this.logger.warn(`Invalid message format for ${messageId}`);
            await this.redis.xack(this.streamKey, this.group, messageId);
            continue;
          }

          const eventData = JSON.parse(fields[dataIndex + 1]);
          const movieId = eventData.movieId;
          await this.recalculateMovieStats(movieId);
          
          await this.redis.xack(this.streamKey, this.group, messageId);
          
          this.logger.debug(`Successfully processed message ${messageId} for movie ${movieId}`);
          
        } catch (error) {
          this.logger.error(`Failed to process message ${messageId}:`, error);
        }
      }
    }
  }

  private async recalculateMovieStats(movieId: number) {
    try {
      await this.redis.del(`movie:${movieId}:stats`);
      const aggregation = await this.prisma.rating.aggregate({
        where: { movieId },
        _avg: { stars: true },
        _count: { id: true },
      });

      const totalRatings = aggregation._count?.id ?? 0;
      const averageRating = Number((aggregation._avg?.stars ?? 0).toFixed(2));

      if (totalRatings === 0) {
        await this.updateMovieRecord(movieId, 0, 0);
        await this.search.updateMovieRating(movieId, 0, 0);
        this.logger.log(`Movie ${movieId} has no ratings - set to zero`);
        return;
      }
      const ratings = await this.prisma.rating.findMany({
        where: { movieId },
        select: { stars: true },
      });

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
      await this.updateMovieRecord(movieId, averageRating, totalRatings);
      await this.search.updateMovieRating(movieId, averageRating, totalRatings);

      this.logger.log(`Recalculated stats for movie ${movieId}: avg=${averageRating}, count=${totalRatings}`);
    } catch (error) {
      this.logger.error(`Error recalculating stats for movie ${movieId}:`, error);
      throw error;
    }
  }

  private async updateMovieRecord(movieId: number, avgRating: number, ratingsCount: number) {
    try {
      await this.prisma.movie.update({
        where: { id: movieId },
        data: {
          avgRating,
          ratingsCount,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Error updating movie ${movieId} record:`, error);
      throw error;
    }
  }
}