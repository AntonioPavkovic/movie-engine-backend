import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { ConfigService } from '@nestjs/config';
import { MovieType } from '@prisma/client';
import { QueryParserService } from './services/query_parser.service';
import { SearchResult, SearchCriteria, CleanMovie } from 'src/interfaces/search.interface';


interface OpenSearchMovie {
  id: number;
  title: string;
  description: string;
  cast: string;
  type: MovieType;
  releaseDate: string;
  averageRating: number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class OpenSearchEngineService {
  private readonly client: Client;
  private readonly logger = new Logger(OpenSearchEngineService.name);
  private readonly indexName = 'movies';

  constructor(
    private configService: ConfigService,
    private queryParser: QueryParserService,
  ) {
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

  async searchMovies(
    query?: string,
    type?: MovieType,
    page: number = 1,
    limit: number = 10,
  ): Promise<SearchResult> {

    try {
      const offset = (page - 1) * limit;
      let searchBody: any;

      if (query && query.trim().length >= 2) {
        const criteria = this.queryParser.parseQuery(query.trim());
        
        searchBody = this.buildOpenSearchQuery(criteria, type);
      } else {
        searchBody = this.buildTopRatedQuery(type);
      }

      console.log('🚀 OpenSearch query body:', JSON.stringify(searchBody, null, 2));

      const response = await this.client.search({
        index: this.indexName,
        body: {
          ...searchBody,
          from: offset,
          size: limit,
        },
      });

      const hits = response.body.hits.hits;
      const total = typeof response.body.hits.total === 'number' 
        ? response.body.hits.total 
        : response.body.hits.total?.value || 0;

      const movies = hits.map((hit: any) => this.transformOpenSearchHit(hit));

      return {
        movies,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };

    } catch (error) {
      this.logger.error('OpenSearch error:', error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  async getTopRatedMovies(
    type?: MovieType,
    page: number = 0,  
    limit: number = 10,
  ): Promise<SearchResult> {
    console.log('🎬 Getting top rated movies from OpenSearch:', { type, page, limit });

    try {
      const offset = Math.max(0, page) * limit; 
      const searchBody = this.buildTopRatedQuery(type);

      console.log('OpenSearch getTopRatedMovies offset/from:', offset);

      const response = await this.client.search({
        index: this.indexName,
        body: {
          ...searchBody,
          from: offset,
          size: limit,
        } as any,
      });

      const hits = response.body.hits.hits;
      const total = typeof response.body.hits.total === 'number'
        ? response.body.hits.total
        : response.body.hits.total?.value || 0;

      const movies = hits.map((hit: any) => this.transformOpenSearchHit(hit));

      return {
        movies,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };

    } catch (error) {
      this.logger.error('OpenSearch top rated error:', error);
      throw new Error(`Failed to get top rated movies: ${error.message}`);
    }
  }

// Replace your buildOpenSearchQuery method with this version that has detailed logging:

private buildOpenSearchQuery(criteria: SearchCriteria, type?: MovieType) {   
  console.log('🔨 === BUILDING OPENSEARCH QUERY ===');
  console.log('🔨 Input criteria:', JSON.stringify(criteria, null, 2));
  console.log('🔨 Type filter:', type);
  
  const mustClauses: any[] = [];
  console.log('📋 Initial mustClauses length:', mustClauses.length);
  
  if (type) {
    mustClauses.push({
      term: { type: type }
    });
    console.log('✅ Added type filter, mustClauses length:', mustClauses.length);
  }

  if (criteria.minRating !== undefined) {
    mustClauses.push({
      range: {
        averageRating: { gte: criteria.minRating }
      }
    });
    console.log('✅ Added min rating filter, mustClauses length:', mustClauses.length);
  }

  if (criteria.maxRating !== undefined) {
    mustClauses.push({
      range: {
        averageRating: { lte: criteria.maxRating }
      }
    });
    console.log('✅ Added max rating filter, mustClauses length:', mustClauses.length);
  }

  if (criteria.afterYear) {
    mustClauses.push({
      range: {
        releaseDate: { gte: `${criteria.afterYear}-01-01` }
      }
    });
    console.log('✅ Added after year filter, mustClauses length:', mustClauses.length);
  }

  if (criteria.beforeYear) {
    mustClauses.push({
      range: {
        releaseDate: { lt: `${criteria.beforeYear + 1}-01-01` }
      }
    });
    console.log('✅ Added before year filter, mustClauses length:', mustClauses.length);
  }

  const currentYear = new Date().getFullYear();
  
  if (criteria.olderThanYears) {
    const cutoffYear = currentYear - criteria.olderThanYears;
    mustClauses.push({
      range: {
        releaseDate: { lt: `${cutoffYear}-01-01` }
      }
    });
    console.log('✅ Added older than filter, mustClauses length:', mustClauses.length);
  }

  if (criteria.newerThanYears) {
    const cutoffYear = currentYear - criteria.newerThanYears;
    mustClauses.push({
      range: {
        releaseDate: { gte: `${cutoffYear}-01-01` }
      }
    });
    console.log('✅ Added newer than filter, mustClauses length:', mustClauses.length);
  }

  if (criteria.textQuery && criteria.textQuery.trim().length > 0) {
    const textQuery = criteria.textQuery.toLowerCase().trim();

    const textSearchQuery = {
      bool: {
        should: [
          {
            match_phrase: {
              title: {
                query: textQuery,
                boost: 10
              }
            }
          },
          
          {
            prefix: {
              title: {
                value: textQuery,
                boost: 8
              }
            }
          },
          
          {
            match_phrase: {
              description: {
                query: textQuery,
                boost: 7
              }
            }
          },

          {
            prefix: {
              description: {
                value: textQuery,
                boost: 5
              }
            }
          },

          {
            match_phrase: {
              cast: {
                query: textQuery,
                boost: 3
              }
            }
          },

          {
            prefix: {
              cast: {
                value: textQuery,
                boost: 2
              }
            }
          }
        ],
        minimum_should_match: 1
      }
    };
    
    
    mustClauses.push(textSearchQuery);

  }

  if (criteria.castNames && criteria.castNames.length > 0) {
    criteria.castNames.forEach(name => {
      mustClauses.push({
        match: {
          cast: {
            query: name,
            boost: 2,
            fuzziness: 'AUTO'
          }
        }
      });
    });
    }

    const boolQuery: any = {
      bool: {}
    };

    if (mustClauses.length > 0) {
      boolQuery.bool.must = mustClauses;
    } else {
      boolQuery.bool.must_not = [{ match_all: {} }];
    }

    const finalQuery = {
      query: boolQuery,
      sort: [
        { _score: { order: 'desc' } },       
        { averageRating: { order: 'desc' } },
        { ratingCount: { order: 'desc' } }  
      ]
    };
    
    return finalQuery;
  }

  private buildTopRatedQuery(type?: MovieType) {
    const mustClauses: any[] = [];

    if (type) {
      mustClauses.push({
        term: { type: type }
      });
    }

    return {
      query: {
        bool: {
          must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }]
        }
      },
      sort: [
        { averageRating: { order: 'desc' } },
        { ratingCount: { order: 'desc' } }
      ]
    };
  }

  private transformOpenSearchHit(hit: any): CleanMovie {
    const source = hit._source as OpenSearchMovie;
    const casts = source.cast 
      ? source.cast.split(' ').filter(name => name.trim()).map((name, index) => ({
          actor: { name: name.trim() },
          role: 'Actor'
        }))
      : [];

    return {
      id: source.id,
      title: source.title,
      description: source.description,
      coverUrl: undefined,
      releaseDate: new Date(source.releaseDate),
      type: source.type,
      avgRating: source.averageRating || 0,
      ratingsCount: source.ratingCount || 0,
      casts,
    };
  }

  async createIndex() {
    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (exists.body) {
        this.logger.log('Index already exists');
        return;
      }

      await this.client.indices.create({
        index: this.indexName,
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
      throw error;
    }
  }

  async clearIndex(): Promise<void> {
    try {
      await this.client.indices.delete({
        index: this.indexName,
        ignore_unavailable: true,
      });
      
      await this.createIndex();
    } catch (error) {
      console.error('Error clearing index:', error);
      throw error;
    }
  }

  async getMovieById(movieId: number): Promise<any> {
    try {
      const result = await this.client.get({
        index: this.indexName,
        id: movieId.toString(),
      });
      return result.body._source;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async indexMovie(movie: any) {
    try {
      await this.client.index({
        index: this.indexName,
        id: movie.id.toString(),
        body: {
          id: movie.id,
          title: movie.title,
          description: movie.description,
          cast: Array.isArray(movie.cast) ? movie.cast.join(' ') : movie.cast,
          type: movie.type,
          releaseDate: movie.releaseDate,
          averageRating: movie.avgRating || 0,
          ratingCount: movie.ratingsCount || 0,
          createdAt: movie.createdAt,
          updatedAt: movie.updatedAt
        }
      });
      
      this.logger.log(`Indexed movie: ${movie.title}`);
    } catch (error) {
      this.logger.error('Error indexing movie:', error);
      throw error;
    }
  }


  async bulkIndex(index: string, documents: any[]): Promise<void> {
    const body = documents.flatMap(doc => [
      { index: { _index: index, _id: doc.id } },
      doc
    ]);

    try {
      const response = await this.client.bulk({ body });
      
      if (response.body.errors) {
        const erroredDocuments = response.body.items.filter((item: any) => 
          item.index && item.index.error
        );
        console.error('Bulk indexing errors:', erroredDocuments);
        throw new Error(`Bulk indexing failed for ${erroredDocuments.length} documents`);
      }
      
      console.log(`Successfully indexed ${documents.length} documents to ${index}`);
    } catch (error) {
      console.error('Bulk indexing failed:', error);
      throw error;
    }
  }


  async bulkIndexMovies(movies: any[]) {
    if (movies.length === 0) return;

    try {
      const body = movies.flatMap(movie => [
        { 
          index: { 
            _index: this.indexName, 
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
          averageRating: movie.avgRating || 0,
          ratingCount: movie.ratingsCount || 0,
          createdAt: movie.createdAt,
          updatedAt: movie.updatedAt
        }
      ]);

      const response = await this.client.bulk({ body });
      
      if (response.body.errors) {
        this.logger.error('Bulk indexing errors:', response.body.items);
        throw new Error('Bulk indexing failed');
      } else {
        this.logger.log(`Successfully bulk indexed ${movies.length} movies`);
      }
    } catch (error) {
      this.logger.error('Bulk indexing error:', error);
      throw error;
    }
  }

  async updateMovieRating(movieId: number, avgRating: number, ratingsCount: number) {
    try {
      await this.client.update({
        index: this.indexName,
        id: movieId.toString(),
        body: {
          doc: {
            averageRating: avgRating,
            ratingCount: ratingsCount
          }
        }
      });
      
      this.logger.log(`Updated rating for movie ${movieId}`);
    } catch (error) {
      this.logger.error('Error updating movie rating:', error);
    }
  }

  async checkIndexExists() {
    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      return exists.body;
    } catch (error) {
      this.logger.error('Error checking index:', error);
      return false;
    }
  }
}