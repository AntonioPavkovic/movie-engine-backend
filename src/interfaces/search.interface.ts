import { MovieType } from "@prisma/client";

export interface SearchCriteria {
  textQuery?: string;
  minRating?: number;
  maxRating?: number;
  afterYear?: number;
  beforeYear?: number;
  olderThanYears?: number;
  newerThanYears?: number;
  castNames?: string[];
  type?: MovieType;
}

export type MovieWithCasts = {
  id: number;
  title: string;
  description: string;
  coverUrl: string | null;
  releaseDate: Date;
  type: MovieType;
  avgRating: number;
  ratingsCount: number;
  casts: Array<{
    id: number;
    movieId: number;
    actorId: number;
    role: string | null;
    actor: {
      name: string;
    };
  }>;
  createdAt: Date;
  updatedAt: Date;
};

// Clean interface for API responses
export interface CleanMovie {
  id: number;
  title: string;
  description: string;
  coverUrl?: string;
  releaseDate: Date;
  type: MovieType;
  avgRating: number;
  ratingsCount: number;
  casts: Array<{
    actor: {
      name: string;
    };
    role?: string;
  }>;
}

export interface SearchResult {
  movies: CleanMovie[];
  total: number;
  page: number;
  totalPages: number;
}
