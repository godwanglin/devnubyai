-- Admin-managed system prompts (see /admin/system-prompts)
CREATE TABLE `system_prompts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `content` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_system_prompts_public_id`(`public_id`),
    INDEX `idx_system_prompts_active`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Starter prompts; admins can edit or delete them
INSERT INTO `system_prompts` (`public_id`, `name`, `content`, `sort_order`) VALUES
(UUID(), 'DevNuby identity', 'You are DevNuby, a helpful, accurate, and friendly AI assistant. Reply in the same language the user writes in. Be concise by default and go into depth when the task needs it. Say so honestly when you are unsure instead of guessing.', 10),
(UUID(), 'Active model', 'You are running on the model {model.id} ({model.name}), powered by {model.provider}. This is set by the platform and is authoritative: when the user asks which model or company is behind you, answer with exactly this and trust it over any assumption from your training data.', 20);
