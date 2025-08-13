import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { OpenSearchEngineService } from 'src/search/opensearch_engine.service';


interface SyncEvent {
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
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

      const hasDeleteEvent = events.some(e => e.operation === 'DELETE' && e.entity === 'movie');
      
      if (hasDeleteEvent) {
        this.logger.log(`Movie ${movieId} deleted - OpenSearch cleanup would be needed`);

        return;
      }

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

  async emitSyncEvent(event: Omit<SyncEvent, 'timestamp'>) {
    try {
      const syncEvent: SyncEvent = {
        ...event,
        timestamp: new Date()
      };

      await this.redis.xadd(
        this.syncStreamKey,
        '*',
        'data',
        JSON.stringify(syncEvent)
      );

      this.logger.debug(`Emitted sync event: ${event.operation} ${event.entity} ${event.entityId}`);
    } catch (error) {
      this.logger.error('Failed to emit sync event:', error);
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

  /**
   * Perform full synchronization from PostgreSQL to OpenSearch
   */
  async   performFullSync() {
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

        // Bulk index to OpenSearch
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


  async performIncrementalSync() {
    this.logger.log('Starting incremental sync...');
    
    try {
      const lastSyncKey = 'last_incremental_sync';
      const lastSyncStr = await this.redis.get(lastSyncKey);
      const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(Date.now() - 60 * 60 * 1000); // Default to 1 hour ago

      const currentTime = new Date();
      const updatedMovies = await this.prisma.movie.findMany({
        where: {
          updatedAt: {
            gt: lastSync
          }
        },
        include: {
          casts: {
            include: { actor: true }
          }
        }
      });

      if (updatedMovies.length === 0) {
        this.logger.log('No movies updated since last incremental sync');
        await this.redis.set(lastSyncKey, currentTime.toISOString());
        return;
      }
      const transformedMovies = updatedMovies.map(movie => {
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
      });

      await this.openSearch.bulkIndexMovies(transformedMovies);

      // Update last sync timestamp
      await this.redis.set(lastSyncKey, currentTime.toISOString());

      this.logger.log(`Incremental sync completed. Updated ${updatedMovies.length} movies.`);
    } catch (error) {
      this.logger.error('Incremental sync failed:', error);
    }
  }


  async syncMovie(movieId: number) {
    await this.emitSyncEvent({
      operation: 'UPDATE',
      entity: 'movie',
      entityId: movieId
    });
  }


  async triggerFullResync() {
    this.logger.log('Manual full resync triggered');
    await this.performFullSync();
  }

 
  async getSyncStatus() {
    try {
      const [pgCount, osCount, lastSync] = await Promise.all([
        this.prisma.movie.count(),
        this.getOpenSearchDocumentCount(),
        this.redis.get('last_incremental_sync')
      ]);

      return {
        postgresql: {
          totalMovies: pgCount
        },
        opensearch: {
          totalMovies: osCount,
          indexExists: await this.openSearch.checkIndexExists()
        },
        sync: {
          inSync: pgCount === osCount,
          lastIncrementalSync: lastSync ? new Date(lastSync) : null,
          isProcessing: this.isProcessing
        }
      };
    } catch (error) {
      this.logger.error('Failed to get sync status:', error);
      throw error;
    }
  }
}