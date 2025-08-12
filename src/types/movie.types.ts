import { MovieType } from "@prisma/client";

export interface MovieSearchResult {
  id: number;
  title: string;
  description: string;
  coverUrl?: string;
  releaseDate: string;
  type: MovieType;
  avgRating: number;
  ratingsCount: number;
  cast: Array<{
    actorName: string;
    role?: string;
  }>;
  score?: number;
  highlights?: any;
}

export interface SearchFilters {
  type?: MovieType[];
  minRating?: number;
  maxRating?: number;
  year?: number[];
  decade?: string;
  cast?: string[];
  minRatingsCount?: number;
  minYear?: number;    
  maxYear?: number;    
}

export interface NLPAnalysis {
  entities: string[];
  keywords: string[];
  filters: SearchFilters;
  intent: 'search' | 'list' | 'filter' | 'recommendation';
  confidence: number;
}