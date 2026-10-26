-- CreateEnum
CREATE TYPE "CombatStatus" AS ENUM ('PREPARING', 'ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "combatVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CombatEncounter" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "sceneId" UUID NOT NULL,
    "status" "CombatStatus" NOT NULL DEFAULT 'PREPARING',
    "round" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0,
    "manualOrder" BOOLEAN NOT NULL DEFAULT false,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "currentParticipantId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CombatEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatParticipant" (
    "id" UUID NOT NULL,
    "encounterId" UUID NOT NULL,
    "tokenId" UUID NOT NULL,
    "initiative" INTEGER NOT NULL DEFAULT 0,
    "joinOrder" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CombatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CombatEncounter_currentParticipantId_key" ON "CombatEncounter"("currentParticipantId");

-- CreateIndex
CREATE INDEX "CombatEncounter_campaignId_status_idx" ON "CombatEncounter"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CombatEncounter_sceneId_idx" ON "CombatEncounter"("sceneId");

-- CreateIndex
CREATE INDEX "CombatParticipant_encounterId_position_idx" ON "CombatParticipant"("encounterId", "position");

-- CreateIndex
CREATE INDEX "CombatParticipant_tokenId_idx" ON "CombatParticipant"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "CombatParticipant_encounterId_tokenId_key" ON "CombatParticipant"("encounterId", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "CombatParticipant_encounterId_joinOrder_key" ON "CombatParticipant"("encounterId", "joinOrder");

-- AddForeignKey
ALTER TABLE "CombatEncounter" ADD CONSTRAINT "CombatEncounter_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEncounter" ADD CONSTRAINT "CombatEncounter_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEncounter" ADD CONSTRAINT "CombatEncounter_currentParticipantId_fkey" FOREIGN KEY ("currentParticipantId") REFERENCES "CombatParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- At most one preparing/active encounter per campaign, including concurrent writers.
CREATE UNIQUE INDEX "CombatEncounter_one_open_per_campaign" ON "CombatEncounter"("campaignId") WHERE "status" IN ('PREPARING','ACTIVE');
ALTER TABLE "CombatEncounter" ADD CONSTRAINT "CombatEncounter_round_bound" CHECK (round BETWEEN 1 AND 1000000), ADD CONSTRAINT "CombatEncounter_version_bound" CHECK (version >= 0 AND "nextSequence" >= 0);
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_initiative_bound" CHECK (initiative BETWEEN -1000 AND 1000), ADD CONSTRAINT "CombatParticipant_order_bound" CHECK (position >= 0 AND "joinOrder" >= 0);
