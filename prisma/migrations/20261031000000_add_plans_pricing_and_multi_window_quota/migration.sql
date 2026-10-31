-- ModifyTable plans
ALTER TABLE `plans`
    ADD COLUMN `description` VARCHAR(255) NULL AFTER `name`,
    ADD COLUMN `price_monthly` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `description`,
    ADD COLUMN `price_yearly` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `price_monthly`,
    ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'IDR' AFTER `price_yearly`,
    ADD COLUMN `weekly_token_limit` BIGINT UNSIGNED NULL AFTER `monthly_token_limit`,
    ADD COLUMN `five_hour_token_limit` BIGINT UNSIGNED NULL AFTER `weekly_token_limit`,
    ADD COLUMN `badge` VARCHAR(32) NULL AFTER `requests_per_minute`,
    ADD COLUMN `features` LONGTEXT NULL AFTER `badge`,
    ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true AFTER `features`,
    ADD COLUMN `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 100 AFTER `is_active`;

CREATE INDEX `idx_plans_listing` ON `plans`(`is_active`, `sort_order`);

-- ModifyTable catalog_models
ALTER TABLE `catalog_models`
    ADD COLUMN `input_price_per_million` DECIMAL(10, 4) NOT NULL DEFAULT 0.0000 AFTER `sort_order`,
    ADD COLUMN `output_price_per_million` DECIMAL(10, 4) NOT NULL DEFAULT 0.0000 AFTER `input_price_per_million`,
    ADD COLUMN `pricing_currency` VARCHAR(8) NOT NULL DEFAULT 'USD' AFTER `output_price_per_million`;

-- CreateTable plan_model_accesses
CREATE TABLE `plan_model_accesses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `plan_id` BIGINT UNSIGNED NOT NULL,
    `catalog_model_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_plan_model_access`(`plan_id`, `catalog_model_id`),
    INDEX `idx_pma_model`(`catalog_model_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `plan_model_accesses`
    ADD CONSTRAINT `fk_pma_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pma_model` FOREIGN KEY (`catalog_model_id`) REFERENCES `catalog_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable user_usage_windows
CREATE TABLE `user_usage_windows` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `window_type` VARCHAR(16) NOT NULL,
    `window_key` VARCHAR(32) NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `window_end` DATETIME(3) NOT NULL,
    `request_count` INT UNSIGNED NOT NULL DEFAULT 0,
    `prompt_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `completion_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_user_window`(`user_id`, `window_type`, `window_key`),
    INDEX `idx_user_window_lookup`(`user_id`, `window_type`, `window_end`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_usage_windows`
    ADD CONSTRAINT `fk_usage_window_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Populate default plan_model_accesses for existing catalog models to prevent breaking current users
-- Connect all catalog models to 'pro' plan if it exists
INSERT IGNORE INTO `plan_model_accesses` (`plan_id`, `catalog_model_id`)
SELECT p.id, cm.id
FROM `plans` p
CROSS JOIN `catalog_models` cm
WHERE p.slug = 'pro';

-- Connect non-flagship catalog models to 'free' plan if it exists
INSERT IGNORE INTO `plan_model_accesses` (`plan_id`, `catalog_model_id`)
SELECT p.id, cm.id
FROM `plans` p
CROSS JOIN `catalog_models` cm
WHERE p.slug = 'free' AND cm.category != 'flagship';
