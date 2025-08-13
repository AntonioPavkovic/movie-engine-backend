import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { OpenSearchEngineService } from 'src/search/opensearch_engine.service';


@Injectable()
export class PostgresOpenSearchSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearch: OpenSearchEngineService,
  ) {}

  async fullSyncMovies() {
    const batchSize = 100;
    let offset = 0;

    while (true) {
      const movies = await this.prisma.movie.findMany({
        skip: offset,
        take: batchSize,
        include: { casts: { include: { actor: true } } },
        orderBy: { id: 'asc' },
      });

      if (movies.length === 0) break;

      const osMovies = movies.map(movie => ({
        id: movie.id,
        title: movie.title,
        description: movie.description,
        cast: movie.casts.map(c => c.actor.name).join(' '),
        type: movie.type,
        releaseDate: movie.releaseDate.toISOString(),
        averageRating: movie.avgRating || 0,
        ratingCount: movie.ratingsCount || 0,
        createdAt: movie.createdAt.toISOString(),
        updatedAt: movie.updatedAt.toISOString(),
      }));

      await this.openSearch.bulkIndexMovies(osMovies);
      offset += batchSize;
    }
  }
}
