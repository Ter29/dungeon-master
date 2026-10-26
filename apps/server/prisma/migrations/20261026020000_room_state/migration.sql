ALTER TABLE "Campaign" ADD COLUMN "roomState" JSONB NOT NULL DEFAULT '{"activeScene":"scene-1","positions":{"scene-1":{"x":50,"y":50},"scene-2":{"x":50,"y":50}}}';
