import { IsInt, IsUUID, Max, Min } from "class-validator";

export class RatingDTO {
    @IsUUID()
    movieId: string;
    
    @IsInt()
    @Min(1)
    @Max(5)
    score: number;
}