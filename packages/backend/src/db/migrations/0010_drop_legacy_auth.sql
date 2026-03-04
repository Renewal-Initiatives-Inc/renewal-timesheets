-- Drop legacy auth tables (Zitadel handles sessions now)
DROP TABLE IF EXISTS "password_reset_tokens";
DROP TABLE IF EXISTS "sessions";

-- Drop legacy auth columns from employees (isSupervisor derived from Zitadel, auth moved to SSO)
ALTER TABLE "employees" DROP COLUMN IF EXISTS "is_supervisor";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "requires_password_change";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "failed_login_attempts";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "locked_until";
