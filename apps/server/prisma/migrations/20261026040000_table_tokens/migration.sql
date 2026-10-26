-- CreateEnum
CREATE TYPE "TokenKind" AS ENUM ('PLAYER', 'NPC', 'ENEMY');

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "gridOffsetX" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "gridOffsetY" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "gridSize" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN     "gridVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tableRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Token" (
    "id" UUID NOT NULL,
    "sceneId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "TokenKind" NOT NULL DEFAULT 'NPC',
    "x" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "size" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "hidden" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "imageId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Token_imageId_key" ON "Token"("imageId");

-- CreateIndex
CREATE INDEX "Token_sceneId_hidden_idx" ON "Token"("sceneId", "hidden");

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
