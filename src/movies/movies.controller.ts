import { 
  Controller, 
  Get, 
  Param, 
  ParseIntPipe, 
  Post, 
  Body, 
  Query,  
  BadRequestException, 
  UseGuards, 
  HttpException, 
  HttpStatus 
} from '@nestjs/common';
import { MoviesService } from './movies.service';
import { RatingService } from 'src/ratings/service/rating.service';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { MovieType } from '@prisma/client';
import { QueryParserService } from 'src/search/services/query_parser.service';
import { OpenSearchEngineService } from 'src/search/opensearch_engine.service';
import { InitialSyncService, SyncOptions } from 'src/sync/initial_sync.service';

@Controller('movies')
@UseGuards(ApiKeyGuard)
export class MoviesController {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly ratingService: RatingService,
    private readonly openSearchService: OpenSearchEngineService,
    private readonly queryParser: QueryParserService,
    private readonly syncService: InitialSyncService
  ) {}
  

  @Post('sync/start')
  async startDataSync(
    @Body() options?: {
      batchSize?: number;
      deleteExisting?: boolean;
      syncRatings?: boolean;
    }
  ) {
    try {
      const syncOptions: SyncOptions = {
        batchSize: options?.batchSize || 100,
        deleteExisting: options?.deleteExisting || false,
        syncRatings: options?.syncRatings !== false 
      };

      const result = await this.syncService.startSync(syncOptions);
      
      return {
        success: true,
        message: result.message,
        syncId: result.syncId,
        options: syncOptions,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      throw new HttpException(
        `Failed to start sync: ${error.message}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  @Get('sync/status')
  async getSyncStatus() {
    try {
      const status = this.syncService.getSyncStatus();
      
      return {
        success: true,
        data: status,
        message: status.isRunning 
          ? `Sync in progress: ${status.progress}% (${status.processedRecords}/${status.totalRecords})` 
          : status.currentOperation === 'Sync completed'
            ? 'Last sync completed successfully'
            : 'No sync running',
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      throw new HttpException(
        `Failed to get sync status: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('search')
  async searchMovies(
    @Query('query') query?: string,
    @Query('type') type?: MovieType,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    console.log('=== SEARCH ENDPOINT CALLED ===');
    console.log('Query:', query);
    console.log('Type:', type);
    console.log('Page:', page);
    console.log('Limit:', limit);

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1) {
      throw new HttpException('Page must be greater than 0', HttpStatus.BAD_REQUEST);
    }

    if (limitNum < 1 || limitNum > 50) {
      throw new HttpException('Limit must be between 1 and 50', HttpStatus.BAD_REQUEST);
    }

    if (type && !Object.values(MovieType).includes(type)) {
      throw new HttpException('Invalid type. Must be MOVIE or TV_SHOW', HttpStatus.BAD_REQUEST);
    }

    try {
      console.log('Calling OpenSearch service with correct parameters...');
      
      const result = await this.openSearchService.searchMovies(
        query,
        type,
        pageNum,
        limitNum
      );
      
      console.log('Search result:', {
        moviesFound: result.movies.length,
        total: result.total,
        page: result.page,
        totalPages: result.totalPages
      });

      const response = {
        success: true,
        data: result,
        message: query 
          ? `Found ${result.total} results for "${query}"` 
          : `Found ${result.total} ${type || 'movies and TV shows'}`
      };

      console.log('Sending response with', result.movies.length, 'movies');
      return response;
      
    } catch(error: any) {
      console.log('ERROR in search:', error.message);
      console.log('Full error:', error);
      
      throw new HttpException(
        `Search failed: ${error.message}`, 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  
  @Get('top')
  async getTopMovies(
    @Query('limit') limit = '10',
    @Query('type') type?: MovieType,
    @Query('page') page = '0' 
  ) {
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const clientPage = parseInt(page, 10);
    if (Number.isNaN(clientPage) || clientPage < 0) {
      throw new HttpException('Page must be a non-negative integer', HttpStatus.BAD_REQUEST);
    }

    const servicePage = Math.max(0, clientPage);

    if (type && !Object.values(MovieType).includes(type)) {
      throw new HttpException('Invalid type. Must be MOVIE or TV_SHOW', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.openSearchService.getTopRatedMovies(type, servicePage, limitNum);

      const hasMore = (servicePage + 1) * limitNum < result.total;

      return {
        success: true,
        data: {
          movies: result.movies,
          total: result.total,
          page: clientPage, 
          totalPages: Math.ceil(result.total / limitNum),
          hasMore
        },
        message: `Found ${result.total} top ${type ? type.toLowerCase().replace('_', ' ') + 's' : 'movies and TV shows'}`
      };
    } catch (error: any) {
      console.error('Top movies error:', error);
      throw new HttpException(
        `Failed to get top movies: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':id')
  async getMovieById(@Param('id', ParseIntPipe) id: number) {
    try {
      const movie = await this.moviesService.getMovieById(id);
      return {
        success: true,
        data: movie,
        message: 'Movie retrieved successfully'
      };
    } catch (error: any) {
      throw new HttpException(
        `Movie not found: ${error.message}`,
        HttpStatus.NOT_FOUND
      );
    }
  }

  @Post(':id/rate')
  async rateMovie(
    @Param('id', ParseIntPipe) id: number,
    @Body() rateMovieDto: { stars: number },
  ) {
    if (!rateMovieDto.stars || rateMovieDto.stars < 1 || rateMovieDto.stars > 5) {
      throw new BadRequestException('Stars must be between 1 and 5');
    }
    
    try {
      const ratingResult = await this.ratingService.createAnonymousRating({
        movieId: id,
        stars: rateMovieDto.stars,
      });
      return {
        success: true,
        message: 'Anonymous rating submitted successfully',
      };
    } catch (error: any) {
      throw new BadRequestException(`Rating failed: ${error.message}`);
    }
  }

}