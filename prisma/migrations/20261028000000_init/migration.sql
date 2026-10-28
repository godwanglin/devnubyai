-- Devnuby AI: Initial database migration (MariaDB 10.11)
-- Matches .plans/01-database-schema.md
-- Engine: InnoDB, Charset: utf8mb4, Collation: utf8mb4_unicode_ci (or database default)

SET FOREIGN_KEY_CHECKS = 0;

-- ───────────── 1. Users & auth ─────────────

CREATE TABLE `plans` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `monthly_token_limit` BIGINT UNSIGNED NULL,
    `daily_request_limit` INTEGER UNSIGNED NULL,
    `requests_per_minute` SMALLINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_plans_slug`(`slug`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `avatar_url` VARCHAR(2048) NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'user',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `plan_id` BIGINT UNSIGNED NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_users_public_id`(`public_id`),
    UNIQUE INDEX `uq_users_email`(`email`),
    INDEX `idx_users_plan`(`plan_id`),
    INDEX `idx_users_role_status`(`role`, `status`),
    CONSTRAINT `chk_users_role` CHECK (`role` IN ('user', 'admin')),
    CONSTRAINT `chk_users_status` CHECK (`status` IN ('active', 'suspended')),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auth_accounts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `provider` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `provider_account_id` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_auth_accounts_user`(`user_id`),
    UNIQUE INDEX `uq_auth_accounts_provider`(`provider`, `provider_account_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auth_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `token_hash` BINARY(32) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_auth_sessions_token`(`token_hash`),
    INDEX `idx_auth_sessions_user`(`user_id`),
    INDEX `idx_auth_sessions_expires`(`expires_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ───────────── 2. Gateways & upstream catalog ─────────────

