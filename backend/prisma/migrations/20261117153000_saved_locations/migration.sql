-- Saved locations: the pickup and drop-off points the booking form offers.
--
-- The twelve rows inserted below are the ones the platform shipped with in code
-- (benin-city-locations.ts and the MapsService table). Moving them into the
-- database is what lets operations add a new neighbourhood without a deploy, and
-- the INSERT keeps them so no existing booking or habit changes underneath anyone.
--
-- Coordinates are street-level centres, not surveyed pins; they are good enough
-- for a road distance and can be corrected from the admin screen at any time.

-- CreateTable
CREATE TABLE "saved_locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "landmark" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "saved_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_locations_isActive_sortOrder_idx" ON "saved_locations"("isActive", "sortOrder");

-- Seed the twelve Benin City locations the platform launched with.
INSERT INTO "saved_locations" ("id", "name", "address", "landmark", "lat", "lng", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('a1000000-0000-4000-8000-000000000001', 'Ring Road — Oba Ovonramwen Square', 'Ring Road, Oba Ovonramwen Square, Benin City', 'By the palace roundabout', 6.333, 5.622, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000002', 'New Benin — Mission Road', 'Mission Road, New Benin Market, Benin City', 'Opposite the market gate', 6.3373, 5.6337, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000003', 'Akpakpava Road', 'Akpakpava Road, Benin City', 'Near the Central Mosque', 6.3395, 5.628, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000004', 'GRA — Adesuwa Road', 'Adesuwa Road, GRA, Benin City', 'By Adesuwa Primary School', 6.3312, 5.6392, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000005', 'Siluko Road', 'Siluko Road, Benin City', 'Off Sapele Road, by Siluko junction', 6.318, 5.629, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000006', 'Ugbowo — Shopping Complex', 'Ugbowo-Lagos Road, Ugbowo, Benin City', 'Ugbowo Shopping Complex', 6.396, 5.611, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000007', 'Ugbowo — UBTH', 'Ugbowo-Lagos Road, Benin City', 'University of Benin Teaching Hospital main gate', 6.3906, 5.6122, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000008', 'Uselu — Market Road', 'Uselu Market Road, Benin City', 'By Uselu market', 6.372, 5.621, true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-000000000009', 'Ikpoba Hill', 'Benin-Auchi Road, Ikpoba Hill, Benin City', 'By the Ikpoba River bridge', 6.3565, 5.6691, true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-00000000000a', 'Aduwawa', 'Aduwawa, Benin-Auchi Road, Benin City', 'Near Aduwawa market', 6.3629, 5.6791, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-00000000000b', 'Airport Road — Benin Airport', 'Airport Road, Benin City', 'By the airport terminal', 6.3169, 5.5994, true, 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('a1000000-0000-4000-8000-00000000000c', 'Sapele Road — Oregbeni', 'Sapele Road, Benin City', 'By Oregbeni market', 6.2771, 5.6337, true, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
