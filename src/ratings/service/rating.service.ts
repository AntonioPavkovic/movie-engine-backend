// services/rating.service.ts (Enhanced for your schema)
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { CreateRatingDto } from '../dto/rating.dto';
import { MovieRatingStatsDto } from '../dto/movie-rating-stats.dto';
import { RatingResponseDto } from '../dto/rating-response.dto';

@Injectable()
export class RatingService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async createRating(createRatingDto: CreateRatingDto): Promise<RatingResponseDto> {
    const { movieId, stars, sourceId } = createRatingDto;

    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
    });

    if (!movie) {
      throw new BadRequestException('Movie not found');
    }

    // Check if this sourceId already rated this movie
    if (sourceId) {
      const existingRating = await this.prisma.rating.findFirst({
        where: {
          movieId: movieId,
          sourceId: sourceId,
        },
      });

      if (existingRating) {
        throw new BadRequestException('You have already rated this movie');
      }
    }

    // Use transaction to create rating and update movie stats
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the rating
      const rating = await tx.rating.create({
        data: {
          movieId,
          stars,
          sourceId,
        },
      });

      // Update movie aggregate fields
      await this.updateMovieAggregates(tx, movieId);

      return rating;
    });

    // Publish to Redis stream for real-time recalculation
    await this.publishRatingEvent(movieId, stars, 'CREATE');

    return {
      id: result.id,
      movieId: result.movieId,
      stars: result.stars,
      createdAt: result.createdAt,
      sourceId: result.sourceId || undefined,
    };
  }

  async updateRating(ratingId: number, stars: number, sourceId?: string): Promise<RatingResponseDto> {
    const existingRating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!existingRating) {
      throw new BadRequestException('Rating not found');
    }

    // Verify ownership if sourceId is provided
    if (sourceId && existingRating.sourceId !== sourceId) {
      throw new BadRequestException('Not authorized to update this rating');
    }

    const oldStars = existingRating.stars;

    // Use transaction to update rating and movie stats
    const result = await this.prisma.$transaction(async (tx) => {
      // Update the rating
      const updatedRating = await tx.rating.update({
        where: { id: ratingId },
        data: { stars },
      });

      // Update movie aggregate fields
      await this.updateMovieAggregates(tx, existingRating.movieId);

      return updatedRating;
    });

    // Publish update event
    await this.publishRatingEvent(existingRating.movieId, stars, 'UPDATE', oldStars);

    return {
      id: result.id,
      movieId: result.movieId,
      stars: result.stars,
      createdAt: result.createdAt,
      sourceId: result.sourceId || undefined,
    };
  }

  async getRatingsByMovie(movieId: number): Promise<RatingResponseDto[]> {
    const ratings = await this.prisma.rating.findMany({
      where: { movieId },
      orderBy: { createdAt: 'desc' },
    });

    return ratings.map(rating => ({
      id: rating.id,
      movieId: rating.movieId,
      stars: rating.stars,
      createdAt: rating.createdAt,
      sourceId: rating.sourceId || undefined,
    }));
  }

  async getMovieRatingStats(movieId: number): Promise<MovieRatingStatsDto> {
    // Try to get from Redis cache first
    const cacheKey = `movie:${movieId}:stats`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Get movie with ratings
    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
      include: {
        ratings: {
          select: { stars: true },
        },
      },
    });

    if (!movie || movie.ratings.length === 0) {
      return {
        movieId,
        averageRating: 0,
        totalRatings: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    const totalRatings = movie.ratings.length;
    const sumRatings = movie.ratings.reduce((sum, rating) => sum + rating.stars, 0);
    const averageRating = Number((sumRatings / totalRatings).toFixed(2));

    const ratingDistribution = movie.ratings.reduce(
      (dist, rating) => {
        dist[rating.stars as keyof typeof dist]++;
        return dist;
      },
      { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    );

    const stats: MovieRatingStatsDto = {
      movieId,
      averageRating,
      totalRatings,
      ratingDistribution,
    };

    // Cache for 5 minutes
    await this.redis.setex(cacheKey, 300, JSON.stringify(stats));

    return stats;
  }

  // Get user's existing rating for a movie (if any)
  async getUserRatingForMovie(movieId: number, sourceId: string): Promise<RatingResponseDto | null> {
    if (!sourceId) {
      return null;
    }

    const rating = await this.prisma.rating.findFirst({
      where: {
        movieId: movieId,
        sourceId: sourceId,
      },
    });

    if (!rating) {
      return null;
    }

    return {
      id: rating.id,
      movieId: rating.movieId,
      stars: rating.stars,
      createdAt: rating.createdAt,
      sourceId: rating.sourceId || undefined,
    };
  }

  // Create or update rating (upsert-like behavior)
  async createOrUpdateRating(createRatingDto: CreateRatingDto): Promise<RatingResponseDto> {
    const { movieId, stars, sourceId } = createRatingDto;

    if (!sourceId) {
      // If no sourceId, just create a new rating
      return this.createRating(createRatingDto);
    }

    // Check for existing rating
    const existingRating = await this.getUserRatingForMovie(movieId, sourceId);

    if (existingRating) {
      // Update existing rating
      return this.updateRating(existingRating.id, stars, sourceId);
    } else {
      // Create new rating
      return this.createRating(createRatingDto);
    }
  }

  // Update movie aggregate fields (avgRating and ratingsCount)
  private async updateMovieAggregates(tx: any, movieId: number) {
    const aggregateResult = await tx.rating.aggregate({
      where: { movieId },
      _avg: { stars: true },
      _count: { id: true },
    });

    const avgRating = aggregateResult._avg.stars || 0;
    const ratingsCount = aggregateResult._count.id || 0;

    await tx.movie.update({
      where: { id: movieId },
      data: {
        avgRating: Number(avgRating.toFixed(2)),
        ratingsCount,
      },
    });
  }

  private async publishRatingEvent(
    movieId: number,
    newStars: number,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    oldStars?: number,
  ) {
    const event = {
      movieId,
      newStars,
      oldStars,
      action,
      timestamp: new Date().toISOString(),
    };

    try {
      // Publish to Redis stream
      await this.redis.xadd(
        'rating-events',
        '*',
        'data',
        JSON.stringify(event),
      );
    } catch (error) {
      console.error('Failed to publish rating event:', error);
      // Don't throw - rating was successful, event publishing is secondary
    }
  }
}