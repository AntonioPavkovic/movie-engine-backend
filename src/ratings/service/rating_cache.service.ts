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
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_PREFIX = 'movie:rating:';

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  /**
   * Get movie rating stats from cache or database
   */
  async getMovieStats(movieId: number, useCache = true): Promise<MovieStats | null> {
    const cacheKey = `${this.CACHE_PREFIX}${movieId}`;

    // Try cache first
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

    // Fallback to database
    const stats = await this.calculateStatsFromDatabase(movieId);
    
    if (stats) {
      // Cache the result
      await this.cacheStats(movieId, stats);
    }

    return stats;
  }

  /**
   * Update cache with new stats
   */
  async updateStats(movieId: number, stats: Omit<MovieStats, 'movieId' | 'lastUpdated'>): Promise<void> {
    const fullStats: MovieStats = {
      movieId,
      ...stats,
      lastUpdated: new Date().toISOString(),
    };

    await this.cacheStats(movieId, fullStats);
  }

  /**
   * Invalidate cache for a movie
   */
  async invalidateCache(movieId: number): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}${movieId}`;
    await this.redis.del(cacheKey);
    this.logger.debug(`Invalidated cache for movie ${movieId}`);
  }

  /**
   * Batch invalidate cache for multiple movies
   */
  async batchInvalidateCache(movieIds: number[]): Promise<void> {
    if (movieIds.length === 0) return;

    const keys = movieIds.map(id => `${this.CACHE_PREFIX}${id}`);
    await this.redis.del(...keys);
    this.logger.debug(`Invalidated cache for ${movieIds.length} movies`);
  }

  /**
   * Pre-warm cache for popular movies
   */
  async preWarmCache(limit = 100): Promise<void> {
    try {
      const popularMovies = await this.prisma.movie.findMany({
        select: { id: true },
        orderBy: [
          { ratingsCount: 'desc' },
          { avgRating: 'desc' },
        ],
        take: limit,
      });

      const warmupPromises = popularMovies.map(movie => 
        this.getMovieStats(movie.id, false) // Force database read
      );

      await Promise.allSettled(warmupPromises);
      this.logger.log(`Pre-warmed cache for ${popularMovies.length} popular movies`);
    } catch (error) {
      this.logger.error('Error pre-warming cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    hitRate?: number;
    memoryUsage?: string;
  }> {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      
      return {
        totalKeys: keys.length,
        // You can add hit rate tracking by maintaining counters
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error);
      return { totalKeys: 0 };
    }
  }

  /**
   * Clear all rating caches
   */
  async clearAllCache(): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cleared ${keys.length} rating cache entries`);
      }
    } catch (error) {
      this.logger.error('Error clearing all cache:', error);
    }
  }

  private async calculateStatsFromDatabase(movieId: number): Promise<MovieStats | null> {
    try {
      // Get movie to ensure it exists
      const movie = await this.prisma.movie.findUnique({
        where: { id: movieId },
        select: { id: true, avgRating: true, ratingsCount: true },
      });

      if (!movie) {
        return null;
      }

      // Get detailed rating distribution
      const ratings = await this.prisma.rating.findMany({
        where: { movieId },
        select: { stars: true },
      });

      const ratingDistribution = ratings.reduce(
        (dist, rating) => {
          dist[rating.stars as keyof typeof dist]++;
          return dist;
        },
        { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      );

      // Use cached values from movie table if available, otherwise calculate
      const totalRatings = movie.ratingsCount || ratings.length;
      const avgRating = movie.avgRating || (
        ratings.length > 0 
          ? Number((ratings.reduce((sum, r) => sum + r.stars, 0) / ratings.length).toFixed(2))
          : 0
      );

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