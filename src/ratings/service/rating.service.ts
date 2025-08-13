import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { RatingCacheService } from './rating_cache.service';

interface CreateRatingDto {
  movieId: number;
  stars: number;
  sourceId?: string;
}

@Injectable()
export class RatingService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cacheService: RatingCacheService,
  ) {}

  async createAnonymousRating(dto: CreateRatingDto) {
    // Validate rating
    if (dto.stars < 1 || dto.stars > 5) {
      throw new BadRequestException('Rating must be between 1 and 5 stars');
    }

    // Check if movie exists
    const movie = await this.prisma.movie.findUnique({
      where: { id: dto.movieId },
      select: { id: true }
    });

    if (!movie) {
      throw new BadRequestException('Movie not found');
    }

    try {
      // Create rating in database
      const rating = await this.prisma.rating.create({
        data: {
          movieId: dto.movieId,
          stars: dto.stars,
          sourceId: dto.sourceId || 'anonymous',
        },
      });

      // Invalidate cache immediately
      await this.cacheService.invalidateCache(dto.movieId);

      // Emit rating event to Redis stream
      await this.emitRatingEvent({
        movieId: dto.movieId,
        ratingId: rating.id,
        stars: dto.stars,
        operation: 'CREATE',
      });

      return rating;
    } catch (error) {
      throw new BadRequestException(`Failed to create rating: ${error.message}`);
    }
  }

  async updateRating(ratingId: number, stars: number) {
    if (stars < 1 || stars > 5) {
      throw new BadRequestException('Rating must be between 1 and 5 stars');
    }

    try {
      const existingRating = await this.prisma.rating.findUnique({
        where: { id: ratingId },
        select: { id: true, movieId: true, stars: true }
      });

      if (!existingRating) {
        throw new BadRequestException('Rating not found');
      }

      // Only update if stars actually changed
      if (existingRating.stars === stars) {
        return existingRating;
      }

      const updatedRating = await this.prisma.rating.update({
        where: { id: ratingId },
        data: { stars }
      });

      // Invalidate cache
      await this.cacheService.invalidateCache(existingRating.movieId);

      // Emit rating event
      await this.emitRatingEvent({
        movieId: existingRating.movieId,
        ratingId: ratingId,
        stars: stars,
        operation: 'UPDATE',
      });

      return updatedRating;
    } catch (error) {
      throw new BadRequestException(`Failed to update rating: ${error.message}`);
    }
  }

  async deleteRating(ratingId: number) {
    try {
      const existingRating = await this.prisma.rating.findUnique({
        where: { id: ratingId },
        select: { id: true, movieId: true }
      });

      if (!existingRating) {
        throw new BadRequestException('Rating not found');
      }

      await this.prisma.rating.delete({
        where: { id: ratingId }
      });

      // Invalidate cache
      await this.cacheService.invalidateCache(existingRating.movieId);

      // Emit rating event
      await this.emitRatingEvent({
        movieId: existingRating.movieId,
        ratingId: ratingId,
        operation: 'DELETE',
      });

      return { success: true };
    } catch (error) {
      throw new BadRequestException(`Failed to delete rating: ${error.message}`);
    }
  }

  async getMovieRatings(movieId: number, page = 0, limit = 20) {
    const skip = page * limit;
    
    const [ratings, total] = await Promise.all([
      this.prisma.rating.findMany({
        where: { movieId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          stars: true,
          sourceId: true,
          createdAt: true,
        }
      }),
      this.prisma.rating.count({ where: { movieId } })
    ]);

    return {
      ratings,
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total
    };
  }

  async getMovieRatingStats(movieId: number) {
    try {
      // Try to get from cache first
      const cachedStats = await this.cacheService.getMovieStats(movieId);
      
      if (cachedStats) {
        return {
          averageRating: cachedStats.avgRating,
          totalRatings: cachedStats.totalRatings,
          ratingDistribution: cachedStats.ratingDistribution,
          cached: true,
          lastUpdated: cachedStats.lastUpdated,
        };
      }

      // Fallback: return empty stats if no ratings found
      return {
        averageRating: 0,
        totalRatings: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        cached: false,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get rating stats: ${error.message}`);
    }
  }

  /**
   * Batch operations for efficiency
   */
  async createBulkRatings(ratings: CreateRatingDto[]) {
    if (ratings.length === 0) return [];

    // Validate all ratings
    const invalidRatings = ratings.filter(r => r.stars < 1 || r.stars > 5);
    if (invalidRatings.length > 0) {
      throw new BadRequestException('All ratings must be between 1 and 5 stars');
    }

    // Get unique movie IDs to validate
    const movieIds = [...new Set(ratings.map(r => r.movieId))];
    const existingMovies = await this.prisma.movie.findMany({
      where: { id: { in: movieIds } },
      select: { id: true }
    });

    const existingMovieIds = new Set(existingMovies.map(m => m.id));
    const invalidMovieIds = movieIds.filter(id => !existingMovieIds.has(id));
    
    if (invalidMovieIds.length > 0) {
      throw new BadRequestException(`Movies not found: ${invalidMovieIds.join(', ')}`);
    }

    try {
      // Create ratings in batch
      const createdRatings = await this.prisma.rating.createMany({
        data: ratings.map(r => ({
          movieId: r.movieId,
          stars: r.stars,
          sourceId: r.sourceId || 'anonymous',
        }))
      });

      // Invalidate cache for affected movies
      await this.cacheService.batchInvalidateCache(movieIds);

      // Emit events for all affected movies
      const eventPromises = movieIds.map(movieId => 
        this.emitRatingEvent({
          movieId,
          ratingId: 0, // Bulk operation
          operation: 'CREATE',
        })
      );

      await Promise.allSettled(eventPromises);

      return createdRatings;
    } catch (error) {
      throw new BadRequestException(`Failed to create bulk ratings: ${error.message}`);
    }
  }

  /**
   * Get top rated movies with caching
   */
  async getTopRatedMovies(limit = 10, useCache = true) {
    const movies = await this.prisma.movie.findMany({
      orderBy: [
        { avgRating: 'desc' },
        { ratingsCount: 'desc' }
      ],
      take: limit,
      select: {
        id: true,
        title: true,
        avgRating: true,
        ratingsCount: true,
      }
    });

    // Optionally enhance with cached detailed stats
    if (useCache) {
      const enhancedMovies = await Promise.allSettled(
        movies.map(async (movie) => {
          const stats = await this.cacheService.getMovieStats(movie.id);
          return {
            ...movie,
            ratingDistribution: stats?.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
          };
        })
      );

      return enhancedMovies
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);
    }

    return movies;
  }

  private async emitRatingEvent(event: {
    movieId: number;
    ratingId: number;
    stars?: number;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
  }) {
    try {
      await this.redis.xadd(
        'rating-events',
        '*',
        'data',
        JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      // Log but don't throw - rating was already saved to DB
      console.error('Failed to emit rating event:', error);
    }
  }

  /**
   * Health check for rating system
   */
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