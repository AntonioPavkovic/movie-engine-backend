import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { OpenSearchEngineService } from '../opensearch_engine.service';

@Injectable()
export class SearchSeederService implements OnModuleInit {
  private readonly logger = new Logger(SearchSeederService.name);

  constructor(private prisma: PrismaService, private search: OpenSearchEngineService) {}

  async onModuleInit() {
    // run once, optionally gate via env var
    if (process.env.SEED_SEARCH_ON_START !== 'true') return;
    await this.seed();
  }

  async seed() {
    this.logger.log('Seeding OpenSearch from Postgres...');
    const batchSize = 500;
    let page = 0;
    while (true) {
      const movies = await this.prisma.movie.findMany({
        skip: page * batchSize,
        take: batchSize,
        include: { casts: { include: { actor: true } } },
        orderBy: { id: 'asc' },
      });
      if (!movies.length) break;

    
      const docs = movies.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description,
        cast: (m.casts || []).map(c => c.actor.name).join(' '),
        type: m.type,
        releaseDate: m.releaseDate,
        averageRating: m.avgRating ?? 0,
        ratingCount: m.ratingsCount ?? 0,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }));

      await this.search.bulkIndexMovies(docs);
      page++;
    }
    this.logger.log('Seeding completed');
  }
}
