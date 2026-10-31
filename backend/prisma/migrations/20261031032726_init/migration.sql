-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('CONTACT', 'AI', 'HUMAN', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACTS', 'INTERACTIVE', 'BUTTON', 'REACTION', 'TEMPLATE', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SIMULATED');

-- CreateEnum
CREATE TYPE "ReplyState" AS ENUM ('PENDING', 'ANSWERED', 'SKIPPED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "MemoryCategory" AS ENUM ('PERSONAL', 'PREFERENCE', 'BUSINESS', 'OTHER');

-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AiUsageKind" AS ENUM ('REPLY', 'MEMORY', 'TEST');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('NOTE', 'FAQ', 'FILE');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('CONTAINS', 'EXACT', 'STARTS_WITH', 'ANY_MESSAGE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Secret" (
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Secret_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "profileName" TEXT,
    "displayName" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "aiPaused" BOOLEAN NOT NULL DEFAULT false,
    "aiPausedAt" TIMESTAMP(3),
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "needsHumanReason" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT,
    "lastIntent" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "summaryUpdatedAt" TIMESTAMP(3),
    "messagesSinceMemoryUpdate" INTEGER NOT NULL DEFAULT 0,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "welcomeSentAt" TIMESTAMP(3),
    "outOfHoursSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "authorUserId" TEXT,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "text" TEXT,
    "transcription" TEXT,
    "mediaId" TEXT,
    "mediaMime" TEXT,
    "mediaFilename" TEXT,
    "mediaSha256" TEXT,
    "waMessageId" TEXT,
    "replyToWaId" TEXT,
    "status" "MessageStatus" NOT NULL,
    "replyState" "ReplyState" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "skipReason" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "responseTimeMs" INTEGER,
    "templateName" TEXT,
    "pricingCategory" TEXT,
    "billable" BOOLEAN,
    "waTimestamp" TIMESTAMP(3),
    "aiUsageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMemory" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "category" "MemoryCategory" NOT NULL DEFAULT 'OTHER',
    "content" TEXT NOT NULL,
    "source" "MemorySource" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "kind" "AiUsageKind" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "KnowledgeKind" NOT NULL,
    "content" TEXT NOT NULL,
    "question" TEXT,
    "answer" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, "searchText")) STORED,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchType" "MatchType" NOT NULL DEFAULT 'CONTAINS',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyText" TEXT,
    "addTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "stopAi" BOOLEAN NOT NULL DEFAULT false,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 0,
    "timesTriggered" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationHit" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "groupKey" TEXT,
    "dedupeKey" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_waId_key" ON "Contact"("waId");

-- CreateIndex
CREATE INDEX "Contact_lastMessageAt_idx" ON "Contact"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Contact_needsHuman_idx" ON "Contact"("needsHuman");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE INDEX "Message_contactId_createdAt_idx" ON "Message"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_contactId_replyState_idx" ON "Message"("contactId", "replyState");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "ContactMemory_contactId_idx" ON "ContactMemory"("contactId");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_contactId_idx" ON "AiUsage"("contactId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");

-- CreateIndex
CREATE INDEX "AutomationHit_ruleId_contactId_createdAt_idx" ON "AutomationHit"("ruleId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_dedupeKey_status_idx" ON "Job"("dedupeKey", "status");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMemory" ADD CONSTRAINT "ContactMemory_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Búsqueda de texto completo en la base de conocimientos (columna generada + índice GIN)
CREATE INDEX "KnowledgeChunk_tsv_idx" ON "KnowledgeChunk" USING GIN ("tsv");
