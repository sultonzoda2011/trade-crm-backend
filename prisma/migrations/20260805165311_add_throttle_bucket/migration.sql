-- CreateTable
CREATE TABLE "ThrottleBucket" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),

    CONSTRAINT "ThrottleBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ThrottleBucket_expiresAt_idx" ON "ThrottleBucket"("expiresAt");
