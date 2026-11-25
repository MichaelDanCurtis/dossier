-- CreateTable
CREATE TABLE "JobAlertMonitor" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "lastAlertAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "problem" TEXT,

    CONSTRAINT "JobAlertMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlertReceipt" (
    "mailbox" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "received" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "JobAlertReceipt_pkey" PRIMARY KEY ("mailbox","messageId")
);

-- CreateTable
CREATE TABLE "JobAlertLead" (
    "linkedinUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "employerUrl" TEXT NOT NULL DEFAULT '',
    "boardRowId" TEXT,
    "received" TIMESTAMP(3) NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "JobAlertLead_pkey" PRIMARY KEY ("linkedinUrl")
);

-- CreateIndex
CREATE INDEX "JobAlertLead_received_idx" ON "JobAlertLead"("received");
