import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { PrismaService } from 'prisma/prisma.service';

interface MovieStats {
  movieId: number;
  avgRating: number;
  totalRatings: number;
  ratingDistribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  lastUpdated: string;
}

@Injectable()
export class RatingCacheService {
  private readonly logger = new Logger(RatingCacheService.name);
  private readonly CACHE_TTL = 300; 
  private readonly CACHE_PREFIX = 'movie:rating:';

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  async getMovieStats(movieId: number, useCache = true): Promise<MovieStats | null> {
    const cacheKey = `${this.CACHE_PREFIX}${movieId}`;
    if (useCache) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const stats = JSON.parse(cached);
          this.logger.debug(`Cache hit for movie ${movieId}`);
          return stats;
        }
      } catch (error) {
        this.logger.warn(`Cache read error for movie ${movieId}:`, error);
      }
    }

    const stats = await this.calculateStatsFromDatabase(movieId);
    
    if (stats) {
      await this.cacheStats(movieId, stats);
    }

    return stats;
  }

  private async calculateStatsFromDatabase(movieId: number): Promise<MovieStats | null> {
    try {
      const movie = await this.prisma.movie.findUnique({
        where: { id: movieId },
        select: { id: true }
      });

      if (!movie) {
        return null;
      }

      const [ratings, stats] = await Promise.all([
        this.prisma.rating.findMany({
          where: { movieId },
          select: { stars: true },
        }),
        this.prisma.rating.aggregate({
          where: { movieId },
          _avg: { stars: true },
          _count: { stars: true }
        })
      ]);

      const ratingDistribution = ratings.reduce(
        (dist, rating) => {
          dist[rating.stars as keyof typeof dist]++;
          return dist;
        },
        { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      );

      const avgRating = stats._avg.stars ? Number(stats._avg.stars.toFixed(2)) : 0;
      const totalRatings = stats._count.stars;

      return {
        movieId,
        avgRating,
        totalRatings,
        ratingDistribution,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error calculating stats for movie ${movieId}:`, error);
      throw error;
    }
  }

  private async cacheStats(movieId: number, stats: MovieStats): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}${movieId}`;
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(stats));
      this.logger.debug(`Cached stats for movie ${movieId}`);
    } catch (error) {
      this.logger.warn(`Failed to cache stats for movie ${movieId}:`, error);
    }
  }
}