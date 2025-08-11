import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  movieId: number;

  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  sourceId?: string;
}