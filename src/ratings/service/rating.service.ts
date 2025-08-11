import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { CreateRatingDto } from '../dto/rating.dto';
import { MovieRatingStatsDto } from '../dto/movie-rating-stats.dto';
import { RatingResponseDto } from '../dto/rating-response.dto';
import { SearchService } from 'src/search/search.service';

@Injectable()
export class RatingService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private searchService: SearchService,
  ) {}

  async createAnonymousRating(data: {
    movieId: number;
    stars: number;
    userIp?: string;
  }): Promise<RatingResponseDto> {
    const { movieId, stars } = data;

    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
    });

    if (!movie) {
      throw new BadRequestException('Movie not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rating = await tx.rating.create({
        data: {
          movieId,
          stars
        },
      });

      await this.updateMovieAggregates(tx, movieId);

      return rating;
    });

    await this.publishRatingEvent(movieId, stars, 'CREATE');

    return {
      id: result.id,
      movieId: result.movieId,
      stars: result.stars,
      createdAt: result.createdAt,
    };
  }

  async createRating(createRatingDto: CreateRatingDto): Promise<RatingResponseDto> {
    const { movieId, stars, sourceId } = createRatingDto;

    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
    });

    if (!movie) {
      throw new BadRequestException('Movie not found');
    }

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

    const result = await this.prisma.$transaction(async (tx) => {
  
      const rating = await tx.rating.create({
        data: {
          movieId,
          stars,
          sourceId,
        },
      });

      await this.updateMovieAggregates(tx, movieId);

      return rating;
    });

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

    if (sourceId && existingRating.sourceId !== sourceId) {
      throw new BadRequestException('Not authorized to update this rating');
    }

    const oldStars = existingRating.stars;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedRating = await tx.rating.update({
        where: { id: ratingId },
        data: { stars },
      });

      await this.updateMovieAggregates(tx, existingRating.movieId);

      return updatedRating;
    });

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
    const cacheKey = `movie:${movieId}:stats`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

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

    await this.redis.setex(cacheKey, 300, JSON.stringify(stats));

    return stats;
  }

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

  async createOrUpdateRating(createRatingDto: CreateRatingDto): Promise<RatingResponseDto> {
    const { movieId, stars, sourceId } = createRatingDto;

    if (!sourceId) {
      return this.createRating(createRatingDto);
    }


    const existingRating = await this.getUserRatingForMovie(movieId, sourceId);

    if (existingRating) {
  
      return this.updateRating(existingRating.id, stars, sourceId);
    } else {

      return this.createRating(createRatingDto);
    }
  }

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

    setTimeout(async () => {
      try {
        await this.updateSearchIndexForMovie(movieId, avgRating, ratingsCount);
      } catch (error) {
        console.error(`Failed to update search index for movie ${movieId}:`, error);
      }
    }, 0);
  }

  private async updateSearchIndexForMovie(movieId: number, avgRating: number, ratingsCount: number) {
    try {
      await this.searchService.updateMovieRating(
        movieId.toString(),
        Number(avgRating.toFixed(2)),
        ratingsCount
      );
      console.log(`Updated search index for movie ${movieId}: avgRating=${avgRating}, count=${ratingsCount}`);
    } catch (error) {
      console.error(`Search index update failed for movie ${movieId}:`, error);
    }
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
      await this.redis.xadd(
        'rating-events',
        '*',
        'data',
        JSON.stringify(event),
      );
    } catch (error) {
      console.error('Failed to publish rating event:', error);
    }
  }
}