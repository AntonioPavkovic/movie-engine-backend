import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
  IsUrl,
} from 'class-validator';
import { MovieType } from 'src/common/enums/movie-types';


export class MovieCreateDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  releaseDate?: string;

  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;

  @IsEnum(MovieType)
  type: MovieType;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  castNames?: string[];
}