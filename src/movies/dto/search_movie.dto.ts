import { MovieType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class SearchMovieDTO {
    @IsOptional()
    @IsString()
    query?: string;

    @IsOptional()
    @IsEnum(MovieType)
    type?: MovieType = MovieType.MOVIE
    
    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    @IsNumber()
    @Min(0)
    page?: number = 0;

    @IsOptional()
    @Transform(({ value }) => parseInt(value))
    @IsNumber()
    @Min(1)
    limit?: number = 10;
}