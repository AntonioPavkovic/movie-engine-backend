import { Controller, Get, Param, ParseIntPipe, Post, Body, Query, ValidationPipe, BadRequestException, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MoviesService } from './movies.service';
import { SearchMovieDTO } from './dto/search_movie.dto';
import { RatingService } from 'src/ratings/service/rating.service';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { OpenSearchService } from 'src/search/opensearch.service';

@Controller('movies')
@UseGuards(ApiKeyGuard)
export class MoviesController {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly ratingService: RatingService,
    private openSearchService: OpenSearchService
  ) {}
  
  // ===== SPECIFIC ROUTES FIRST (before :id route) =====
  
  @Get('search')
  async searchMovies(
    @Query('query') query: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20'
  ) {
    console.log('=== SEARCH ENDPOINT CALLED ===');
    console.log('Query:', query);
    console.log('Page:', page);
    console.log('Limit:', limit);

    if (!query || query.trim() === '') {
      console.log('ERROR: Empty query');
      throw new HttpException('Query parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      console.log('Calling OpenSearch service...');
      
      const result = await this.openSearchService.searchMovies(
        query,
        parseInt(page),
        parseInt(limit)
      );
      
      console.log('Search result:', JSON.stringify(result, null, 2));

      const response = {
        success: true,
        data: result,
        message: `Found ${result.total} results for "${query}"`
      };

      console.log('Sending response:', response);
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
  async top(@Query('limit') limit = '10', @Query('type') type?: 'MOVIE' | 'TV_SHOW') {
    const lim = parseInt(limit, 10) || 10;
    return this.moviesService.getTopMovies(lim, type);
  }

  @Get('index-exists')
  async checkIndexExists() {
    try {
      const exists = await this.openSearchService.checkIndexExists();
      return {
        success: true,
        exists: exists,
        message: exists ? 'Index exists' : 'Index does not exist'
      };
    } catch (error) {
      return {
        success: false,
        message: `Check failed: ${error.message}`,
        error: error.message
      };
    }
  }

  @Get('index-mapping')
  async getIndexMapping() {
    try {
      const mapping = await this.openSearchService.getIndexMapping();
      return {
        success: true,
        mapping: mapping,
        message: 'Index mapping retrieved successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: `Mapping retrieval failed: ${error.message}`,
        error: error.message
      };
    }
  }

  @Post('create-index')
  async createSearchIndex() {
    try {
      await this.openSearchService.createMoviesIndex();
      return {
        success: true,
        message: 'Search index created successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: `Index creation failed: ${error.message}`,
        error: error.message
      };
    }
  }

  @Post('delete-index')
  async deleteSearchIndex() {
    try {
      await this.openSearchService.deleteMoviesIndex();
      return {
        success: true,
        message: 'Search index deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: `Index deletion failed: ${error.message}`,
        error: error.message
      };
    }
  }

  @Post('sync-search')
  async syncToSearch() {
    try {
      await this.openSearchService.syncMoviesToOpenSearch();
      return {
        success: true,
        message: 'Movies synced to search index successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
        error: error.message
      };
    }
  }

  // ===== PARAMETERIZED ROUTES LAST =====

  @Get(':id')
  async byId(@Param('id', ParseIntPipe) id: number) {
    return this.moviesService.getMovieById(id);
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
      await this.moviesService.updateSearchIndex(id);

      return {
        success: true,
        message: 'Anonymous rating submitted successfully',
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
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}