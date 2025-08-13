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
    private redis: RedisService, // This IS the ioredis client
    private prisma: PrismaService,
    private search: OpenSearchEngineService,
    private cacheService: RatingCacheService // Add this
  ) {}

  async onModuleInit() {
    try {
      // Create consumer group if it doesn't exist
      // Use this.redis directly since it extends ioredis
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

        // Use this.redis directly for XREADGROUP
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
            // Acknowledge invalid messages to prevent them from being retried
            await this.redis.xack(this.streamKey, this.group, messageId);
            continue;
          }

          const eventData = JSON.parse(fields[dataIndex + 1]);
          const movieId = eventData.movieId;

          // Recalculate stats for this movie
          await this.recalculateMovieStats(movieId);
          
          // Acknowledge successful processing
          await this.redis.xack(this.streamKey, this.group, messageId);
          
          this.logger.debug(`Successfully processed message ${messageId} for movie ${movieId}`);
          
        } catch (error) {
          this.logger.error(`Failed to process message ${messageId}:`, error);
          // Don't acknowledge - message will be available for retry
        }
      }
    }
  }

  private async recalculateMovieStats(movieId: number) {
    try {
      // Clear existing cache
      await this.redis.del(`movie:${movieId}:stats`);

      // Get all ratings for the movie using Prisma aggregation
      const aggregation = await this.prisma.rating.aggregate({
        where: { movieId },
        _avg: { stars: true },
        _count: { id: true },
      });

      const totalRatings = aggregation._count?.id ?? 0;
      const averageRating = Number((aggregation._avg?.stars ?? 0).toFixed(2));

      // If no ratings, set movie stats to zero
      if (totalRatings === 0) {
        await this.updateMovieRecord(movieId, 0, 0);
        await this.search.updateMovieRating(movieId, 0, 0);
        this.logger.log(`Movie ${movieId} has no ratings - set to zero`);
        return;
      }

      // Get rating distribution (only if we have ratings)
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

      // Cache the stats
      await this.redis.setex(`movie:${movieId}:stats`, 300, JSON.stringify(stats));

      // Update the movie record in database (CRITICAL)
      await this.updateMovieRecord(movieId, averageRating, totalRatings);

      // Update OpenSearch
      await this.search.updateMovieRating(movieId, averageRating, totalRatings);

      this.logger.log(`Recalculated stats for movie ${movieId}: avg=${averageRating}, count=${totalRatings}`);
    } catch (error) {
      this.logger.error(`Error recalculating stats for movie ${movieId}:`, error);
      throw error; // Re-throw to prevent message acknowledgment
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

  // Health check method
  async getServiceHealth() {
    try {
      const info = await this.redis.xinfo('CONSUMERS', this.streamKey, this.group) as any[];
      const consumerInfo = info.find((consumer: any) => 
        consumer[1] === this.consumer
      );
      
      return {
        consumer: this.consumer,
        isRunning: this.running,
        isProcessing: this.isProcessing,
        consumerInfo: consumerInfo || null,
      };
    } catch (error) {
      this.logger.error('Error getting service health:', error);
      return {
        consumer: this.consumer,
        isRunning: this.running,
        isProcessing: this.isProcessing,
        error: error.message,
      };
    }
  }

  // Manual recalculation for admin purposes
  async manualRecalculation(movieId: number) {
    try {
      await this.recalculateMovieStats(movieId);
      return { success: true, message: `Recalculated stats for movie ${movieId}` };
    } catch (error) {
      this.logger.error(`Manual recalculation failed for movie ${movieId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Get pending messages count for monitoring
  async getPendingMessagesCount() {
    try {
      const pending = await this.redis.xpending(this.streamKey, this.group, '-', '+', 100) as any[];
      return pending ? pending.length : 0;
    } catch (error) {
      this.logger.error('Error getting pending messages count:', error);
      return -1;
    }
  }

  // System health check including database, stream, and cache
  async getSystemHealth() {
    try {
      const [dbCount, streamInfo, cacheStats] = await Promise.allSettled([
        this.prisma.rating.count(),
        this.redis.xinfo('STREAM', 'rating-events'),
        this.cacheService.getCacheStats(),
      ]);

      return {
        database: {
          status: dbCount.status === 'fulfilled' ? 'healthy' : 'error',
          totalRatings: dbCount.status === 'fulfilled' ? dbCount.value : 0,
        },
        stream: {
          status: streamInfo.status === 'fulfilled' ? 'healthy' : 'error',
          info: streamInfo.status === 'fulfilled' ? streamInfo.value : null,
        },
        cache: {
          status: cacheStats.status === 'fulfilled' ? 'healthy' : 'error',
          stats: cacheStats.status === 'fulfilled' ? cacheStats.value : null,
        },
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
      };
    }
  }
}