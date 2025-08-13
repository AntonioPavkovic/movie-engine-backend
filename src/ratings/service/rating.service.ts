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
    if (dto.stars < 1 || dto.stars > 5) {
      throw new BadRequestException('Rating must be between 1 and 5 stars');
    }

    const movie = await this.prisma.movie.findUnique({
      where: { id: dto.movieId },
      select: { id: true }
    });

    if (!movie) {
      throw new BadRequestException('Movie not found');
    }

    try {

      const rating = await this.prisma.rating.create({
        data: {
          movieId: dto.movieId,
          stars: dto.stars,
          sourceId: dto.sourceId || 'anonymous',
        },
      });

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
      console.error('Failed to emit rating event:', error);
    }
  }
}