-- User memory notes (AI tool: memory_note)
CREATE TABLE `user_notes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(200) NOT NULL,
  `content` MEDIUMTEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_notes_public_id` (`public_id`),
  KEY `idx_user_notes_user_updated` (`user_id`, `updated_at`),
  KEY `idx_user_notes_session` (`session_id`),
  CONSTRAINT `fk_user_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_notes_session` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
