-- CreateEnum
CREATE TYPE "MapElementKind" AS ENUM ('NOTE', 'MARKER', 'LINE', 'ROUTE', 'CONTOUR', 'FRAGMENT');

-- CreateTable
CREATE TABLE "SharedMap" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(4000) NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL DEFAULT 2000,
    "height" INTEGER NOT NULL DEFAULT 1200,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "dataVersion" INTEGER NOT NULL DEFAULT 0,
    "backgroundId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SharedMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapFragment" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "issued" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "imageId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapFragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapElement" (
    "id" UUID NOT NULL,
    "mapId" UUID NOT NULL,
    "kind" "MapElementKind" NOT NULL,
    "text" VARCHAR(1000) NOT NULL DEFAULT '',
    "color" VARCHAR(7) NOT NULL DEFAULT '#242424',
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "points" JSONB NOT NULL DEFAULT '[]',
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "fragmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapElement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedMap_backgroundId_key" ON "SharedMap"("backgroundId");

-- CreateIndex
CREATE INDEX "SharedMap_campaignId_idx" ON "SharedMap"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MapFragment_imageId_key" ON "MapFragment"("imageId");

-- CreateIndex
CREATE INDEX "MapFragment_campaignId_idx" ON "MapFragment"("campaignId");

-- CreateIndex
CREATE INDEX "MapElement_mapId_idx" ON "MapElement"("mapId");

-- CreateIndex
CREATE INDEX "MapElement_fragmentId_idx" ON "MapElement"("fragmentId");

-- AddForeignKey
ALTER TABLE "SharedMap" ADD CONSTRAINT "SharedMap_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedMap" ADD CONSTRAINT "SharedMap_backgroundId_fkey" FOREIGN KEY ("backgroundId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapFragment" ADD CONSTRAINT "MapFragment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapFragment" ADD CONSTRAINT "MapFragment_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapElement" ADD CONSTRAINT "MapElement_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "SharedMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapElement" ADD CONSTRAINT "MapElement_fragmentId_fkey" FOREIGN KEY ("fragmentId") REFERENCES "MapFragment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedMap" ADD CONSTRAINT "SharedMap_dimensions" CHECK (width BETWEEN 100 AND 10000 AND height BETWEEN 100 AND 10000);
ALTER TABLE "MapElement" ADD CONSTRAINT "MapElement_points_bound" CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) <= 128), ADD CONSTRAINT "MapElement_fragment_kind" CHECK ((kind = 'FRAGMENT') = ("fragmentId" IS NOT NULL));
