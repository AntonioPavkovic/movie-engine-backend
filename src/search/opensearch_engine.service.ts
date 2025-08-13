// src/search/opensearch_engine.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { ConfigService } from '@nestjs/config';
import { MovieType } from '@prisma/client';
import { QueryParserService } from './services/query-parser.service';
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
    console.log('🔍 OpenSearchEngine query:', { query, type, page, limit });

    try {
      const offset = (page - 1) * limit;
      let searchBody: any;

      if (query && query.trim().length >= 2) {
        // Parse NLP query
        const criteria = this.queryParser.parseQuery(query.trim());
        console.log('📝 Parsed criteria:', criteria);
        
        searchBody = this.buildOpenSearchQuery(criteria, type);
      } else {
        // Default query for top rated
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

      console.log(`📊 OpenSearch results: ${hits.length} hits, ${total} total`);

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
    limit: number = 10,
  ): Promise<SearchResult> {
    console.log('🎬 Getting top rated movies from OpenSearch:', { type, limit });

    try {
      const searchBody = this.buildTopRatedQuery(type);

      const response = await this.client.search({
        index: this.indexName,
        body: {
          ...searchBody,
          from: 0,
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
        page: 1,
        totalPages: Math.ceil(total / limit),
      };

    } catch (error) {
      this.logger.error('OpenSearch top rated error:', error);
      throw new Error(`Failed to get top rated movies: ${error.message}`);
    }
  }


  private buildOpenSearchQuery(criteria: SearchCriteria, type?: MovieType) {
    const mustClauses: any[] = [];
    const shouldClauses: any[] = [];

    // Type filter
    if (type) {
      mustClauses.push({
        term: { type: type }
      });
    }

    // Rating filters
    if (criteria.minRating !== undefined) {
      mustClauses.push({
        range: {
          averageRating: { gte: criteria.minRating }
        }
      });
    }

    if (criteria.maxRating !== undefined) {
      mustClauses.push({
        range: {
          averageRating: { lte: criteria.maxRating }
        }
      });
    }

    // Year filters
    if (criteria.afterYear) {
      mustClauses.push({
        range: {
          releaseDate: { gte: `${criteria.afterYear}-01-01` }
        }
      });
    }

    if (criteria.beforeYear) {
      mustClauses.push({
        range: {
          releaseDate: { lt: `${criteria.beforeYear + 1}-01-01` }
        }
      });
    }

    // Age-based filters
    const currentYear = new Date().getFullYear();
    
    if (criteria.olderThanYears) {
      const cutoffYear = currentYear - criteria.olderThanYears;
      mustClauses.push({
        range: {
          releaseDate: { lt: `${cutoffYear}-01-01` }
        }
      });
    }

    if (criteria.newerThanYears) {
      const cutoffYear = currentYear - criteria.newerThanYears;
      mustClauses.push({
        range: {
          releaseDate: { gte: `${cutoffYear}-01-01` }
        }
      });
    }

    // Text search with boosting
    if (criteria.textQuery) {
      shouldClauses.push(
        {
          match: {
            title: {
              query: criteria.textQuery,
              boost: 3
            }
          }
        },
        {
          match: {
            description: {
              query: criteria.textQuery,
              boost: 2
            }
          }
        },
        {
          match: {
            cast: {
              query: criteria.textQuery,
              boost: 1.5
            }
          }
        }
      );
    }

    // Cast name search
    if (criteria.castNames?.length) {
      criteria.castNames.forEach(name => {
        shouldClauses.push({
          match: {
            cast: {
              query: name,
              boost: 2
            }
          }
        });
      });
    }

    const boolQuery: any = {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
      }
    };

    if (shouldClauses.length > 0) {
      boolQuery.bool.should = shouldClauses;
      boolQuery.bool.minimum_should_match = 1;
    }

    return {
      query: boolQuery,
      sort: [
        { averageRating: { order: 'desc' } },
        { ratingCount: { order: 'desc' } },
        { _score: { order: 'desc' } }
      ]
    };
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
    
    // Parse cast string back to array format
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
      coverUrl: undefined, // OpenSearch doesn't store cover URLs
      releaseDate: new Date(source.releaseDate),
      type: source.type,
      avgRating: source.averageRating || 0,
      ratingsCount: source.ratingCount || 0,
      casts,
    };
  }

  // Index management methods
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
      
      // Recreate the index with mapping
      await this.createIndex();
    } catch (error) {
      console.error('Error clearing index:', error);
      throw error;
    }
  }

  async getDocumentCount(): Promise<number> {
    try {
      const result = await this.client.count({
        index: this.indexName,
      });
      return result.body.count;
    } catch (error) {
      console.error('Error getting document count:', error);
      return 0;
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
  async updateMovieActors(movieId: number, actor: any): Promise<void> {
    try {
      // Get current document
      const current = await this.getMovieById(movieId);
      if (!current) return;

      // Update actors array
      if (!current.actors) {
        current.actors = [];
      }
      

      const existingActorIndex = current.actors.findIndex((a: any) => a.id === actor.id);
      if (existingActorIndex >= 0) {
        current.actors[existingActorIndex] = actor;
      } else {
        current.actors.push(actor);
      }

    
      await this.client.update({
        index: this.indexName,
        id: movieId.toString(),
        body: {
          doc: {
            actors: current.actors,
          },
        },
      });
    } catch (error) {
      console.error(`Error updating movie actors for ${movieId}:`, error);
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

  async getTotalDocuments(index: string): Promise<number> {
    try {
      const response = await this.client.count({ index });
      return response.body.count;
    } catch (error) {
      console.error(`Failed to count documents in ${index}:`, error);
      return 0;
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
      // Don't throw - rating update should not fail if search index update fails
    }
  }

  async deleteIndex() {
    try {
      await this.client.indices.delete({ index: this.indexName });
      this.logger.log('Index deleted successfully');
    } catch (error) {
      this.logger.error('Error deleting index:', error);
      throw error;
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