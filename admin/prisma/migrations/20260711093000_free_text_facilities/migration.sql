ALTER TABLE "Place" ADD COLUMN "facilities" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ImportCandidate" ADD COLUMN "facilities" TEXT NOT NULL DEFAULT '';

UPDATE "Place"
SET "facilities" = TRIM(
  CASE WHEN "hotWater" = 'yes' THEN '有开水；' WHEN "hotWater" = 'no' THEN '无开水；' ELSE '' END ||
  CASE WHEN "toilet" = 'yes' THEN '有厕所；' WHEN "toilet" = 'no' THEN '无厕所；' ELSE '' END ||
  CASE WHEN "toiletType" = 'squat' THEN '厕所为蹲坑；' WHEN "toiletType" = 'seat' THEN '厕所为坐便；' WHEN "toiletType" = 'mixed' THEN '厕所含蹲坑和坐便；' ELSE '' END,
  '；'
);

UPDATE "ImportCandidate"
SET "facilities" = TRIM(
  CASE WHEN "hotWater" = 'yes' THEN '有开水；' WHEN "hotWater" = 'no' THEN '无开水；' ELSE '' END ||
  CASE WHEN "toilet" = 'yes' THEN '有厕所；' WHEN "toilet" = 'no' THEN '无厕所；' ELSE '' END ||
  CASE WHEN "toiletType" = 'squat' THEN '厕所为蹲坑；' WHEN "toiletType" = 'seat' THEN '厕所为坐便；' WHEN "toiletType" = 'mixed' THEN '厕所含蹲坑和坐便；' ELSE '' END,
  '；'
);
