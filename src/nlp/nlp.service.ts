import { Injectable } from '@nestjs/common';

interface NLPResult {
  cleanQuery: string;
  extractedFilters: {
    type?: 'MOVIE' | 'TV_SHOW';
    year?: number;
    minRating?: number;
    genres?: string[];
  };
  searchIntent: 'search' | 'filter' | 'recommendation';
  boost: {
    title: number;
    description: number;
  };
}

@Injectable()
export class NLPService {
  
  processQuery(query: string): NLPResult {
    const lowerQuery = query.toLowerCase().trim();
    
    // Extract type filters
    let type: 'MOVIE' | 'TV_SHOW' | undefined;
    if (this.containsAny(lowerQuery, ['movie', 'film', 'cinema'])) {
      type = 'MOVIE';
    } else if (this.containsAny(lowerQuery, ['series', 'show', 'tv', 'serija'])) {
      type = 'TV_SHOW';
    }
    
    // Extract year
    const yearMatch = lowerQuery.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
    
    // Extract rating intent
    let minRating: number | undefined;
    if (this.containsAny(lowerQuery, ['best', 'top', 'excellent', 'najbolji'])) {
      minRating = 4.0;
    } else if (this.containsAny(lowerQuery, ['good', 'great', 'dobar'])) {
      minRating = 3.5;
    }
    
    // Extract genres
    const genreMap = {
      'action': ['action', 'akcijski'],
      'comedy': ['comedy', 'funny', 'komedija'],
      'drama': ['drama', 'dramatic'],
      'horror': ['horror', 'scary', 'horor'],
      'sci-fi': ['sci-fi', 'science fiction', 'futuristic'],
      'thriller': ['thriller', 'suspense', 'triler']
    };
    
    const genres: string[] = [];
    Object.entries(genreMap).forEach(([genre, keywords]) => {
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        genres.push(genre);
      }
    });
    
    // Determine search intent
    let searchIntent: 'search' | 'filter' | 'recommendation' = 'search';
    if (this.containsAny(lowerQuery, ['recommend', 'suggest', 'preporuči'])) {
      searchIntent = 'recommendation';
    } else if (minRating || year || type || genres.length > 0) {
      searchIntent = 'filter';
    }
    
    // Clean query (remove filter words)
    let cleanQuery = lowerQuery;
    const filterWords = ['movie', 'film', 'series', 'show', 'best', 'top', 'good', 'action', 'comedy', 'drama'];
    filterWords.forEach(word => {
      cleanQuery = cleanQuery.replace(new RegExp(`\\b${word}\\b`, 'gi'), '').trim();
    });
    cleanQuery = cleanQuery.replace(/\s+/g, ' ').trim();
    
    // Set boost based on intent
    const boost = searchIntent === 'recommendation' 
      ? { title: 3, description: 1 }
      : { title: 2, description: 1 };
    
    return {
      cleanQuery: cleanQuery || query, // fallback to original if empty
      extractedFilters: {
        type,
        year,
        minRating,
        genres: genres.length > 0 ? genres : undefined
      },
      searchIntent,
      boost
    };
  }
  
  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword));
  }
}