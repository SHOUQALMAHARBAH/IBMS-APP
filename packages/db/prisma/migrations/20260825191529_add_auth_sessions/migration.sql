-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'SSO');

-- CreateEnum
CREATE TYPE "MfaCredentialType" AS ENUM ('TOTP', 'WEBAUTHN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LOGIN';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'MFA_ENROLLED';
ALTER TYPE "AuditAction" ADD VALUE 'MFA_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'MFA_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'STEP_UP_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'ACCESS_WINDOW_EXPIRED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authProvider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MfaCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MfaCredentialType" NOT NULL,
    "secretEnc" TEXT,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "webauthnCredentialId" TEXT,
    "webauthnPublicKeyEnc" TEXT,
    "webauthnCounter" INTEGER,

    CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenId" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStepUpAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "hardLogoutAfterIdleMinutes" INTEGER NOT NULL DEFAULT 30,
    "accessTokenTtlMinutes" INTEGER NOT NULL DEFAULT 15,
    "refreshTokenTtlDays" INTEGER NOT NULL DEFAULT 14,
    "stepUpMaxAgeMinutes" INTEGER NOT NULL DEFAULT 10,
    "maxFailedLoginAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfaCredential_webauthnCredentialId_key" ON "MfaCredential"("webauthnCredentialId");

-- CreateIndex
CREATE INDEX "MfaCredential_userId_idx" ON "MfaCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_replacedByTokenId_key" ON "RefreshToken"("replacedByTokenId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshTokenId_key" ON "UserSession"("refreshTokenId");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_refreshTokenId_fkey" FOREIGN KEY ("refreshTokenId") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
