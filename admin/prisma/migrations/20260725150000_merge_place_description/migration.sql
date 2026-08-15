UPDATE "Place" SET "description" = '';
UPDATE "ImportCandidate" SET "description" = '';

ALTER TABLE "Place" DROP COLUMN "facilities";
ALTER TABLE "Place" DROP COLUMN "hotWater";
ALTER TABLE "Place" DROP COLUMN "toilet";
ALTER TABLE "Place" DROP COLUMN "toiletType";

ALTER TABLE "ImportCandidate" DROP COLUMN "facilities";
ALTER TABLE "ImportCandidate" DROP COLUMN "hotWater";
ALTER TABLE "ImportCandidate" DROP COLUMN "toilet";
ALTER TABLE "ImportCandidate" DROP COLUMN "toiletType";

DROP TABLE IF EXISTS "AdminUser";
