import { MovieType } from 'src/common/enums/movie-types';
import { CastDTO } from '../../cast/dto/cast.dto';


export class MovieDetailDTO {
  id: string;
  title: string;
  description?: string | null;
  coverImageUrl?: string | null;
  releaseDate?: Date | null;
  type: MovieType;
  createdAt: Date;
  averageRating: number;
  ratingsCount: number;
  cast: CastDTO[];
}