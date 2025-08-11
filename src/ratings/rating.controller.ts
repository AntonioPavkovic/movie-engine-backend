import { Controller, Post, Get, Put, Body, Param, ParseIntPipe } from '@nestjs/common';
import { MovieRatingStatsDto } from './dto/movie-rating-stats.dto';
import { RatingResponseDto } from './dto/rating-response.dto';
import { CreateRatingDto } from './dto/rating.dto';
import { RatingService } from './service/rating.service';


@Controller('ratings')
export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Post()
  async createRating(@Body() createRatingDto: CreateRatingDto): Promise<RatingResponseDto> {
    return this.ratingService.createRating(createRatingDto);
  }

  @Put(':id')
  async updateRating(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { stars: number; sourceId?: string },
  ): Promise<RatingResponseDto> {
    return this.ratingService.updateRating(id, body.stars, body.sourceId);
  }

  @Get('movie/:movieId')
  async getRatingsByMovie(
    @Param('movieId', ParseIntPipe) movieId: number,
  ): Promise<RatingResponseDto[]> {
    return this.ratingService.getRatingsByMovie(movieId);
  }

  @Get('movie/:movieId/stats')
  async getMovieRatingStats(
    @Param('movieId', ParseIntPipe) movieId: number,
  ): Promise<MovieRatingStatsDto> {
    return this.ratingService.getMovieRatingStats(movieId);
  }
}
