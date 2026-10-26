-- PostgreSQL limits regex repetition bounds; validate length separately.
ALTER TABLE "Scene" DROP CONSTRAINT "Scene_fogMask_valid";
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_fogMask_valid" CHECK ("fogMask" = '' OR (length("fogMask") = 4096 AND "fogMask" ~ '^[0-9a-f]+$'));
