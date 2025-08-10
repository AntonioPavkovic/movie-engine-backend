-- CreateEnum
CREATE TYPE "public"."MovieType" AS ENUM ('MOVIE', 'TV_SHOW');

-- CreateTable
CREATE TABLE "public"."Movie" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "release_date" TIMESTAMP(3),
    "cover_image_url" TEXT,
    "type" "public"."MovieType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Cast" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Cast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MovieCast" (
    "movie_id" TEXT NOT NULL,
    "cast_id" TEXT NOT NULL,

    CONSTRAINT "MovieCast_pkey" PRIMARY KEY ("movie_id","cast_id")
);

-- CreateTable
CREATE TABLE "public"."Rating" (
    "id" TEXT NOT NULL,
    "movie_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."MovieCast" ADD CONSTRAINT "MovieCast_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "public"."Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovieCast" ADD CONSTRAINT "MovieCast_cast_id_fkey" FOREIGN KEY ("cast_id") REFERENCES "public"."Cast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Rating" ADD CONSTRAINT "Rating_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "public"."Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
