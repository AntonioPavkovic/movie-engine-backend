import { Controller, Get, Param, ParseIntPipe, Post, Body, Query, ValidationPipe, BadRequestException } from '@nestjs/common';
import { MoviesService } from './movies.service';
import { SearchMovieDTO } from './dto/search_movie.dto';
import { RatingService } from 'src/ratings/service/rating.service';

@Controller('movies')
export class MoviesController {
  constructor(
    private readonly moviesService: MoviesService,
    private readonly ratingService: RatingService
  ) {}
  
  @Get('search')
  async searchMovies(
    @Query('query') query?: string,
    @Query('type') type: 'MOVIE' | 'TV_SHOW' = 'MOVIE',
    @Query('page', new ValidationPipe({ transform: true })) page: number = 0,
    @Query('limit', new ValidationPipe({ transform: true })) limit: number = 10
  ) {
    const searchDto: SearchMovieDTO = { query, type, page, limit };
    return this.moviesService.searchMovies(searchDto);
  }

  @Get('top')
  async top(@Query('limit') limit = '10', @Query('type') type?: 'MOVIE' | 'TV_SHOW') {
    const lim = parseInt(limit, 10) || 10;
    return this.moviesService.getTopMovies(lim, type);
  }

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


  @Post('admin/sync-search')
  async syncToSearch() {
    try {
      const result = await this.moviesService.syncMoviesToSearch();
      return result;
    } catch (error) {
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
        error: error.message
      };
    }
  }
}
