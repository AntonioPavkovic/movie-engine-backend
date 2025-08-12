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

  // New method for frontend integration with 2-character minimum
  async searchMoviesWithMinLength(
    query: string, 
    page: number = 1, 
    limit: number = 20,
    type?: MovieType
  ): Promise<{
    movies: MovieSearchResult[];
    total: number;
    page: number;
    totalPages: number;
    filters: SearchFilters;
    suggestions?: string[];
  }> {
    // Frontend should enforce 2-character minimum, but add backend check
    if (query.trim().length < 2) {
      // Return default Top 10 for the selected type
      return this.getTopMoviesByType(type, page, limit);
    }
    
    return this.searchMovies(query, page, limit);
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
    
    const afterYearMatch = text.match(/after\s+(\d{4})/i);
    if (afterYearMatch) {
      filters.minYear = parseInt(afterYearMatch[1]);
    }
    
    // NEW: "older than X years" pattern
    const olderThanMatch = text.match(/older\s+than\s+(\d+)\s+years?/i);
    if (olderThanMatch) {
      const yearsAgo = parseInt(olderThanMatch[1]);
      const currentYear = new Date().getFullYear();
      filters.maxYear = currentYear - yearsAgo;
    }
    
    // Decade detection
    if (text.includes('devedesete') || text.includes('90s') || text.includes('1990s')) {
      filters.decade = '1990s';
    }
    if (text.includes('nulte') || text.includes('2000s')) {
      filters.decade = '2000s';
    }
    if (text.includes('2010s') || text.includes('2010')) {
      filters.decade = '2010s';
    }
    
    // Enhanced rating patterns
    const ratingPattern = /(\d+(?:\.\d+)?)\s*(?:stars?|\/5|zvjezdica|ocjena)/gi;
    const ratingMatch = text.match(ratingPattern);
    if (ratingMatch) {
      const rating = parseFloat(ratingMatch[0]);
      if (text.includes('iznad') || text.includes('više') || text.includes('above') || 
          text.includes('at least')) {
        filters.minRating = rating;
      } else if (text.includes('ispod') || text.includes('manje') || text.includes('below')) {
        filters.maxRating = rating;
      } else {
        filters.minRating = rating;
      }
    }
    
    // NEW: "at least X stars" pattern
    const atLeastMatch = text.match(/at\s+least\s+(\d+(?:\.\d+)?)\s*stars?/i);
    if (atLeastMatch) {
      filters.minRating = parseFloat(atLeastMatch[1]);
    }
    
    // Quality indicators
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
      aggs: {
        types: { 
          terms: { 
            field: 'type' // FIXED: Changed from 'type.keyword'
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
            field: 'averageRating', // FIXED: Changed from 'avgRating'
            interval: 0.5 
          } 
        }
      }
    };

    // Entity-based phrase matching
    analysis.entities.forEach(entity => {
      query.query.bool.should.push({
        multi_match: {
          query: entity,
          fields: ['title^10', 'cast^5'], // FIXED: Changed from 'cast.actorName^5'
          type: 'phrase',
          boost: 5
        }
      });
    });

    // Main multi-field search
    query.query.bool.should.push({
      multi_match: {
        query: originalQuery,
        fields: [
          'title^8',
          'description^3', 
          'cast^4' // FIXED: Changed from 'cast.actorName^4' and removed 'cast.role^2'
        ],
        type: 'best_fields',
        fuzziness: 'AUTO',
        minimum_should_match: '75%'
      }
    });

    // Keyword matching
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
    // Type filters
    if (filters.type && filters.type.length > 0) {
      query.query.bool.filter.push({
        terms: { 'type': filters.type } // FIXED: Changed from 'type.keyword'
      });
    }

    // Rating filters - FIXED FIELD NAMES
    if (filters.minRating) {
      query.query.bool.filter.push({
        range: { averageRating: { gte: filters.minRating } } // FIXED: Changed from avgRating
      });
    }
    if (filters.maxRating) {
      query.query.bool.filter.push({
        range: { averageRating: { lte: filters.maxRating } } // FIXED: Changed from avgRating
      });
    }

    if (filters.minRatingsCount) {
      query.query.bool.filter.push({
        range: { ratingCount: { gte: filters.minRatingsCount } } // FIXED: Changed from ratingsCount
      });
    }

    // Specific year filters
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

    // NEW: Min/Max year filters for "after" and "older than" patterns
    if (filters.minYear) {
      query.query.bool.filter.push({
        range: {
          releaseDate: { gte: `${filters.minYear}-01-01` }
        }
      });
    }
    
    if (filters.maxYear) {
      query.query.bool.filter.push({
        range: {
          releaseDate: { lte: `${filters.maxYear}-12-31` }
        }
      });
    }

    // Decade filters
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

    // Cast filters - FIXED
    if (filters.cast && filters.cast.length > 0) {
      query.query.bool.filter.push({
        terms: { 'cast': filters.cast } // FIXED: Changed from 'cast.actorName.keyword'
      });
    }
  }

  private addSorting(query: any, intent: string) {
    // FIXED: Always sort search results by rating using correct field names
    switch (intent) {
      case 'recommendation':
        query.sort.push({ averageRating: { order: 'desc' } }); // FIXED: Changed from avgRating
        query.sort.push({ ratingCount: { order: 'desc' } });   // FIXED: Changed from ratingsCount
        query.sort.push({ _score: { order: 'desc' } });
        break;
        
      case 'list':
        query.sort.push({ averageRating: { order: 'desc' } }); // FIXED: Changed from avgRating
        query.sort.push({ releaseDate: { order: 'desc' } });
        break;
        
      default:
        // For all searches, sort by rating as required
        query.sort.push({ averageRating: { order: 'desc' } }); // FIXED: Changed from avgRating
        query.sort.push({ _score: { order: 'desc' } });
        break;
    }
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
      avgRating: source.averageRating || 0, // FIXED: Map from averageRating to avgRating
      ratingsCount: source.ratingCount || 0, // FIXED: Map from ratingCount to ratingsCount
      cast: source.cast ? [{ actorName: source.cast }] : [], // FIXED: Handle cast as simple text
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
          averageRating: movie.avgRating,    // FIXED: Map to averageRating
          ratingCount: movie.ratingsCount,   // FIXED: Map to ratingCount
          cast: movie.casts.map(cast => cast.actor.name).join(', '), // FIXED: Store as text
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
              { range: { averageRating: { gte: 3.5 } } }, // FIXED: Changed from avgRating
              { range: { ratingCount: { gte: 5 } } }      // FIXED: Changed from ratingsCount
            ]
          }
        },
        sort: [
          { averageRating: { order: 'desc' } }, // FIXED: Changed from avgRating
          { ratingCount: { order: 'desc' } }    // FIXED: Changed from ratingsCount
        ]
      }
    });

    return response.body.hits.hits.map((hit: any) => this.formatMovieResult(hit));
  }

  // Enhanced getTopMovies to support type filtering for default view restoration
  async getTopMoviesByType(
    type?: MovieType, 
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
    const from = (page - 1) * limit;
    
    const queryBody: any = {
      from,
      size: limit,
      query: {
        bool: {
          filter: [
            { range: { averageRating: { gte: 3.5 } } }, // FIXED: Changed from avgRating
            { range: { ratingCount: { gte: 5 } } }      // FIXED: Changed from ratingsCount
          ]
        }
      },
      sort: [
        { averageRating: { order: 'desc' } }, // FIXED: Changed from avgRating
        { ratingCount: { order: 'desc' } }    // FIXED: Changed from ratingsCount
      ]
    };
    
    // Add type filter if specified (for tab-specific default view)
    if (type) {
      queryBody.query.bool.filter.push({
        term: { 'type': type } // FIXED: Changed from 'type.keyword'
      });
    }
    
    const response = await this.client.search({
      index: 'movies',
      body: queryBody
    });

    const hits = response.body.hits;
    const movies = hits.hits.map((hit: any) => this.formatMovieResult(hit));
    const total = typeof hits.total === 'number' ? hits.total : hits.total?.value || 0;

    return {
      movies,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      filters: type ? { type: [type] } : {},
      suggestions: []
    };
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
          term: { 'type': type } // FIXED: Changed from 'type.keyword'
        },
        sort: [{ averageRating: { order: 'desc' } }] // FIXED: Changed from avgRating
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
              id: { type: 'keyword' }, // Changed from integer to keyword
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
                type: 'keyword' // FIXED: Changed from text with keyword field to just keyword
              },
              averageRating: { type: 'float' }, // Match your sync method
              ratingCount: { type: 'integer' }, // Match your sync method
              cast: {
                type: 'text', // Simple text field for cast names
                analyzer: 'standard'
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