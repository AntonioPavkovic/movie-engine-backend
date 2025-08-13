import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchEngineService } from '../search/opensearch_engine.service';
import { PrismaService } from 'prisma/prisma.service';


export interface SyncStatus {
  isRunning: boolean;
  progress: number;
  totalRecords: number;
  processedRecords: number;
  currentOperation: string;
  startTime?: Date;
  endTime?: Date;
  errors: string[];
}

export interface SyncOptions {
  batchSize?: number;
  deleteExisting?: boolean;
  syncRatings?: boolean;
}

@Injectable()
export class InitialSyncService {
  private readonly logger = new Logger(InitialSyncService.name);
  private syncStatus: SyncStatus = {
    isRunning: false,
    progress: 0,
    totalRecords: 0,
    processedRecords: 0,
    currentOperation: 'idle',
    errors: []
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearchService: OpenSearchEngineService,
  ) {}

  async startSync(options: SyncOptions = {}): Promise<{ message: string; syncId: string }> {
    if (this.syncStatus.isRunning) {
      throw new Error('Sync is already running');
    }

    const syncId = `sync-${Date.now()}`;
    this.resetSyncStatus();
    this.syncStatus.isRunning = true;
    this.syncStatus.startTime = new Date();

    this.performSync(options).catch((error) => {
      this.logger.error('Sync failed:', error);
      this.syncStatus.errors.push(error.message);
    }).finally(() => {
      this.syncStatus.isRunning = false;
      this.syncStatus.endTime = new Date();
    });

    return {
      message: 'Sync started successfully',
      syncId
    };
  }

  private async performSync(options: SyncOptions): Promise<void> {
    const { batchSize = 100, deleteExisting = false, syncRatings = true } = options;

    try {
      // Step 1: Delete existing data if requested
      if (deleteExisting) {
        this.syncStatus.currentOperation = 'Clearing existing OpenSearch data';
        await this.clearOpenSearchData();
      }

      // Step 2: Count total records
      this.syncStatus.currentOperation = 'Counting records';
      const totalMovies = await this.prisma.movie.count();
      this.syncStatus.totalRecords = totalMovies;

      this.logger.log(`Starting sync of ${totalMovies} movies`);

      // Step 3: Sync movies in batches
      this.syncStatus.currentOperation = 'Syncing movies';
      let skip = 0;
      
      while (skip < totalMovies) {
        const movies = await this.prisma.movie.findMany({
          skip,
          take: batchSize,
          include: {
            casts: {
              include: {
                actor: true
              }
            },
            ratings: true,
            _count: {
              select: {
                ratings: true
              }
            }
          }
        });

        if (movies.length === 0) break;

        await this.syncMoviesToOpenSearch(movies);
        
        skip += batchSize;
        this.syncStatus.processedRecords = skip;
        this.syncStatus.progress = Math.round((skip / totalMovies) * 100);

        this.logger.log(`Synced ${skip}/${totalMovies} movies (${this.syncStatus.progress}%)`);
      }

      this.syncStatus.currentOperation = 'Sync completed';
      this.logger.log('Sync completed successfully');

    } catch (error) {
      this.logger.error('Sync failed:', error);
      this.syncStatus.errors.push(error.message);
      throw error;
    }
  }

  private async clearOpenSearchData(): Promise<void> {
    this.logger.log('Skipping clear operation - deleteIndex method not available');
  }

  private async syncMoviesToOpenSearch(movies: any[]): Promise<void> {
    const documents = movies.map(movie => this.transformMovieForOpenSearch(movie));
    
    try {
      await this.openSearchService.bulkIndex('movies', documents);
    } catch (error) {
      this.logger.error('Failed to bulk index movies:', error);
      throw error;
    }
  }

    private transformMovieForOpenSearch(movie: any) {
    // Calculate average rating
    const avgRating = movie.ratings && movie.ratings.length > 0
        ? movie.ratings.reduce((sum: number, rating: any) => sum + rating.stars, 0) / movie.ratings.length
        : null;

    return {
        id: movie.id,
        title: movie.title,
        description: movie.description,
        releaseDate: movie.releaseDate,
        type: movie.type,
        avgRating,
        ratingsCount: movie._count?.ratings || 0,
        casts: movie.casts?.filter(cast => cast.actor).map((cast: any) => ({
        id: cast.id,
        role: cast.role,
        person: {  // alias actor to person
            id: cast.actor.id,
            name: cast.actor.name,
            bio: '' // Actor model does not have bio, you can leave empty
        }
        })) || [],
        // Add searchable text field for better search
        searchText: [
        movie.title,
        movie.description,
        ...(movie.casts?.filter(cast => cast.actor).map((cast: any) => cast.actor.name) || [])
        ].join(' ')
    };
    }


  getSyncStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  private resetSyncStatus(): void {
    this.syncStatus = {
      isRunning: false,
      progress: 0,
      totalRecords: 0,
      processedRecords: 0,
      currentOperation: 'idle',
      errors: []
    };
  }
}