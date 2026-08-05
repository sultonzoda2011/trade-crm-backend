-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('PCS', 'KG', 'L', 'M', 'BOX');

-- AlterEnum
ALTER TYPE "TransactionStatus" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REFUND';

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionItem" DROP CONSTRAINT "TransactionItem_transactionId_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unit" "ProductUnit" NOT NULL DEFAULT 'PCS';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "refundOfId" TEXT;

-- AlterTable
ALTER TABLE "TransactionItem" ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "image" TEXT;

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "image" TEXT,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_marketId_idx" ON "Category"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_marketId_name_key" ON "Category"("marketId", "name");

-- CreateIndex
CREATE INDEX "Debtor_marketId_idx" ON "Debtor"("marketId");

-- CreateIndex
CREATE INDEX "Payment_createdById_idx" ON "Payment"("createdById");

-- CreateIndex
CREATE INDEX "Product_marketId_idx" ON "Product"("marketId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_refundOfId_key" ON "Transaction"("refundOfId");

-- CreateIndex
CREATE INDEX "Transaction_marketId_idx" ON "Transaction"("marketId");

-- CreateIndex
CREATE INDEX "Transaction_debtorId_idx" ON "Transaction"("debtorId");

-- CreateIndex
CREATE INDEX "Transaction_createdById_idx" ON "Transaction"("createdById");

-- CreateIndex
CREATE INDEX "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionItem_productId_idx" ON "TransactionItem"("productId");

-- CreateIndex
CREATE INDEX "User_marketId_idx" ON "User"("marketId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refundOfId_fkey" FOREIGN KEY ("refundOfId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
