import { Controller, Get, Param, ParseIntPipe, Post, Body, Query, ValidationPipe } from '@nestjs/common';
import { MoviesService } from './movies.service';
import { SearchMovieDTO } from './dto/search_movie.dto';

@Controller('movies')
export class MoviesController {
  constructor(private readonly service: MoviesService) {}

  @Get('search')
  async searchMovies(
    @Query('query') query?: string,
    @Query('type') type: 'MOVIE' | 'TV_SHOW' = 'MOVIE',
    @Query('page', new ValidationPipe({ transform: true })) page: number = 0,
    @Query('limit', new ValidationPipe({ transform: true })) limit: number = 10
  ) {
    const searchDto: SearchMovieDTO = { query, type, page, limit };
    return this.service.searchMovies(searchDto);
  }

  @Get('top')
  async top(@Query('limit') limit = '10', @Query('type') type?: 'MOVIE' | 'TV_SHOW') {
    const lim = parseInt(limit, 10) || 10;
    return this.service.getTopMovies(lim, type);
  }

  @Get(':id')
  async byId(@Param('id', ParseIntPipe) id: number) {
    return this.service.getMovieById(id);
  }

  @Post('admin/sync-search')
  async syncToSearch() {
    try {
      const result = await this.service.syncMoviesToSearch();
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
