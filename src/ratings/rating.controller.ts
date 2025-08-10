import { Body, Controller, Post } from "@nestjs/common";
import { RatingService } from "./rating.service";
import { RatingDTO } from "./dto/rating.dto";

@Controller('ratings')
export class RatingController {
    constructor(private readonly ratingService: RatingService) {}

    @Post()
    async rateMovieTVShow(@Body() dto: RatingDTO) {
        return this.ratingService.rateMovieTVShow(dto);
    }
}