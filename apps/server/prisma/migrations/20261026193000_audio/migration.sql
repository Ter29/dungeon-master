-- CreateEnum
CREATE TYPE "AudioCategory" AS ENUM ('MUSIC', 'AMBIENCE', 'SFX');

-- CreateEnum
CREATE TYPE "AudioStatus" AS ENUM ('PLAYING', 'PAUSED', 'STOPPED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "audioVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AudioAsset" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "category" "AudioCategory" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "format" VARCHAR(4) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioChannel" (
    "campaignId" UUID NOT NULL,
    "key" VARCHAR(24) NOT NULL,
    "assetId" UUID,
    "status" "AudioStatus" NOT NULL DEFAULT 'STOPPED',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "loop" BOOLEAN NOT NULL DEFAULT true,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fadeFrom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fadeTo" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fadeAt" TIMESTAMPTZ(3),
    "fadeMs" INTEGER NOT NULL DEFAULT 0,
    "outgoingAssetId" UUID,
    "outgoingPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outgoingStartedAt" TIMESTAMPTZ(3),
    "outgoingLoop" BOOLEAN NOT NULL DEFAULT false,
    "outgoingGain" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "AudioChannel_pkey" PRIMARY KEY ("campaignId","key")
);

-- CreateTable
CREATE TABLE "AudioCue" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AudioCue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudioAsset_storageKey_key" ON "AudioAsset"("storageKey");

-- CreateIndex
CREATE INDEX "AudioAsset_campaignId_idx" ON "AudioAsset"("campaignId");

-- CreateIndex
CREATE INDEX "AudioAsset_deletedAt_idx" ON "AudioAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "AudioCue_campaignId_createdAt_idx" ON "AudioCue"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioCue_expiresAt_idx" ON "AudioCue"("expiresAt");

-- AddForeignKey
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioChannel" ADD CONSTRAINT "AudioChannel_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioChannel" ADD CONSTRAINT "AudioChannel_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AudioAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioChannel" ADD CONSTRAINT "AudioChannel_outgoingAssetId_fkey" FOREIGN KEY ("outgoingAssetId") REFERENCES "AudioAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioCue" ADD CONSTRAINT "AudioCue_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioCue" ADD CONSTRAINT "AudioCue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AudioAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_audioVersion_bound" CHECK ("audioVersion" >= 0);
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_bounds" CHECK ("byteSize" > 0 AND duration > 0 AND duration < 7201 AND revision >= 0);
ALTER TABLE "AudioChannel" ADD CONSTRAINT "AudioChannel_bounds" CHECK (key IN ('MUSIC','AMBIENCE') AND position >= 0 AND volume BETWEEN 0 AND 1 AND "fadeFrom" BETWEEN 0 AND 1 AND "fadeTo" BETWEEN 0 AND 1 AND "fadeMs" BETWEEN 0 AND 15000);
