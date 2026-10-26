-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "fogMask" VARCHAR(4096) NOT NULL DEFAULT '',
ADD COLUMN     "fogRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_fogMask_valid" CHECK ("fogMask" = '' OR "fogMask" ~ '^[0-9a-f]{4096}$'), ADD CONSTRAINT "Scene_fogRevision_valid" CHECK ("fogRevision" >= 0);
