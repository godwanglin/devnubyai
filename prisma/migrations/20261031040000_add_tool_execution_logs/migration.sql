-- Create tool_execution_logs table for append-only debugging of AI tool runs
CREATE TABLE `tool_execution_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` CHAR(36) NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `session_id` BIGINT UNSIGNED NULL,
  `message_id` BIGINT UNSIGNED NULL,
  `tool_call_id` VARCHAR(128) NOT NULL,
  `tool_name` VARCHAR(64) NOT NULL,
  `success` BOOLEAN NOT NULL,
  `error_code` VARCHAR(32) NULL,
  `error_text` TEXT NULL,
  `raw_args` MEDIUMTEXT NULL,
  `input` JSON NULL,
  `output` JSON NULL,
  `duration_ms` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tool_logs_created` (`created_at`),
  KEY `idx_tool_logs_tool` (`tool_name`, `success`, `created_at`),
  KEY `idx_tool_logs_session` (`session_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default tool debug setting: false (do not log tool runs to DB until explicitly enabled)
INSERT IGNORE INTO `app_settings` (`setting_key`, `value`)
VALUES ('chat.tool_debug', 'false');
