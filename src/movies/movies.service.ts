import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { OpenSearchService } from '../opensearch/opensearch.service';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MoviesService {
  constructor(
    private prisma: PrismaService,
    private os: OpenSearchService,
    private redisService: RedisService,
  ) {}

  async getTopMovies(limit = 10, type?: 'MOVIE' | 'TV_SHOW') {
    const where = type ? { type } : {};
    return this.prisma.movie.findMany({
      where,
      orderBy: { avgRating: 'desc' },
      take: limit,
      include: { casts: { include: { actor: true } } },
    });
  }

  async getMovieById(id: number) {
    const movie = await this.prisma.movie.findUnique({
      where: { id },
      include: { casts: { include: { actor: true } } },
    });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
  }

  async rateMovie(movieId: number, stars: number) {

    if(stars < 1 || stars > 5) throw new BadRequestException('Rading must be between 1 and 5');

    const exists = await this.prisma.movie.findUnique({ where: { id: movieId }, select: { id: true }});
    if (!exists) throw new NotFoundException('Movie not found');

    const sourceId = uuidv4();
    const now = Date.now();
        await this.redisService.client.xadd(
      process.env.STREAM_KEY || 'ratings:stream',
      '*',
      'movieId', String(movieId),
      'stars', String(stars),
      'sourceId', sourceId,
      'createdAt', String(now)
    );

    // OPTIONAL: maintain instant counters for quick avg read
    const sumKey = `movie:${movieId}:rating_sum`;
    const countKey = `movie:${movieId}:rating_count`;
    await this.redisService.client
      .pipeline()
      .incrby(sumKey, stars)
      .incr(countKey)
      .exec();
    const [sumStr, countStr] = await this.redisService.client.mget(sumKey, countKey);
    const sum = Number(sumStr ?? 0);
    const count = Number(countStr ?? 0);
    const avg = count ? +(sum / count).toFixed(2) : 0;

    // DON'T index here — worker will index after DB update.
    return { avg, count };
  }

  async indexMovie(movieId: number) {
    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
      include: {
        casts: { include: { actor: true } },
      },
    });
    if (!movie) throw new Error('movie not found for indexing');

    const doc = {
      id: movie.id,
      title: movie.title,
      description: movie.description,
      coverUrl: movie.coverUrl,
      releaseDate: movie.releaseDate,
      type: movie.type,
      avgRating: movie.avgRating,
      ratingsCount: movie.ratingsCount,
      cast: movie.casts.map((c) => c.actor.name).join(', '),
      castObjects: movie.casts.map((c) => ({ name: c.actor.name, role: c.role })),
      updatedAt: movie.updatedAt,
    };

    await this.os.indexMovieDoc(movie.id, doc);
  }
}
