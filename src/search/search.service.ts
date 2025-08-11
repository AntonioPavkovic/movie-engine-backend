import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { ConfigService } from '@nestjs/config';
import { MovieType } from '@prisma/client'; 

export interface SearchQuery {
  textQuery?: string;
  minRating?: number;
  maxRating?: number;
  exactRating?: number;
  afterYear?: number;
  beforeYear?: number;
  olderThanYears?: number;
  newerThanYears?: number;
}

interface TermQuery {
  term: Record<string, any>;
}

interface MatchQuery {
  match: Record<string, any>;
}

interface RangeQuery {
  range: Record<string, any>;
}

type QueryClause = TermQuery | MatchQuery | RangeQuery;

interface BoolQuery {
  bool: {
    must?: QueryClause[];
    should?: QueryClause[];
    minimum_should_match?: number;
  };
}

interface SortField {
  [field: string]: {
    order: 'asc' | 'desc';
  };
}

interface SearchRequestBody {
  query: BoolQuery;
  sort: (SortField | { _score: { order: 'asc' | 'desc' } })[];
  from: number;
  size: number;
}

@Injectable()
export class SearchService {
  private readonly client: Client;
  private readonly logger = new Logger(SearchService.name);

  constructor(private configService: ConfigService) {
    this.client = new Client({
      node: this.configService.get('OPENSEARCH_URL', 'http://localhost:9200'),
      auth: {
        username: this.configService.get('OPENSEARCH_USERNAME', 'admin'),
        password: this.configService.get('OPENSEARCH_PASSWORD', 'admin'),
      },
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  async createIndex() {
    const indexName = 'movies';
    try {
      const exists = await this.client.indices.exists({ index: indexName });
      if (exists.body) {
        return;
      }

      await this.client.indices.create({
        index: indexName,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              title: { 
                type: 'text',
                analyzer: 'standard',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              description: { 
                type: 'text',
                analyzer: 'standard'
              },
              cast: { 
                type: 'text',
                analyzer: 'standard'
              },
              type: { type: 'keyword' },
              releaseDate: { type: 'date' },
              averageRating: { type: 'float' },
              ratingCount: { type: 'integer' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' }
            }
          }
        }
      });
      
      this.logger.log('Movies index created successfully');
    } catch (error) {
      this.logger.error('Error creating index:', error);
    }
  }

  parseSearchQuery(query: string): SearchQuery {
    const parsed: SearchQuery = {};
    
    let remainingQuery = query.toLowerCase().trim();

    const ratingPatterns = [
      { pattern: /(\d+(?:\.\d+)?)\s*stars?/g, type: 'exact' },
      { pattern: /(?:at least|minimum|min)\s*(\d+(?:\.\d+)?)\s*stars?/g, type: 'min' },
      { pattern: /(?:more than|above|over)\s*(\d+(?:\.\d+)?)\s*stars?/g, type: 'min' },
      { pattern: /(?:less than|below|under)\s*(\d+(?:\.\d+)?)\s*stars?/g, type: 'max' },
      { pattern: /(?:up to|maximum|max)\s*(\d+(?:\.\d+)?)\s*stars?/g, type: 'max' }
    ];

    ratingPatterns.forEach(({ pattern, type }) => {
      const matches = remainingQuery.match(pattern);
      if (matches) {
        pattern.lastIndex = 0;
        const ratingMatch = pattern.exec(remainingQuery);
        if (ratingMatch) {
          const rating = parseFloat(ratingMatch[1]);
          if (type === 'exact') parsed.exactRating = rating;
          else if (type === 'min') parsed.minRating = rating;
          else if (type === 'max') parsed.maxRating = rating;
          remainingQuery = remainingQuery.replace(ratingMatch[0], '').trim();
        }
      }
    });

    const yearPatterns = [
      // "after 2015", "since 2015", "from 2015"
      { pattern: /(?:after|since|from)\s*(\d{4})/g, type: 'after' },
      // "before 2015", "until 2015"
      { pattern: /(?:before|until)\s*(\d{4})/g, type: 'before' },
      // "in 2015"
      { pattern: /in\s*(\d{4})/g, type: 'exact' },
      // "older than 5 years"
      { pattern: /older than\s*(\d+)\s*years?/g, type: 'older' },
      // "newer than 5 years", "less than 5 years old"
      { pattern: /(?:newer than|less than)\s*(\d+)\s*years?(?:\s*old)?/g, type: 'newer' }
    ];

    yearPatterns.forEach(({ pattern, type }) => {
      const matches = remainingQuery.match(pattern);
      if (matches) {
        pattern.lastIndex = 0;
        const yearMatch = pattern.exec(remainingQuery);
        if (yearMatch) {
          const value = parseInt(yearMatch[1]);
          const currentYear = new Date().getFullYear();
          
          if (type === 'after') parsed.afterYear = value;
          else if (type === 'before') parsed.beforeYear = value;
          else if (type === 'exact') {
            parsed.afterYear = value;
            parsed.beforeYear = value + 1;
          }
          else if (type === 'older') parsed.beforeYear = currentYear - value;
          else if (type === 'newer') parsed.afterYear = currentYear - value;
          
          remainingQuery = remainingQuery.replace(yearMatch[0], '').trim();
        }
      }
    });

    if (remainingQuery && remainingQuery.length > 0) {
      parsed.textQuery = remainingQuery;
    }

    return parsed;
  }

  async searchMovies(
    query: string, 
    type: MovieType,
    page: number = 0, 
    limit: number = 10
  ) {
    try {
      const parsedQuery = this.parseSearchQuery(query);
      
      const mustClauses: QueryClause[] = [];
      const shouldClauses: QueryClause[] = [];

      mustClauses.push({ 
        term: { 
          type: type 
        } 
      });

      if (parsedQuery.textQuery) {
        shouldClauses.push(
          { match: { title: { query: parsedQuery.textQuery, boost: 3 } } },
          { match: { description: { query: parsedQuery.textQuery, boost: 2 } } },
          { match: { cast: { query: parsedQuery.textQuery, boost: 1.5 } } }
        );
      }

      if (parsedQuery.exactRating !== undefined) {
        mustClauses.push({
          range: {
            averageRating: {
              gte: parsedQuery.exactRating,
              lt: parsedQuery.exactRating + 1
            }
          }
        });
      } else {
        if (parsedQuery.minRating !== undefined) {
          mustClauses.push({
            range: { 
              averageRating: { 
                gte: parsedQuery.minRating 
              } 
            }
          });
        }
        if (parsedQuery.maxRating !== undefined) {
          mustClauses.push({
            range: { 
              averageRating: { 
                lte: parsedQuery.maxRating 
              } 
            }
          });
        }
      }

      if (parsedQuery.afterYear !== undefined) {
        mustClauses.push({
          range: { 
            releaseDate: { 
              gte: `${parsedQuery.afterYear}-01-01` 
            } 
          }
        });
      }
      if (parsedQuery.beforeYear !== undefined) {
        mustClauses.push({
          range: { 
            releaseDate: { 
              lt: `${parsedQuery.beforeYear}-01-01` 
            } 
          }
        });
      }

      const searchBody: SearchRequestBody = {
        query: {
          bool: {
            must: mustClauses,
            ...(shouldClauses.length > 0 && { 
              should: shouldClauses,
              minimum_should_match: 1 
            })
          }
        },
        sort: [
          { averageRating: { order: 'desc' } },
          { ratingCount: { order: 'desc' } },
          { _score: { order: 'desc' } }
        ],
        from: page * limit,
        size: limit
      };

      this.logger.debug('Search query:', JSON.stringify(searchBody, null, 2));

      const response = await this.client.search({
        index: 'movies',
        body: searchBody
      });

      const totalHits = response.body.hits.total;
      const total = typeof totalHits === 'number' 
        ? totalHits 
        : totalHits?.value || 0;

      return {
        hits: response.body.hits.hits.map((hit: any) => ({
          ...hit._source,
          score: hit._score
        })),
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error('Search error:', error);
      throw error;
    }
  }

  async indexMovie(movie: any) {
    try {
      await this.client.index({
        index: 'movies',
        id: movie.id.toString(),
        body: {
          id: movie.id,
          title: movie.title,
          description: movie.description,
          cast: Array.isArray(movie.cast) ? movie.cast.join(' ') : movie.cast,
          type: movie.type,
          releaseDate: movie.releaseDate,
          averageRating: movie.averageRating || 0,
          ratingCount: movie.ratingCount || 0,
          createdAt: movie.createdAt,
          updatedAt: movie.updatedAt
        }
      });
    } catch (error) {
      this.logger.error('Error indexing movie:', error);
    }
  }

  async updateMovieRating(movieId: string, averageRating: number, ratingCount: number) {
    try {
      await this.client.update({
        index: 'movies',
        id: movieId,
        body: {
          doc: {
            averageRating,
            ratingCount
          }
        }
      });
    } catch (error) {
      this.logger.error('Error updating movie rating:', error);
    }
  }

  async deleteMovie(movieId: string) {
    try {
      await this.client.delete({
        index: 'movies',
        id: movieId
      });
    } catch (error) {
      this.logger.error('Error deleting movie:', error);
    }
  }

  async bulkIndexMovies(movies: any[]) {
    if (movies.length === 0) return;

    try {
      const body = movies.flatMap(movie => [
        { 
          index: { 
            _index: 'movies', 
            _id: movie.id.toString() 
          } 
        },
        {
          id: movie.id,
          title: movie.title,
          description: movie.description,
          cast: Array.isArray(movie.cast) ? movie.cast.join(' ') : movie.cast,
          type: movie.type.toUpperCase(),
          releaseDate: movie.releaseDate,
          averageRating: movie.averageRating || 0,
          ratingCount: movie.ratingCount || 0,
          createdAt: movie.createdAt,
          updatedAt: movie.updatedAt
        }
      ]);

      const response = await this.client.bulk({ body });
      
      if (response.body.errors) {
        this.logger.error('Bulk indexing errors:', response.body.items);
      } else {
        this.logger.log(`Successfully bulk indexed ${movies.length} movies`);
      }
    } catch (error) {
      this.logger.error('Bulk indexing error:', error);
    }
  }
}