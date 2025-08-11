export class RatingResponseDto {
  id: number;
  movieId: number;
  stars: number;
  createdAt: Date;
  sourceId?: string;
}