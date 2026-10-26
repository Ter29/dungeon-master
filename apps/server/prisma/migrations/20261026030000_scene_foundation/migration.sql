-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "activeLocationId" UUID,
ADD COLUMN     "locationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Scene" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(4000) NOT NULL DEFAULT '',
    "backgroundId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "format" VARCHAR(4) NOT NULL,
    "mimeType" VARCHAR(20) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Scene_backgroundId_key" ON "Scene"("backgroundId");

-- CreateIndex
CREATE INDEX "Scene_campaignId_idx" ON "Scene"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_storageKey_key" ON "MediaFile"("storageKey");

-- CreateIndex
CREATE INDEX "MediaFile_campaignId_idx" ON "MediaFile"("campaignId");

-- CreateIndex
CREATE INDEX "MediaFile_deletedAt_idx" ON "MediaFile"("deletedAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_activeLocationId_fkey" FOREIGN KEY ("activeLocationId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_backgroundId_fkey" FOREIGN KEY ("backgroundId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
