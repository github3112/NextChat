CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL UNIQUE,
  `emailVerified` integer NOT NULL DEFAULT 0,
  `image` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);

CREATE TABLE `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expiresAt` integer NOT NULL,
  `token` text NOT NULL UNIQUE,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `ipAddress` text,
  `userAgent` text,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE INDEX `session_userId_idx` ON `session` (`userId`);

CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `accessToken` text,
  `refreshToken` text,
  `idToken` text,
  `accessTokenExpiresAt` integer,
  `refreshTokenExpiresAt` integer,
  `scope` text,
  `password` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);

CREATE INDEX `account_userId_idx` ON `account` (`userId`);

CREATE TABLE `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expiresAt` integer NOT NULL,
  `createdAt` integer,
  `updatedAt` integer
);

CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);

CREATE TABLE `cloudflare_connections` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `account_id` text NOT NULL,
  `database_id` text NOT NULL,
  `token_ciphertext` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `model_credentials` (
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `provider` text NOT NULL,
  `secret_ciphertext` text NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`user_id`, `provider`)
);
