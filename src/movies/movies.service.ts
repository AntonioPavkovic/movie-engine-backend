import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { SearchService } from 'src/search/search.service';
import { SearchMovieDTO } from './dto/search_movie.dto';
import { ContentType } from 'src/common/enums/movie-types';
import { MovieType } from '@prisma/client';

interface FixRatingResult {
  movieId: number;
  title: string;
  ratingsCount?: number;
  avgRating?: number;
  status: 'fixed' | 'error';
  error?: string;
}

@Injectable()
export class MoviesService {
  constructor(
    private prisma: PrismaService,
    private searchService: SearchService
  ) {}

  async getTopMovies(limit = 10, type?: 'MOVIE' | 'TV_SHOW') {
    const where = type ? { type } : {};
    return this.prisma.movie.findMany({
      where,
      orderBy: { avgRating: 'desc' },
      take: limit,
      include: { casts: { include: { actor: true } } },
    });
  }

  async getTopRatedMovies(type: MovieType = MovieType.MOVIE, page: number = 0, limit: number = 10) {
    const skip = page * limit;
    
    const [movies, total] = await Promise.all([
      this.prisma.movie.findMany({
        where: { type },
        include: { 
          casts: { 
            include: { actor: true } 
          },
          ratings: {
            select: { stars: true }
          }
        },
        orderBy: [
          { avgRating: 'desc' },
          { ratingsCount: 'desc' },
          { createdAt: 'desc' }
        ],
        skip,
        take: limit,
      }),
      this.prisma.movie.count({
        where: { type }
      })
    ]);

    return {
      movies,
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total
    };
  }

  async searchMovies(searchDto: SearchMovieDTO) {
    const { query, type = MovieType.MOVIE, page = 0, limit = 10 } = searchDto;

    if (!query || query.trim().length < 2) {
      return this.getTopRatedMovies(type, page, limit);
    }

    const searchResults = await this.searchService.searchMovies(
      query.trim(),
      type,
      page,
      limit
    );

    const movieIds = searchResults.hits.map(hit => parseInt(hit.id));
    
    if (movieIds.length === 0) {
      return {
        movies: [],
        total: 0,
        page,
        limit,
        hasMore: false
      };
    }


    const movies = await this.prisma.movie.findMany({
      where: {
        id: { in: movieIds },
        type: type
      },
      include: {
        casts: { 
          include: { actor: true } 
        },
        ratings: {
          select: { 
            stars: true, 
            createdAt: true 
          }
        }
      }
    });

    const orderedMovies = movieIds
      .map(id => movies.find(movie => movie.id === id))
      .filter(Boolean);

    return {
      movies: orderedMovies,
      total: searchResults.total,
      page,
      limit,
      hasMore: (page + 1) * limit < searchResults.total
    };
  }

    async getMovieByIdWithRatings(id: number) {
    const movie = await this.prisma.movie.findUnique({
      where: { id },
      include: { 
        casts: { include: { actor: true } },
        ratings: {
          select: {
            stars: true, 
            createdAt: true,
            sourceId: true
          }
        }
      },
    });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
  }

  async getMovieById(id: number) {
    const movie = await this.prisma.movie.findUnique({
      where: { id },
      include: { casts: { include: { actor: true } } },
    });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
  }


  async syncMoviesToSearch() {
    try {
      const movies = await this.prisma.movie.findMany({
        include: {
          casts: { include: { actor: true } }
        }
      });

      for (const movie of movies) {
        const searchMovie = {
          ...movie,
          cast: movie.casts?.map(cast => cast.actor?.name).join(' ') || '',
          averageRating: movie.avgRating,
          ratingCount: movie.ratingsCount,
          coverImage: movie.coverUrl
        };
        
        await this.searchService.indexMovie(searchMovie);
      }

      return { 
        success: true, 
        message: `Successfully synced ${movies.length} movies to search index`,
        count: movies.length
      };
    } catch (error) {
      throw new BadRequestException(`Failed to sync movies to search: ${error.message}`);
    }
  }

  async updateSearchIndex(movieId: number) {
    try {
      const movie = await this.prisma.movie.findUnique({
        where: { id: movieId },
        include: {
          casts: { include: { actor: true } }
        }
      });

      if (movie) {
        const searchMovie = {
          ...movie,
          cast: movie.casts?.map(cast => cast.actor?.name).join(' ') || '',
          averageRating: movie.avgRating,
          ratingCount: movie.ratingsCount,
          coverImage: movie.coverUrl
        };
        
        await this.searchService.indexMovie(searchMovie);
        console.log(`Updated search index for movie ${movieId}`);
      }
    } catch (error) {
      console.error(`Failed to update search index for movie ${movieId}:`, error);
    }
  }
}