-- CreateEnum
CREATE TYPE "DisplayMode" AS ENUM ('TABLE', 'ILLUSTRATION', 'PORTRAIT', 'BLANK');

-- CreateEnum
CREATE TYPE "PresentationCategory" AS ENUM ('LOCATION', 'NPC', 'EVENT');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "presentationMaterialId" UUID,
ADD COLUMN     "presentationMode" "DisplayMode" NOT NULL DEFAULT 'TABLE',
ADD COLUMN     "presentationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PresentationMaterial" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(4000) NOT NULL DEFAULT '',
    "category" "PresentationCategory" NOT NULL,
    "imageId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PresentationMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PresentationMaterial_imageId_key" ON "PresentationMaterial"("imageId");

-- CreateIndex
CREATE INDEX "PresentationMaterial_campaignId_idx" ON "PresentationMaterial"("campaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_presentationMaterialId_fkey" FOREIGN KEY ("presentationMaterialId") REFERENCES "PresentationMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationMaterial" ADD CONSTRAINT "PresentationMaterial_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentationMaterial" ADD CONSTRAINT "PresentationMaterial_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_presentationVersion_bound" CHECK ("presentationVersion" >= 0);
ALTER TABLE "PresentationMaterial" ADD CONSTRAINT "PresentationMaterial_revision_bound" CHECK (revision >= 0);
