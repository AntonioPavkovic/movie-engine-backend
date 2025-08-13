import { 
  Controller, 
  Get, 
  Param, 
  ParseIntPipe, 
  Post, 
  Body, 
  Query, 
  ValidationPipe, 
  BadRequestException, 
  UseGuards, 
  HttpException, 
  HttpStatus 
} from '@nestjs/common';
import { MoviesService } from './movies.service';
import { RatingService } from 'src/ratings/service/rating.service';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { MovieType } from '@prisma/client';
import { QueryParserService } from 'src/search/services/query-parser.service';
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
        syncRatings: options?.syncRatings !== false // default true
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

  @Get('debug/parse')
  async debugQueryParsing(@Query('q') query: string) {
    
    try {
      const criteria = this.queryParser.parseQuery(query);
      console.log('Parsed criteria:', criteria);
      
      return {
        success: true,
        input: query,
        parsed: criteria,
      };
    } catch (error) {
      console.error('Error in parsing:', error);
      return {
        success: false,
        error: error.message
      };
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

    // Parse and validate parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1) {
      throw new HttpException('Page must be greater than 0', HttpStatus.BAD_REQUEST);
    }

    if (limitNum < 1 || limitNum > 50) {
      throw new HttpException('Limit must be between 1 and 50', HttpStatus.BAD_REQUEST);
    }

    // Validate type if provided
    if (type && !Object.values(MovieType).includes(type)) {
      throw new HttpException('Invalid type. Must be MOVIE or TV_SHOW', HttpStatus.BAD_REQUEST);
    }

    try {
      console.log('Calling OpenSearch service with correct parameters...');
      
      // Call with correct parameter order: query, type, page, limit
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
    @Query('page') page = '1'  
  ) {
    const limitNum = parseInt(limit, 10) || 10;
    const pageNum = parseInt(page, 10) || 1;
    
    console.log('Top movies request:', { limit: limitNum, type, page: pageNum });

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
      let result;
      
      if (pageNum === 1) {
        result = await this.openSearchService.getTopRatedMovies(type, limitNum);
      } else {
        result = await this.openSearchService.searchMovies(undefined, type, pageNum, limitNum);
      }
      
      console.log('Top movies result:', {
        moviesCount: result.movies.length,
        total: result.total,
        page: result.page,
        totalPages: result.totalPages
      });
      
      // Return consistent format that matches search endpoint
      return {
        success: true,
        data: result,
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

      const updatedMovie = await this.moviesService.getMovieByIdWithRatings(id);

      return {
        success: true,
        message: 'Anonymous rating submitted successfully',
        data: {
          rating: {
            stars: ratingResult.stars,
            movieId: ratingResult.movieId,
            createdAt: ratingResult.createdAt
          },
          movie: {
            id: updatedMovie.id,
            title: updatedMovie.title,
            avgRating: updatedMovie.avgRating,
            ratingsCount: updatedMovie.ratingsCount,
            description: updatedMovie.description,
            releaseDate: updatedMovie.releaseDate,
            type: updatedMovie.type,
            casts: updatedMovie.casts
          }
        }
      };
    } catch (error: any) {
      throw new BadRequestException(`Rating failed: ${error.message}`);
    }
  }

  @Get('debug/test-nlp')
  async testNlpParsing(@Query('query') query: string) {
    if (!query) {
      throw new BadRequestException('Query parameter is required');
    }

    try {
      return {
        success: true,
        query: query,
        message: 'Use the search endpoint to test NLP parsing in action'
      };
    } catch (error: any) {
      throw new HttpException(
        `NLP test failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}