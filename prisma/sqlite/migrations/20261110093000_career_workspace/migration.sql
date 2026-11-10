-- AlterTable
ALTER TABLE "Application" ADD COLUMN "packageApprovalAt" DATETIME;
ALTER TABLE "Application" ADD COLUMN "packageApprovalHash" TEXT;
ALTER TABLE "Application" ADD COLUMN "variantContextJson" TEXT;

-- CreateTable
CREATE TABLE "CareerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "contextJson" TEXT NOT NULL,
    "linkedRecordId" TEXT,
    "periodKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CareerMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'USER',
    "text" TEXT NOT NULL,
    "requestId" TEXT,
    "jobId" TEXT,
    "finishing" BOOLEAN NOT NULL DEFAULT false,
    "replyToId" TEXT,
    "promptVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CareerMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CareerSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareerProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "generationKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "dataJson" TEXT NOT NULL,
    "sourceMessageIdsJson" TEXT NOT NULL DEFAULT '[]',
    "baselineHash" TEXT,
    "appliedRecordId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CareerProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CareerSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResumeVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "focus" TEXT NOT NULL DEFAULT '',
    "selectionJson" TEXT NOT NULL DEFAULT '[]',
    "overridesJson" TEXT NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ResumeVariantVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "focus" TEXT NOT NULL,
    "selectionJson" TEXT NOT NULL,
    "overridesJson" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResumeVariantVersion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ResumeVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplicationPackageSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT,
    "employerKey" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "variantName" TEXT,
    "contentHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshotJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationPackageSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplicationPackageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationPackageEvent_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ApplicationPackageSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyBoard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'global',
    "boardToken" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalHours" INTEGER NOT NULL DEFAULT 24,
    "lastAttempt" DATETIME,
    "lastSuccess" DATETIME,
    "nextCheckAt" DATETIME,
    "error" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "etag" TEXT,
    "lastModified" TEXT,
    "listingSchema" INTEGER NOT NULL DEFAULT 1,
    "listingJson" TEXT,
    "listingAt" DATETIME,
    "pendingListingJson" TEXT,
    "allowedDisappearanceHash" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompanyPosting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "applicationUrl" TEXT NOT NULL,
    "urlKey" TEXT NOT NULL,
    "postingJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL DEFAULT '',
    "needsDetails" BOOLEAN NOT NULL DEFAULT false,
    "detailsCheckedAt" DATETIME,
    "detailRetryAt" DATETIME,
    "detailError" TEXT,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingScans" INTEGER NOT NULL DEFAULT 0,
    "lastMissingAt" DATETIME,
    "closedAt" DATETIME,
    CONSTRAINT "CompanyPosting_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "CompanyBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerSession_periodKey_key" ON "CareerSession"("periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "CareerMessage_replyToId_key" ON "CareerMessage"("replyToId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerMessage_sessionId_ordinal_key" ON "CareerMessage"("sessionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "CareerMessage_sessionId_requestId_key" ON "CareerMessage"("sessionId", "requestId");

-- CreateIndex
CREATE INDEX "CareerProposal_kind_status_acceptedAt_idx" ON "CareerProposal"("kind", "status", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CareerProposal_generationKey_ordinal_key" ON "CareerProposal"("generationKey", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVariantVersion_variantId_revision_key" ON "ResumeVariantVersion"("variantId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPackageSnapshot_contentHash_key" ON "ApplicationPackageSnapshot"("contentHash");

-- CreateIndex
CREATE INDEX "ApplicationPackageSnapshot_employerKey_createdAt_idx" ON "ApplicationPackageSnapshot"("employerKey", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationPackageEvent_packageId_kind_createdAt_idx" ON "ApplicationPackageEvent"("packageId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBoard_platform_region_boardToken_key" ON "CompanyBoard"("platform", "region", "boardToken");

-- CreateIndex
CREATE INDEX "CompanyPosting_urlKey_idx" ON "CompanyPosting"("urlKey");

-- CreateIndex
CREATE INDEX "CompanyPosting_boardId_needsDetails_detailRetryAt_idx" ON "CompanyPosting"("boardId", "needsDetails", "detailRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPosting_boardId_externalId_key" ON "CompanyPosting"("boardId", "externalId");
