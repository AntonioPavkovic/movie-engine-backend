import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { MovieType } from '@prisma/client';


@Injectable()
export class MoviesService {
  constructor(
    private prisma: PrismaService
  ) {}

  async getTopMovies(limit = 10, type?: 'MOVIE' | 'TV_SHOW', page = 0) {
    const where = type ? { type } : {};
    const skip = page * limit;
    
    const [movies, total] = await Promise.all([
      this.prisma.movie.findMany({
        where,
        orderBy: { avgRating: 'desc' },
        skip,
        take: limit,
        include: { casts: { include: { actor: true } } },
      }),
      this.prisma.movie.count({ where })
    ]);

    return {
      movies,
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total
    };
  }

  async getMovieById(id: number) {
    const movie = await this.prisma.movie.findUnique({
      where: { id },
      include: { casts: { include: { actor: true } } },
    });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
  }
}