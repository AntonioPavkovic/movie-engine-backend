import { Type } from "class-transformer";
import { IsOptional, IsInt, Min, Max, IsEnum } from "class-validator";

export enum MediaType {
  MOVIE = 'MOVIE',
  TV_SHOW = 'TV_SHOW'
}

export class TopMoviesQueryDTO {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;
}