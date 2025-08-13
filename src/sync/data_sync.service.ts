import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { OpenSearchEngineService } from 'src/search/opensearch_engine.service';


interface SyncEvent {
  operation: 'CREATE';
  entity: 'movie' | 'rating' | 'cast';
  entityId: number;
  data?: any;
  timestamp: Date;
}

@Injectable()
export class DataSyncService implements OnModuleInit {
  private readonly logger = new Logger(DataSyncService.name);
  private readonly syncStreamKey = 'data-sync-events';
  private readonly batchSize = 100;
  private isProcessing = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private openSearch: OpenSearchEngineService,
  ) {}

  async onModuleInit() {
    this.startSyncProcessor();
    
    await this.checkAndPerformInitialSync();
  }


  private async startSyncProcessor() {
    this.logger.log('Starting data sync processor...');
    
    while (true) {
      try {
        if (this.isProcessing) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        const results = await this.redis.xread(
          'BLOCK',
          5000,
          'STREAMS',
          this.syncStreamKey,
          '$',
        );

        if (results && results.length > 0) {
          this.isProcessing = true;
          await this.processSyncEvents(results);
          this.isProcessing = false;
        }
      } catch (error) {
        this.logger.error('Error processing sync events:', error);
        this.isProcessing = false;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processSyncEvents(results: any[]) {
    const movieEvents = new Map<number, SyncEvent[]>();
    
    for (const [stream, messages] of results) {
      for (const [id, fields] of messages) {
        try {
          const eventData: SyncEvent = JSON.parse(fields[1]);
          

          if (eventData.entity === 'movie') {
            if (!movieEvents.has(eventData.entityId)) {
              movieEvents.set(eventData.entityId, []);
            }
            movieEvents.get(eventData.entityId)!.push(eventData);
          } else if (eventData.entity === 'rating' || eventData.entity === 'cast') {

            const movieId = eventData.data?.movieId || eventData.entityId;
            if (!movieEvents.has(movieId)) {
              movieEvents.set(movieId, []);
            }
            movieEvents.get(movieId)!.push(eventData);
          }
        } catch (error) {
          this.logger.error(`Failed to parse sync event ${id}:`, error);
        }
      }
    }

    for (const [movieId, events] of movieEvents) {
      await this.syncMovieToOpenSearch(movieId, events);
    }
  }


  private async syncMovieToOpenSearch(movieId: number, events: SyncEvent[]) {
    try {
      const movie = await this.getMovieForSync(movieId);
      
      if (!movie) {
        this.logger.warn(`Movie ${movieId} not found in PostgreSQL, skipping sync`);
        return;
      }

      await this.openSearch.indexMovie(movie);
      
      this.logger.log(`Successfully synced movie ${movieId} to OpenSearch`);
    } catch (error) {
      this.logger.error(`Failed to sync movie ${movieId}:`, error);
    }
  }

  private async getMovieForSync(movieId: number) {
    const movie = await this.prisma.movie.findUnique({
      where: { id: movieId },
      include: {
        casts: {
          include: { actor: true }
        }
      }
    });

    if (!movie) return null;


    return {
      id: movie.id,
      title: movie.title,
      description: movie.description,
      cast: movie.casts.map(c => c.actor.name),
      type: movie.type,
      releaseDate: movie.releaseDate,
      avgRating: movie.avgRating,
      ratingsCount: movie.ratingsCount, 
      createdAt: movie.createdAt,
      updatedAt: movie.updatedAt
    };
  }


  private async getOpenSearchDocumentCount(): Promise<number> {
    try {
      const result = await this.openSearch.searchMovies(undefined, undefined, 1, 1);
      return result.total;
    } catch (error) {
      this.logger.error('Failed to get OpenSearch document count:', error);
      return 0;
    }
  }

  private async checkAndPerformInitialSync() {
    try {
      const indexExists = await this.openSearch.checkIndexExists();
      
      if (!indexExists) {
        this.logger.log('OpenSearch index does not exist, creating and performing full sync...');
        await this.openSearch.createIndex();
        await this.performFullSync();
        return;
      }

      const osCount = await this.getOpenSearchDocumentCount();

      const pgCount = await this.prisma.movie.count();

      this.logger.log(`OpenSearch has ${osCount} movies, PostgreSQL has ${pgCount} movies`);

      if (osCount !== pgCount) {
        this.logger.log('Document counts mismatch, performing full sync...');
        await this.performFullSync();
      } else {
        this.logger.log('Document counts match, skipping initial sync');
      }
    } catch (error) {
      this.logger.error('Failed to check initial sync status:', error);
    }
  }


  async performFullSync() {
    this.logger.log('Starting full synchronization...');
    
    try {
      let offset = 0;
      let totalSynced = 0;

      while (true) {
        const movies = await this.prisma.movie.findMany({
          skip: offset,
          take: this.batchSize,
          include: {
            casts: { include: { actor: true } },
            ratings: true, 
            _count: { select: { ratings: true } }  
          },
          orderBy: { id: 'asc' }
        });

        if (movies.length === 0) break;

        const transformedMovies = movies.map(movie => {
          const avgRating = movie.ratings?.length
            ? movie.ratings.reduce((sum, r) => sum + r.stars, 0) / movie.ratings.length
            : 0;

          return {
            id: movie.id,
            title: movie.title,
            description: movie.description,
            cast: movie.casts.map(c => c.actor.name),
            type: movie.type,
            releaseDate: movie.releaseDate,
            avgRating,
            ratingsCount: movie._count?.ratings || 0,
            createdAt: movie.createdAt,
            updatedAt: movie.updatedAt
          };
        });

        await this.openSearch.bulkIndexMovies(transformedMovies);

        totalSynced += movies.length;
        offset += this.batchSize;

        this.logger.log(`Synced ${totalSynced} movies so far...`);

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.logger.log(`Full sync completed. Synced ${totalSynced} movies total.`);
    } catch (error) {
      this.logger.error('Full sync failed:', error);
      throw error;
    }
  }
}