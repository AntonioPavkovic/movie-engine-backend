import { Injectable } from '@nestjs/common';

@Injectable()
export class QueryParserService {
  parseQuery(query: string): any {
    console.log('QueryParserService: Parsing query:', query);
    
    const criteria: any = {};
    let cleanedQuery = query;

    // STEP 1: Normalize query to handle typos first
    const normalizedQuery = this.normalizeQuery(query);
    console.log('Normalized query:', normalizedQuery);

    // STEP 2: Parse year patterns FIRST
    
    // 1. After/Since/From year patterns
    const afterMatch = normalizedQuery.match(/(?:after|since|from)\s+(\d{4})/i);
    if (afterMatch) {
      criteria.afterYear = parseInt(afterMatch[1]);
      console.log('✅ FOUND after year:', criteria.afterYear);
      cleanedQuery = cleanedQuery.replace(/(?:after|since|from)\s+\d{4}/i, '').trim();
    }

    // 2. Before year patterns
    const beforeMatch = normalizedQuery.match(/before\s+(\d{4})/i);
    if (beforeMatch) {
      criteria.beforeYear = parseInt(beforeMatch[1]);
      console.log('✅ FOUND before year:', criteria.beforeYear);
      cleanedQuery = cleanedQuery.replace(/before\s+\d{4}/i, '').trim();
    }

    // STEP 3: Parse age-based patterns
    
    // 3. Older than X years
    const olderMatch = normalizedQuery.match(/older\s+than\s+(\d+)\s*years?/i);
    if (olderMatch) {
      criteria.olderThanYears = parseInt(olderMatch[1]);
      console.log('✅ FOUND older than years:', criteria.olderThanYears);
      cleanedQuery = cleanedQuery.replace(/older\s+than\s+\d+\s*years?/i, '').trim();
    }

    // 4. Newer than X years / within last X years
    const newerMatch = normalizedQuery.match(/(?:newer\s+than|within\s+(?:the\s+)?last|in\s+the\s+past)\s+(\d+)\s*years?/i);
    if (newerMatch) {
      criteria.newerThanYears = parseInt(newerMatch[1]);
      console.log('✅ FOUND newer than years:', criteria.newerThanYears);
      cleanedQuery = cleanedQuery.replace(/(?:newer\s+than|within\s+(?:the\s+)?last|in\s+the\s+past)\s+\d+\s*years?/i, '').trim();
    }

    // STEP 4: Parse rating patterns (FIXED - proper null checks and order)
    
    // 5. Less than / Below / Under (MUST come before exact stars)
    const lessThanPattern = /(?:less\s+than|under|below|maximum|max)\s+(\d+(?:\.\d+)?)\s*stars?/i;
    const maxStarsMatch = normalizedQuery.match(lessThanPattern);
    if (maxStarsMatch && maxStarsMatch[1]) {
      const stars = parseFloat(maxStarsMatch[1]);
      if (stars >= 1 && stars <= 5) {
        criteria.maxRating = stars - 0.01; // Exclusive
        console.log('✅ FOUND less than stars:', stars, '-> maxRating:', criteria.maxRating);
        cleanedQuery = cleanedQuery.replace(lessThanPattern, '').trim();
      }
    }
    
    // 6. More than / Above / Over
    else {
      const moreThanPattern = /(?:more\s+than|above|over)\s+(\d+(?:\.\d+)?)\s*stars?/i;
      const moreThanMatch = normalizedQuery.match(moreThanPattern);
      if (moreThanMatch && moreThanMatch[1]) {
        const stars = parseFloat(moreThanMatch[1]);
        if (stars >= 1 && stars <= 5) {
          criteria.minRating = stars + 0.01; // Exclusive
          console.log('✅ FOUND more than stars:', stars, '-> minRating:', criteria.minRating);
          cleanedQuery = cleanedQuery.replace(moreThanPattern, '').trim();
        }
      }
      
      // 7. At least / Minimum (inclusive)
      else {
        const atLeastPattern = /(?:at\s+least|minimum|min)\s+(\d+(?:\.\d+)?)\s*stars?/i;
        const atLeastMatch = normalizedQuery.match(atLeastPattern);
        if (atLeastMatch && atLeastMatch[1]) {
          const stars = parseFloat(atLeastMatch[1]);
          if (stars >= 1 && stars <= 5) {
            criteria.minRating = stars; // Inclusive
            console.log('✅ FOUND at least stars:', stars);
            cleanedQuery = cleanedQuery.replace(atLeastPattern, '').trim();
          }
        }
        
        // 8. At most / Maximum (inclusive)
        else {
          const atMostPattern = /(?:at\s+most|maximum\s+of|max\s+of)\s+(\d+(?:\.\d+)?)\s*stars?/i;
          const atMostMatch = normalizedQuery.match(atMostPattern);
          if (atMostMatch && atMostMatch[1]) {
            const stars = parseFloat(atMostMatch[1]);
            if (stars >= 1 && stars <= 5) {
              criteria.maxRating = stars; // Inclusive
              console.log('✅ FOUND at most stars:', stars);
              cleanedQuery = cleanedQuery.replace(atMostPattern, '').trim();
            }
          }
          
          // 9. Exact stars - ONLY if no other rating pattern was found
          else {
            const exactPattern = /(?:exactly\s+)?(\d+(?:\.\d+)?)\s*stars?/i;
            const exactMatch = normalizedQuery.match(exactPattern);
            if (exactMatch && exactMatch[1]) {
              const stars = parseFloat(exactMatch[1]);
              if (stars >= 1 && stars <= 5) {
                criteria.minRating = stars;
                criteria.maxRating = stars;
                console.log('✅ FOUND exact stars:', stars);
                cleanedQuery = cleanedQuery.replace(exactPattern, '').trim();
              }
            }
          }
        }
      }
    }

    // STEP 5: Clean up remaining text for search
    cleanedQuery = cleanedQuery.replace(/\s+/g, ' ').trim();
    if (cleanedQuery && cleanedQuery.length >= 2) {
      criteria.textQuery = cleanedQuery;
      console.log('✅ FOUND text query:', criteria.textQuery);
    }

    console.log('🎯 FINAL parsed criteria:', criteria);
    return criteria;
  }

  /**
   * Normalize query to handle common typos and variations
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      // Fix common "than" typos
      .replace(/\bthen\b/g, 'than')
      .replace(/\bthand\b/g, 'than')
      .replace(/\bthna\b/g, 'than')
      .replace(/\btha\b(?!\w)/g, 'than')
      // Fix "stars" variations
      .replace(/\bs\s+stars?\b/g, 'stars')
      .replace(/\bstars?\s+s\b/g, 'stars')
      .replace(/\bstar\b/g, 'stars')
      .replace(/\bstrs?\b/g, 'stars')
      // Fix spacing issues
      .replace(/\s+/g, ' ')
      .trim();
  }
}