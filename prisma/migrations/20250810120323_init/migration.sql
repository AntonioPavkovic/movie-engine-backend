/*
  Warnings:

  - The primary key for the `Movie` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `cover_image_url` on the `Movie` table. All the data in the column will be lost.
  - You are about to drop the column `created_at` on the `Movie` table. All the data in the column will be lost.
  - You are about to drop the column `release_date` on the `Movie` table. All the data in the column will be lost.
  - The `id` column on the `Movie` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `MovieCast` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `cast_id` on the `MovieCast` table. All the data in the column will be lost.
  - You are about to drop the column `movie_id` on the `MovieCast` table. All the data in the column will be lost.
  - The primary key for the `Rating` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `created_at` on the `Rating` table. All the data in the column will be lost.
  - You are about to drop the column `movie_id` on the `Rating` table. All the data in the column will be lost.
  - You are about to drop the column `score` on the `Rating` table. All the data in the column will be lost.
  - The `id` column on the `Rating` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Cast` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `releaseDate` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Movie` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `Movie` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `actorId` to the `MovieCast` table without a default value. This is not possible if the table is not empty.
  - Added the required column `movieId` to the `MovieCast` table without a default value. This is not possible if the table is not empty.
  - Added the required column `movieId` to the `Rating` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stars` to the `Rating` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."MovieCast" DROP CONSTRAINT "MovieCast_cast_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."MovieCast" DROP CONSTRAINT "MovieCast_movie_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."Rating" DROP CONSTRAINT "Rating_movie_id_fkey";

-- AlterTable
ALTER TABLE "public"."Movie" DROP CONSTRAINT "Movie_pkey",
DROP COLUMN "cover_image_url",
DROP COLUMN "created_at",
DROP COLUMN "release_date",
ADD COLUMN     "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ratingsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "releaseDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ALTER COLUMN "description" SET NOT NULL,
ADD CONSTRAINT "Movie_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."MovieCast" DROP CONSTRAINT "MovieCast_pkey",
DROP COLUMN "cast_id",
DROP COLUMN "movie_id",
ADD COLUMN     "actorId" INTEGER NOT NULL,
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "movieId" INTEGER NOT NULL,
ADD COLUMN     "role" TEXT,
ADD CONSTRAINT "MovieCast_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."Rating" DROP CONSTRAINT "Rating_pkey",
DROP COLUMN "created_at",
DROP COLUMN "movie_id",
DROP COLUMN "score",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "movieId" INTEGER NOT NULL,
ADD COLUMN     "stars" INTEGER NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Rating_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "public"."Cast";

-- CreateTable
CREATE TABLE "public"."Actor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."MovieCast" ADD CONSTRAINT "MovieCast_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "public"."Movie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovieCast" ADD CONSTRAINT "MovieCast_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Rating" ADD CONSTRAINT "Rating_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "public"."Movie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
