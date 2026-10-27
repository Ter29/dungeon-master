ALTER TYPE "DisplayMode" ADD VALUE 'VIDEO';
CREATE TABLE "VideoAsset" (
 "id" UUID NOT NULL, "campaignId" UUID NOT NULL, "name" VARCHAR(120) NOT NULL,
 "description" VARCHAR(2000) NOT NULL DEFAULT '', "storageKey" TEXT NOT NULL,
 "byteSize" INTEGER NOT NULL, "duration" DOUBLE PRECISION NOT NULL,
 "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "hasAudio" BOOLEAN NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 0, "deletedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "VideoAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VideoAsset_storageKey_key" ON "VideoAsset"("storageKey");
CREATE INDEX "VideoAsset_campaignId_idx" ON "VideoAsset"("campaignId");
CREATE INDEX "VideoAsset_deletedAt_idx" ON "VideoAsset"("deletedAt");
CREATE TABLE "VideoPlayback" (
 "campaignId" UUID NOT NULL, "assetId" UUID, "status" "AudioStatus" NOT NULL DEFAULT 'STOPPED',
 "position" DOUBLE PRECISION NOT NULL DEFAULT 0, "startedAt" TIMESTAMPTZ(3),
 "previousMode" "DisplayMode" NOT NULL DEFAULT 'TABLE', "previousMaterialId" UUID,
 "duckMusic" DOUBLE PRECISION NOT NULL DEFAULT 0.25, "duckAmbience" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
 CONSTRAINT "VideoPlayback_pkey" PRIMARY KEY ("campaignId"),
 CONSTRAINT "VideoPlayback_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "VideoPlayback_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "VideoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
