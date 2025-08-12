import { Injectable } from '@nestjs/common';
import { Prisma, MovieType } from '@prisma/client';
import { SearchCriteria, SearchResult, MovieWithCasts, CleanMovie } from '../interfaces/search.interface';
import { PrismaService } from 'prisma/prisma.service';
import { QueryParserService } from './services/query-parser.service';

@Injectable()
export class OpenSearchService {
  constructor(
    private prisma: PrismaService,
    private queryParser: QueryParserService,
  ) {}

  async searchMovies(
    query?: string,
    type?: MovieType,
    page: number = 1,
    limit: number = 10,
  ): Promise<SearchResult> {
    console.log('OpenSearchService.searchMovies called with:', { query, type, page, limit });
    
    const offset = (page - 1) * limit;
    let criteria: SearchCriteria = {};

    // Parse NLP query if provided
    if (query && query.trim().length >= 2) {
      console.log('Parsing NLP query:', query);
      criteria = this.queryParser.parseQuery(query.trim());
      console.log('Parsed criteria:', criteria);
    }

    // Override type if explicitly provided
    if (type) {
      criteria.type = type;
    }

    // Build where clause
    const whereClause = this.buildWhereClause(criteria);
    console.log('Built where clause:', JSON.stringify(whereClause, null, 2));

    // Execute search with count
    const [rawMovies, total] = await Promise.all([
      this.prisma.movie.findMany({
        where: whereClause,
        include: {
          casts: {
            include: {
              actor: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [
          { avgRating: 'desc' },
          { ratingsCount: 'desc' },
          { releaseDate: 'desc' },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.movie.count({
        where: whereClause,
      }),
    ]);

    console.log(`Found ${rawMovies.length} movies out of ${total} total`);

    return {
      movies: this.transformMovies(rawMovies),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTopRatedMovies(
    type?: MovieType,
    limit: number = 10,
  ): Promise<SearchResult> {
    console.log('OpenSearchService.getTopRatedMovies called with:', { type, limit });
    
    const whereClause: Prisma.MovieWhereInput = type ? { type } : {};

    const [rawMovies, total] = await Promise.all([
      this.prisma.movie.findMany({
        where: whereClause,
        include: {
          casts: {
            include: {
              actor: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [
          { avgRating: 'desc' },
          { ratingsCount: 'desc' },
          { releaseDate: 'desc' },
        ],
        take: limit,
      }),
      this.prisma.movie.count({
        where: whereClause,
      }),
    ]);

    console.log(`Found ${rawMovies.length} top rated movies out of ${total} total`);

    return {
      movies: this.transformMovies(rawMovies),
      total,
      page: 1,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get search statistics for the movie database
   */
  async getSearchStats(): Promise<{
    totalMovies: number;
    totalTvShows: number;
    avgRating: number;
    totalRatings: number;
  }> {
    console.log('Getting search stats...');
    
    const [movieCount, tvShowCount, avgRating, totalRatings] = await Promise.all([
      this.prisma.movie.count({ where: { type: 'MOVIE' } }),
      this.prisma.movie.count({ where: { type: 'TV_SHOW' } }),
      this.prisma.movie.aggregate({
        _avg: { avgRating: true },
      }),
      this.prisma.rating.count(),
    ]);

    const stats = {
      totalMovies: movieCount,
      totalTvShows: tvShowCount,
      avgRating: Number((avgRating._avg.avgRating || 0).toFixed(2)),
      totalRatings: totalRatings,
    };

    console.log('Search stats:', stats);
    return stats;
  }

  /**
   * Transform Prisma result to clean API response format
   * Handles null -> undefined conversion and structure cleanup
   */
  private transformMovies(movies: any[]): CleanMovie[] {
    return movies.map(movie => ({
      id: movie.id,
      title: movie.title,
      description: movie.description,
      coverUrl: movie.coverUrl ?? undefined, // Convert null to undefined
      releaseDate: movie.releaseDate,
      type: movie.type,
      avgRating: movie.avgRating,
      ratingsCount: movie.ratingsCount,
      casts: movie.casts.map((cast: any) => ({
        actor: {
          name: cast.actor.name,
        },
        role: cast.role ?? undefined, // Convert null to undefined
      })),
    }));
  }

  private buildWhereClause(criteria: SearchCriteria): Prisma.MovieWhereInput {
    console.log('🏗️ Building where clause for criteria:', criteria); // ADD THIS LINE
    
    const conditions: Prisma.MovieWhereInput[] = [];

    // Type filter
    if (criteria.type) {
      conditions.push({ type: criteria.type });
    }

    // Rating filters
    if (criteria.minRating !== undefined) {
      conditions.push({ avgRating: { gte: criteria.minRating } });
      console.log('🔍 Added min rating filter: avgRating >=', criteria.minRating); // ADD THIS
    }

    if (criteria.maxRating !== undefined) {
      conditions.push({ avgRating: { lte: criteria.maxRating } });
      console.log('🔍 Added max rating filter: avgRating <=', criteria.maxRating); // ADD THIS LINE
    }

    // Year filters
    if (criteria.afterYear) {
      const afterDate = new Date(`${criteria.afterYear}-01-01`);
      conditions.push({
        releaseDate: { gte: afterDate },
      });
      console.log('🔍 Added after year filter:', criteria.afterYear); // ADD THIS
    }

    // ... rest of your existing conditions ...

    const finalWhere = conditions.length > 0 ? { AND: conditions } : {};
    console.log('🎯 Final where clause:', JSON.stringify(finalWhere, null, 2)); // ADD THIS LINE
    
    return finalWhere;
  }

  /**
   * Enhanced name matching for better search results
   * Can be extended with fuzzy matching libraries like fuse.js
   */
  private createCaseInsensitivePattern(name: string): string {
    // Basic cleanup: trim and normalize spacing
    return name.trim().replace(/\s+/g, ' ');
  }

  /**
   * Method to test NLP parsing (useful for debugging)
   */
  async testNlpParsing(query: string): Promise<SearchCriteria> {
    console.log('Testing NLP parsing for query:', query);
    const criteria = this.queryParser.parseQuery(query);
    console.log('Parsed criteria:', criteria);
    return criteria;
  }
}