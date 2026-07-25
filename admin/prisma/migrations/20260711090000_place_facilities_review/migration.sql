ALTER TABLE "Place" ADD COLUMN "hotWater" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Place" ADD COLUMN "toilet" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Place" ADD COLUMN "toiletType" TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE "ImportCandidate" ADD COLUMN "hotWater" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "ImportCandidate" ADD COLUMN "toilet" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "ImportCandidate" ADD COLUMN "toiletType" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "ImportCandidate" ADD COLUMN "matchedPlaceId" TEXT NOT NULL DEFAULT '';
