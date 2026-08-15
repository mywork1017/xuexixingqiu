PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Place" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "hours" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "pushedFingerprint" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_Place" (
    "id",
    "name",
    "category",
    "address",
    "latitude",
    "longitude",
    "hours",
    "description",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "name",
    "category",
    "address",
    "latitude",
    "longitude",
    "hours",
    "description",
    "createdAt",
    "updatedAt"
FROM "Place";

DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
