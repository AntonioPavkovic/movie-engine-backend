import { Injectable } from '@nestjs/common';

@Injectable()
export class QueryParserService {
  parseQuery(query: string): any {
    console.log('QueryParserService: Parsing query:', query);
    
    const criteria: any = {};
    let cleanedQuery = query;

    const normalizedQuery = this.normalizeQuery(query);
    console.log('Normalized query:', normalizedQuery);

    const afterMatch = normalizedQuery.match(/(?:after|since|from)\s+(\d{4})/i);
    if (afterMatch) {
      criteria.afterYear = parseInt(afterMatch[1]);
      cleanedQuery = cleanedQuery.replace(/(?:after|since|from)\s+\d{4}/i, '').trim();
    }

    const beforeMatch = normalizedQuery.match(/before\s+(\d{4})/i);
    if (beforeMatch) {
      criteria.beforeYear = parseInt(beforeMatch[1]);
      cleanedQuery = cleanedQuery.replace(/before\s+\d{4}/i, '').trim();
    }


    const olderMatch = normalizedQuery.match(/older\s+than\s+(\d+)\s*years?/i);
    if (olderMatch) {
      criteria.olderThanYears = parseInt(olderMatch[1]);
      cleanedQuery = cleanedQuery.replace(/older\s+than\s+\d+\s*years?/i, '').trim();
    }

    const newerMatch = normalizedQuery.match(/(?:newer\s+than|within\s+(?:the\s+)?last|in\s+the\s+past)\s+(\d+)\s*years?/i);
    if (newerMatch) {
      criteria.newerThanYears = parseInt(newerMatch[1]);
      cleanedQuery = cleanedQuery.replace(/(?:newer\s+than|within\s+(?:the\s+)?last|in\s+the\s+past)\s+\d+\s*years?/i, '').trim();
    }

    const lessThanPattern = /(?:less\s+than|under|below|maximum|max)\s+(\d+(?:\.\d+)?)\s*stars?/i;
    const maxStarsMatch = normalizedQuery.match(lessThanPattern);
    if (maxStarsMatch && maxStarsMatch[1]) {
      const stars = parseFloat(maxStarsMatch[1]);
      if (stars >= 1 && stars <= 5) {
        criteria.maxRating = stars - 0.01;
        cleanedQuery = cleanedQuery.replace(lessThanPattern, '').trim();
      }
    }
    
    else {
      const moreThanPattern = /(?:more\s+than|above|over)\s+(\d+(?:\.\d+)?)\s*stars?/i;
      const moreThanMatch = normalizedQuery.match(moreThanPattern);
      if (moreThanMatch && moreThanMatch[1]) {
        const stars = parseFloat(moreThanMatch[1]);
        if (stars >= 1 && stars <= 5) {
          criteria.minRating = stars + 0.01; 
          cleanedQuery = cleanedQuery.replace(moreThanPattern, '').trim();
        }
      }

      else {
        const atLeastPattern = /(?:at\s+least|minimum|min)\s+(\d+(?:\.\d+)?)\s*stars?/i;
        const atLeastMatch = normalizedQuery.match(atLeastPattern);
        if (atLeastMatch && atLeastMatch[1]) {
          const stars = parseFloat(atLeastMatch[1]);
          if (stars >= 1 && stars <= 5) {
            criteria.minRating = stars; 
            cleanedQuery = cleanedQuery.replace(atLeastPattern, '').trim();
          }
        }

        else {
          const atMostPattern = /(?:at\s+most|maximum\s+of|max\s+of)\s+(\d+(?:\.\d+)?)\s*stars?/i;
          const atMostMatch = normalizedQuery.match(atMostPattern);
          if (atMostMatch && atMostMatch[1]) {
            const stars = parseFloat(atMostMatch[1]);
            if (stars >= 1 && stars <= 5) {
              criteria.maxRating = stars;
              cleanedQuery = cleanedQuery.replace(atMostPattern, '').trim();
            }
          }
          
          else {
            const exactPattern = /(?:exactly\s+)?(\d+(?:\.\d+)?)\s*stars?/i;
            const exactMatch = normalizedQuery.match(exactPattern);
            if (exactMatch && exactMatch[1]) {
              const stars = parseFloat(exactMatch[1]);
              if (stars >= 1 && stars <= 5) {
                criteria.minRating = stars;
                criteria.maxRating = stars;
                cleanedQuery = cleanedQuery.replace(exactPattern, '').trim();
              }
            }
          }
        }
      }
    }

    cleanedQuery = cleanedQuery.replace(/\s+/g, ' ').trim();
    if (cleanedQuery && cleanedQuery.length >= 2) {
      criteria.textQuery = cleanedQuery;
    }

    return criteria;
  }


  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()

      .replace(/\bthen\b/g, 'than')
      .replace(/\bthand\b/g, 'than')
      .replace(/\bthna\b/g, 'than')
      .replace(/\btha\b(?!\w)/g, 'than')

      .replace(/\bs\s+stars?\b/g, 'stars')
      .replace(/\bstars?\s+s\b/g, 'stars')
      .replace(/\bstar\b/g, 'stars')
      .replace(/\bstrs?\b/g, 'stars')

      .replace(/\s+/g, ' ')
      .trim();
  }
}