CREATE TABLE `gateways` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `base_url` VARCHAR(2048) NOT NULL,
    `wire_api` VARCHAR(16) NOT NULL DEFAULT 'chat',
    `models_path` VARCHAR(255) NOT NULL DEFAULT '/models',
    `api_key_ciphertext` VARBINARY(1024) NOT NULL,
    `api_key_last4` CHAR(4) NULL,
    `extra_headers` JSON NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `primary_marker` TINYINT AS (IF(`is_primary` = 1, 1, NULL)) PERSISTENT,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority` SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    `timeout_ms` INTEGER UNSIGNED NOT NULL DEFAULT 120000,
    `first_token_timeout_ms` INTEGER UNSIGNED NOT NULL DEFAULT 20000,
    `health_status` VARCHAR(16) NOT NULL DEFAULT 'unknown',
    `consecutive_failures` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `circuit_open_until` DATETIME(3) NULL,
    `last_success_at` DATETIME(3) NULL,
    `last_failure_at` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_gateways_slug`(`slug`),
    UNIQUE INDEX `uq_gateways_single_primary`(`primary_marker`),
    INDEX `idx_gateways_routing`(`is_enabled`, `is_primary`, `priority`),
    CONSTRAINT `chk_gateways_wire_api` CHECK (`wire_api` IN ('chat', 'responses')),
    CONSTRAINT `chk_gateways_health` CHECK (`health_status` IN ('unknown', 'healthy', 'degraded', 'down')),
    CONSTRAINT `chk_gateways_primary_enabled` CHECK (NOT (`is_primary` = 1 AND `is_enabled` = 0)),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `upstream_models` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `gateway_id` BIGINT UNSIGNED NOT NULL,
    `model_key` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `owned_by` VARCHAR(120) NULL,
    `is_available` BOOLEAN NOT NULL DEFAULT true,
    `raw_metadata` JSON NULL,
    `first_seen_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `idx_upstream_models_gateway_avail`(`gateway_id`, `is_available`, `model_key`),
    INDEX `idx_upstream_models_key`(`model_key`),
    UNIQUE INDEX `uq_upstream_models_gateway_key`(`gateway_id`, `model_key`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ───────────── 3. Public catalog ─────────────

CREATE TABLE `model_providers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `logo_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `logo_url` VARCHAR(2048) NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_model_providers_slug`(`slug`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_models` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    `display_name` VARCHAR(120) NOT NULL,
    `short_name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(500) NULL,
    `provider_id` BIGINT UNSIGNED NOT NULL,
    `category` VARCHAR(16) NOT NULL DEFAULT 'powerful',
    `badge` VARCHAR(32) NULL,
    `context_window` INTEGER UNSIGNED NULL,
    `max_output_tokens` INTEGER UNSIGNED NULL,
    `supports_vision` BOOLEAN NOT NULL DEFAULT false,
    `supports_tools` BOOLEAN NOT NULL DEFAULT false,
    `supports_reasoning` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_catalog_models_public_id`(`public_id`),
    INDEX `idx_catalog_models_listing`(`status`, `sort_order`),
    INDEX `idx_catalog_models_provider`(`provider_id`),
    CONSTRAINT `chk_catalog_models_category` CHECK (`category` IN ('powerful', 'fast')),
    CONSTRAINT `chk_catalog_models_status` CHECK (`status` IN ('draft', 'active', 'hidden', 'disabled')),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_model_routes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `catalog_model_id` BIGINT UNSIGNED NOT NULL,
    `upstream_model_id` BIGINT UNSIGNED NOT NULL,
    `priority` SMALLINT UNSIGNED NOT NULL,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `param_overrides` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `idx_routes_resolve`(`catalog_model_id`, `is_enabled`, `priority`),
    INDEX `idx_routes_upstream`(`upstream_model_id`),
    UNIQUE INDEX `uq_routes_model_upstream`(`catalog_model_id`, `upstream_model_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `app_settings` (
    `setting_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `value` JSON NOT NULL,
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `idx_app_settings_updated_by`(`updated_by`),
    PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ───────────── 4. Chat ─────────────

CREATE TABLE `chat_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(200) NOT NULL DEFAULT 'New chat',
    `catalog_model_id` BIGINT UNSIGNED NULL,
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_chat_sessions_public_id`(`public_id`),
    INDEX `idx_chat_sessions_sidebar`(`user_id`, `is_pinned` DESC, `last_message_at` DESC, `id` DESC),
    INDEX `idx_chat_sessions_model`(`catalog_model_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `chat_messages` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `session_id` BIGINT UNSIGNED NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `reasoning` MEDIUMTEXT NULL,
    `parts` JSON NULL,
    `catalog_model_id` BIGINT UNSIGNED NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'completed',
    `error_code` VARCHAR(64) NULL,
    `prompt_tokens` INTEGER UNSIGNED NULL,
    `completion_tokens` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_chat_messages_public_id`(`public_id`),
    INDEX `idx_chat_messages_session`(`session_id`, `id`),
    INDEX `idx_chat_messages_status`(`status`, `updated_at`),
    INDEX `idx_chat_messages_model`(`catalog_model_id`),
    CONSTRAINT `chk_chat_messages_role` CHECK (`role` IN ('user', 'assistant', 'system', 'tool')),
    CONSTRAINT `chk_chat_messages_status` CHECK (`status` IN ('pending', 'streaming', 'completed', 'error', 'aborted')),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session_files` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `session_id` BIGINT UNSIGNED NOT NULL,
    `message_id` BIGINT UNSIGNED NULL,
    `filename` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `storage_key` VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `mime_type` VARCHAR(127) NOT NULL,
    `size_bytes` BIGINT UNSIGNED NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_session_files_public_id`(`public_id`),
    UNIQUE INDEX `uq_session_files_storage_key`(`storage_key`),
    INDEX `idx_session_files_user`(`user_id`, `created_at`),
    INDEX `idx_session_files_message`(`message_id`),
    UNIQUE INDEX `uq_session_files_name`(`session_id`, `filename`),
    CONSTRAINT `chk_session_files_source` CHECK (`source` IN ('upload', 'tool')),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ───────────── 5. Observability & quota ─────────────

CREATE TABLE `routing_attempts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `message_id` BIGINT UNSIGNED NULL,
    `catalog_model_id` BIGINT UNSIGNED NOT NULL,
    `gateway_id` BIGINT UNSIGNED NOT NULL,
    `upstream_model_id` BIGINT UNSIGNED NOT NULL,
    `attempt_no` TINYINT UNSIGNED NOT NULL,
    `outcome` VARCHAR(16) NOT NULL,
    `error_class` VARCHAR(32) NULL,
    `http_status` SMALLINT UNSIGNED NULL,
    `latency_ms` INTEGER UNSIGNED NOT NULL,
    `ttft_ms` INTEGER UNSIGNED NULL,
    `prompt_tokens` INTEGER UNSIGNED NULL,
    `completion_tokens` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_attempts_created`(`created_at`),
    INDEX `idx_attempts_gateway`(`gateway_id`, `created_at`),
    INDEX `idx_attempts_model`(`catalog_model_id`, `created_at`),
    INDEX `idx_attempts_user`(`user_id`, `created_at`),
    INDEX `idx_attempts_request`(`request_id`),
    CONSTRAINT `chk_attempts_outcome` CHECK (`outcome` IN ('success', 'fallback', 'failed', 'aborted')),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_usage_periods` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `period_start` DATE NOT NULL,
    `request_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `prompt_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `completion_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `period_start`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `admin_audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `actor_user_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(32) NOT NULL,
    `entity_id` VARCHAR(128) NULL,
    `before_state` JSON NULL,
    `after_state` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_audit_entity`(`entity_type`, `entity_id`, `created_at`),
    INDEX `idx_audit_actor`(`actor_user_id`, `created_at`),
    INDEX `idx_audit_created`(`created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ───────────── 6. Foreign Keys ─────────────

ALTER TABLE `users` ADD CONSTRAINT `fk_users_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `auth_accounts` ADD CONSTRAINT `fk_auth_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `auth_sessions` ADD CONSTRAINT `fk_auth_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `upstream_models` ADD CONSTRAINT `fk_upstream_models_gateway` FOREIGN KEY (`gateway_id`) REFERENCES `gateways`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `catalog_models` ADD CONSTRAINT `fk_catalog_models_provider` FOREIGN KEY (`provider_id`) REFERENCES `model_providers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `catalog_model_routes` ADD CONSTRAINT `fk_routes_catalog_model` FOREIGN KEY (`catalog_model_id`) REFERENCES `catalog_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `catalog_model_routes` ADD CONSTRAINT `fk_routes_upstream_model` FOREIGN KEY (`upstream_model_id`) REFERENCES `upstream_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `app_settings` ADD CONSTRAINT `fk_app_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `chat_sessions` ADD CONSTRAINT `fk_chat_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `chat_sessions` ADD CONSTRAINT `fk_chat_sessions_model` FOREIGN KEY (`catalog_model_id`) REFERENCES `catalog_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `chat_messages` ADD CONSTRAINT `fk_chat_messages_session` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `chat_messages` ADD CONSTRAINT `fk_chat_messages_model` FOREIGN KEY (`catalog_model_id`) REFERENCES `catalog_models`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `session_files` ADD CONSTRAINT `fk_session_files_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_files` ADD CONSTRAINT `fk_session_files_session` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `session_files` ADD CONSTRAINT `fk_session_files_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_usage_periods` ADD CONSTRAINT `fk_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
