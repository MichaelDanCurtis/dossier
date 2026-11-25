-- CreateTable
CREATE TABLE "JobAlertMonitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mailbox" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" TEXT NOT NULL,
    "checkedAt" DATETIME,
    "lastAlertAt" DATETIME,
    "nextCheckAt" DATETIME NOT NULL,
    "problem" TEXT
);

-- CreateTable
CREATE TABLE "JobAlertReceipt" (
    "mailbox" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "received" DATETIME NOT NULL,
    "count" INTEGER NOT NULL,

    PRIMARY KEY ("mailbox", "messageId")
);

-- CreateTable
CREATE TABLE "JobAlertLead" (
    "linkedinUrl" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "employerUrl" TEXT NOT NULL DEFAULT '',
    "boardRowId" TEXT,
    "received" DATETIME NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "JobAlertLead_received_idx" ON "JobAlertLead"("received");
