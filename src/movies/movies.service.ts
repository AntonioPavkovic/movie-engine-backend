import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class MoviesService {
  constructor(
    private prisma: PrismaService,
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

}
