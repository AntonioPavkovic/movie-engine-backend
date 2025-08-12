import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { MovieType } from '@prisma/client';
import { MovieSearchResult, NLPAnalysis, SearchFilters } from 'src/types/movie.types';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class OpenSearchService {
  private readonly logger = new Logger(OpenSearchService.name);
  private client: Client;

  constructor(private prisma: PrismaService) {
    this.client = new Client({
      node: process.env.OPENSEARCH_URL || 'https://localhost:9200',
      auth: {
        username: process.env.OPENSEARCH_USERNAME || 'admin',
        password: process.env.OPENSEARCH_PASSWORD || 'admin',
      },
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  async searchMovies(
    query: string, 
    page: number = 1, 
    limit: number = 20
  ): Promise<{
    movies: MovieSearchResult[];
    total: number;
    page: number;
    totalPages: number;
    filters: SearchFilters;
    suggestions?: string[];
  }> {
    try {
      const nlpAnalysis = this.analyzeQuery(query);
      this.logger.debug(`NLP Analysis: ${JSON.stringify(nlpAnalysis)}`);

      const searchQuery = this.buildSearchQuery(query, nlpAnalysis, page, limit);
      
      const response = await this.client.search({
        index: 'movies',
        body: searchQuery,
      });

      const hits = response.body.hits;
      const movies = hits.hits.map((hit: any) => this.formatMovieResult(hit));
      
      let suggestions: string[] = [];
      const total = typeof hits.total === 'number' ? hits.total : hits.total?.value || 0;
      
      if (total === 0) {
        suggestions = await this.generateSuggestions(query);
      }

      return {
        movies,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        filters: nlpAnalysis.filters,
        suggestions
      };

    } catch (error: any) {
      this.logger.error(`Search error: ${error.message}`);
      throw error;
    }
  }

  private analyzeQuery(query: string): NLPAnalysis {
    const text = query.toLowerCase();
    
    const entities = this.extractEntities(query, text);
    
    const keywords = this.extractKeywords(text);
    
    const filters = this.extractFiltersFromNL(text);
    
    const intent = this.detectIntent(text);
    
    const confidence = this.calculateConfidence(entities, keywords, filters);

    return { entities, keywords, filters, intent, confidence };
  }

  private extractEntities(originalQuery: string, text: string): string[] {
    const entities: string[] = [];
    
    const compoundTerms = this.extractCompoundTerms(originalQuery);
    entities.push(...compoundTerms);
    
    const quoted = originalQuery.match(/"([^"]+)"/g) || [];
    entities.push(...quoted.map(q => q.replace(/"/g, '')));
    
    return [...new Set(entities)].filter(e => e.length > 1);
  }

  private extractCompoundTerms(text: string): string[] {
    const words = text.split(/\s+/);
    const compounds: string[] = [];
    let current: string[] = [];
    
    for (const word of words) {
      if (word.match(/^[A-Z][a-z]*/) || word.match(/^[A-Z]+$/)) {
        current.push(word);
      } else {
        if (current.length >= 2) {
          compounds.push(current.join(' '));
        }
        current = [];
      }
    }
    
    if (current.length >= 2) {
      compounds.push(current.join(' '));
    }
    
    return compounds;
  }

  private extractFiltersFromNL(text: string): SearchFilters {
    const filters: SearchFilters = {};
    
    if (text.includes('film') || text.includes('movie') || text.includes('cinema')) {
      filters.type = [MovieType.MOVIE];
    }
    if (text.includes('serija') || text.includes('series') || text.includes('show') || 
        text.includes('sezona') || text.includes('epizoda')) {
      filters.type = [MovieType.TV_SHOW];
    }
    
    const yearMatches = text.match(/\b(19|20)\d{2}\b/g);
    if (yearMatches) {
      filters.year = yearMatches.map(y => parseInt(y));
    }
    
    if (text.includes('devedesete') || text.includes('90s') || text.includes('1990s')) {
      filters.decade = '1990s';
    }
    if (text.includes('nulte') || text.includes('2000s')) {
      filters.decade = '2000s';
    }
    if (text.includes('2010s') || text.includes('2010')) {
      filters.decade = '2010s';
    }
    
    const ratingPattern = /(\d+(?:\.\d+)?)\s*(?:stars?|\/5|zvjezdica|ocjena)/gi;
    const ratingMatch = text.match(ratingPattern);
    if (ratingMatch) {
      const rating = parseFloat(ratingMatch[0]);
      if (text.includes('iznad') || text.includes('više') || text.includes('above')) {
        filters.minRating = rating;
      } else if (text.includes('ispod') || text.includes('manje') || text.includes('below')) {
        filters.maxRating = rating;
      } else {
        filters.minRating = rating;
      }
    }
    
    if (text.includes('najbolji') || text.includes('top') || text.includes('odličan') || text.includes('excellent')) {
      filters.minRating = 4.0;
      filters.minRatingsCount = 10;
    }
    if (text.includes('dobar') || text.includes('kvalitetan') || text.includes('good')) {
      filters.minRating = 3.5;
    }
    if (text.includes('popularan') || text.includes('poznat') || text.includes('popular')) {
      filters.minRatingsCount = 50;
    }
    
    return filters;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'i', 'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'je', 'su', 'da', 'se', 'na', 'u', 'za', 'od', 'do', 'sa', 'iz', 'po', 'pre', 'preko'
    ]);
    
    const words = text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .map(word => word.toLowerCase())
      .filter(word => word.length > 2)
      .filter(word => !stopWords.has(word));
    
    return [...new Set(words)];
  }

  private detectIntent(text: string): 'search' | 'list' | 'filter' | 'recommendation' {
    if (text.includes('preporuči') || text.includes('preporučuje') || 
        text.includes('najbolji') || text.includes('top') || text.includes('suggest')) {
      return 'recommendation';
    }
    if (text.includes('lista') || text.includes('svi') || text.includes('all') || text.includes('list')) {
      return 'list';
    }
    if (text.includes('filter') || text.includes('traži') || text.includes('samo') || text.includes('only')) {
      return 'filter';
    }
    return 'search';
  }

  private calculateConfidence(entities: string[], keywords: string[], filters: SearchFilters): number {
    let confidence = 0.5;
    
    if (entities.length > 0) confidence += 0.3;
    if (keywords.length > 2) confidence += 0.1;
    if (Object.keys(filters).length > 0) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  private buildSearchQuery(originalQuery: string, analysis: NLPAnalysis, page: number, limit: number) {
    const from = (page - 1) * limit;
    
    const query: any = {
      from,
      size: limit,
      query: {
        bool: {
          should: [] as any[],
          filter: [] as any[],
          minimum_should_match: 1
        }
      },
      highlight: {
        fields: {
          title: { pre_tags: ['<mark>'], post_tags: ['</mark>'] },
          description: { pre_tags: ['<mark>'], post_tags: ['</mark>'] }
        }
      },
      sort: [] as any[],
     /* aggs: {
        types: { 
          terms: { 
            field: 'type.keyword' 
          } 
        },
        years: { 
          date_histogram: { 
            field: 'releaseDate', 
            calendar_interval: '1y' as any,
            format: 'yyyy'
          } 
        },
        ratings: { 
          histogram: { 
            field: 'avgRating', 
            interval: 0.5 
          } 
        }
      }*/
    };

    analysis.entities.forEach(entity => {
      query.query.bool.should.push({
        multi_match: {
          query: entity,
          fields: ['title^10', 'cast.actorName^5'],
          type: 'phrase',
          boost: 5
        }
      });
    });

    query.query.bool.should.push({
      multi_match: {
        query: originalQuery,
        fields: [
          'title^8',
          'description^3', 
          'cast.actorName^4',
          'cast.role^2'
        ],
        type: 'best_fields',
        fuzziness: 'AUTO',
        minimum_should_match: '75%'
      }
    });

    if (analysis.keywords.length > 0) {
      query.query.bool.should.push({
        terms: {
          'keywords': analysis.keywords,
          boost: 2
        }
      });
    }

    this.addFiltersToQuery(query, analysis.filters);

    this.addSorting(query, analysis.intent);

    return query;
  }

  private addFiltersToQuery(query: any, filters: SearchFilters) {
    if (filters.type && filters.type.length > 0) {
      query.query.bool.filter.push({
        terms: { 'type.keyword': filters.type }
      });
    }

    /*if (filters.minRating) {
      query.query.bool.filter.push({
        range: { avgRating: { gte: filters.minRating } }
      });
    }
    if (filters.maxRating) {
      query.query.bool.filter.push({
        range: { avgRating: { lte: filters.maxRating } }
      });
    }

    if (filters.minRatingsCount) {
      query.query.bool.filter.push({
        range: { ratingsCount: { gte: filters.minRatingsCount } }
      });
    }*/

    if (filters.year && filters.year.length > 0) {
      const yearRanges = filters.year.map(year => ({
        range: {
          releaseDate: {
            gte: `${year}-01-01`,
            lte: `${year}-12-31`
          }
        }
      }));
      
      query.query.bool.filter.push({
        bool: { should: yearRanges }
      });
    }

    if (filters.decade) {
      const decadeStart = parseInt(filters.decade.substring(0, 4));
      query.query.bool.filter.push({
        range: {
          releaseDate: {
            gte: `${decadeStart}-01-01`,
            lt: `${decadeStart + 10}-01-01`
          }
        }
      });
    }

/*    if (filters.cast && filters.cast.length > 0) {
      query.query.bool.filter.push({
        terms: { 'cast.actorName.keyword': filters.cast }
      });
    }*/
  }

  private addSorting(query: any, intent: string) {
    /*switch (intent) {
      case 'recommendation':
        query.sort.push({ avgRating: { order: 'desc' } });
        query.sort.push({ ratingsCount: { order: 'desc' } });
        query.sort.push({ _score: { order: 'desc' } });
        break;
        
      case 'list':
        query.sort.push({ releaseDate: { order: 'desc' } });
        query.sort.push({ avgRating: { order: 'desc' } });
        break;
        
      default:
        query.sort.push({ _score: { order: 'desc' } });
        query.sort.push({ avgRating: { order: 'desc' } });
        break;
    }*/
  }

  private formatMovieResult(hit: any): MovieSearchResult {
    const source = hit._source;
    return {
      id: source.id,
      title: source.title,
      description: source.description,
      coverUrl: source.coverUrl,
      releaseDate: source.releaseDate,
      type: source.type,
      avgRating: source.avgRating,
      ratingsCount: source.ratingsCount,
      cast: source.cast || [],
      score: hit._score,
      highlights: hit.highlight
    };
  }

  private async generateSuggestions(query: string): Promise<string[]> {
    try {
      const response = await this.client.search({
        index: 'movies',
        body: {
          suggest: {
            title_suggest: {
              text: query,
              term: {
                field: 'title.keyword',
                suggest_mode: 'popular',
                max_inspections: 500,
                max_term_freq: 0.01,
                min_doc_freq: 3
              }
            }
          }
        }
      });

      if (response.body.suggest && response.body.suggest.title_suggest && response.body.suggest.title_suggest[0]) {
        const suggestions = response.body.suggest.title_suggest[0].options;
        if (Array.isArray(suggestions)) {
          return suggestions
            .map((option: any) => option.text)
            .slice(0, 5);
        }
      }
      
      return [];
    } catch (error) {
      this.logger.error('Error generating suggestions:', error);
      return [];
    }
  }

  async syncMoviesToOpenSearch(): Promise<void> {
    try {
      this.logger.log('Starting sync to OpenSearch...');

      const movies = await this.prisma.movie.findMany({
        include: {
          casts: {
            include: {
              actor: true
            }
          }
        }
      });

      this.logger.log(`Found ${movies.length} movies to sync`);
      const body = movies.flatMap(movie => [
        { index: { _index: 'movies', _id: movie.id.toString() } },
        {
          id: movie.id,
          title: movie.title,
          description: movie.description,
          coverUrl: movie.coverUrl,
          releaseDate: movie.releaseDate.toISOString(),
          type: movie.type,
          avgRating: movie.avgRating,
          ratingsCount: movie.ratingsCount,
          cast: movie.casts.map(cast => ({
            actorName: cast.actor.name,
            role: cast.role
          })),
          keywords: this.generateKeywords(movie.title, movie.description),
          createdAt: movie.createdAt.toISOString(),
          updatedAt: movie.updatedAt.toISOString()
        }
      ]);

      if (body.length > 0) {
        const response = await this.client.bulk({ 
          body,
          refresh: true
        });

        if (response.body.errors) {
          this.logger.error('Bulk indexing errors:', response.body.items);
        } else {
          this.logger.log(`Successfully synced ${movies.length} movies to OpenSearch`);
        }
      }

    } catch (error: any) {
      this.logger.error('Error syncing to OpenSearch:', error.message);
      throw error;
    }
  }

  private generateKeywords(title: string, description: string): string[] {
    const text = `${title} ${description}`.toLowerCase();
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
    
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !stopWords.has(word))
      .slice(0, 20); 
  }


  async getTopMovies(limit: number = 20): Promise<MovieSearchResult[]> {
    const response = await this.client.search({
      index: 'movies',
      body: {
        size: limit,
        query: {
          bool: {
            filter: [
              { range: { avgRating: { gte: 3.5 } } },
              { range: { ratingsCount: { gte: 5 } } }
            ]
          }
        },
        sort: [
          { avgRating: { order: 'desc' } },
          { ratingsCount: { order: 'desc' } }
        ]
      }
    });

    return response.body.hits.hits.map((hit: any) => this.formatMovieResult(hit));
  }

  async getRecentMovies(limit: number = 20): Promise<MovieSearchResult[]> {
    const response = await this.client.search({
      index: 'movies',
      body: {
        size: limit,
        sort: [{ releaseDate: { order: 'desc' } }]
      }
    });

    return response.body.hits.hits.map((hit: any) => this.formatMovieResult(hit));
  }

  async getMoviesByType(type: MovieType, page: number = 1, limit: number = 20): Promise<{
    movies: MovieSearchResult[];
    total: number;
  }> {
    const from = (page - 1) * limit;
    
    const response = await this.client.search({
      index: 'movies',
      body: {
        from,
        size: limit,
        query: {
          term: { 'type.keyword': type }
        },
        sort: [{ avgRating: { order: 'desc' } }]
      }
    });

    const total = typeof response.body.hits.total === 'number' 
      ? response.body.hits.total 
      : response.body.hits.total?.value || 0;

    return {
      movies: response.body.hits.hits.map((hit: any) => this.formatMovieResult(hit)),
      total
    };
  }

    async createMoviesIndex(): Promise<void> {
        try {
            const indexExists = await this.client.indices.exists({ index: 'movies' });
            
            if (indexExists.body) {
            this.logger.log('Movies index already exists');
            return;
            }

            await this.client.indices.create({
            index: 'movies',
            body: {
                mappings: {
                properties: {
                    id: { type: 'integer' },
                    title: { 
                    type: 'text',
                    analyzer: 'standard',
                    fields: {
                        keyword: { type: 'keyword' }
                    }
                    },
                    description: { type: 'text', analyzer: 'standard' },
                    coverUrl: { type: 'keyword', index: false },
                    releaseDate: { type: 'date' },
                    type: { 
                    type: 'text',
                    fields: {
                        keyword: { type: 'keyword' }
                    }
                    },
                    avgRating: { type: 'float' },
                    ratingsCount: { type: 'integer' },
                    cast: {
                    type: 'nested',
                    properties: {
                        actorName: { 
                        type: 'text',
                        fields: {
                            keyword: { type: 'keyword' }
                        }
                        },
                        role: { type: 'text' }
                    }
                    },
                    keywords: { type: 'text' },
                    createdAt: { type: 'date' },
                    updatedAt: { type: 'date' }
                }
                },
                settings: {
                number_of_shards: 1,
                number_of_replicas: 0,
                analysis: {
                    analyzer: {
                    movie_analyzer: {
                        type: 'custom',
                        tokenizer: 'standard',
                        filter: ['lowercase', 'stop']
                    }
                    }
                }
                }
            }
            });

            this.logger.log('Movies index created successfully');
        } catch (error: any) {
            this.logger.error('Error creating movies index:', error.message);
            throw error;
        }
    }

    async deleteMoviesIndex(): Promise<void> {
        try {
            const indexExists = await this.client.indices.exists({ index: 'movies' });
            
            if (indexExists.body) {
            await this.client.indices.delete({ index: 'movies' });
            this.logger.log('Movies index deleted successfully');
            } else {
            this.logger.log('Movies index does not exist');
            }
        } catch (error: any) {
            this.logger.error('Error deleting movies index:', error.message);
            throw error;
        }
    }

    async checkIndexExists(): Promise<boolean> {
        try {
            const response = await this.client.indices.exists({ index: 'movies' });
            return response.body;
        } catch (error) {
            return false;
        }
    }

    async getIndexMapping(): Promise<any> {
        try {
            const mapping = await this.client.indices.getMapping({ index: 'movies' });
            return mapping.body;
        } catch (error: any) {
            this.logger.error('Error getting index mapping:', error.message);
            throw error;
        }
    }
}