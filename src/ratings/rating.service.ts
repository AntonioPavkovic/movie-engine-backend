import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { RatingDTO } from "./dto/rating.dto";

@Injectable()
export class RatingService {
    constructor(private prisma: PrismaService) {}

    async rateMovieTVShow(dto: RatingDTO) {
        const movie = await this.prisma.movie.findUnique({
            where: { id: dto.movieId },
        });

        if(!movie) {
            throw new NotFoundException("Movie not found");
        }

        await this.prisma.rating.create({
            data: {
                movie_id: dto.movieId,
                score: dto.score,
            },
        });

        const stats: { _avg: { score: number | null }, _count: { score: number } } =
        await this.prisma.rating.aggregate({
            where: { movie_id: dto.movieId },
            _avg: { score: true },
            _count: { score: true },
        }); 


        return {
            message: 'Rating submitted successfully',
            averageRating: Number(stats._avg.score?.toFixed(2) || 0),
            ratingsCount: stats._count.score,
        };
    }
}