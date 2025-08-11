import { CastDTO } from "src/cast/dto/cast.dto";
import { ContentType  } from "src/common/enums/movie-types";

export class TopMoviesDTO {
  id: string;
  title: string;
  description?: string | null;
  coverImageUrl?: string | null;
  releaseDate?: Date | null;
  type: ContentType ;
  averageRating: number;
  ratingsCount: number;
  cast: CastDTO[];
}