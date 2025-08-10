import { Controller, Get, Param, ParseIntPipe, Post, Body, Query } from '@nestjs/common';
import { MoviesService } from './movies.service';

@Controller('movies')
export class MoviesController {
  constructor(private service: MoviesService) {}

  @Get('top')
  async top(@Query('limit') limit = '10', @Query('type') type?: 'MOVIE' | 'TV_SHOW') {
    const lim = parseInt(limit, 10) || 10;
    return this.service.getTopMovies(lim, type);
  }

  @Get(':id')
  async byId(@Param('id', ParseIntPipe) id: number) {
    return this.service.getMovieById(id);
  }

  @Post(':id/rate')
  async rate(
    @Param('id', ParseIntPipe) id: number,
    @Body('stars') stars: number,
  ) {
    return this.service.rateMovie(id, Number(stars));
  }
}
