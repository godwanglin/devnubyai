-- CreateTable payment_methods
CREATE TABLE `payment_methods` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `category` VARCHAR(32) NOT NULL DEFAULT 'virtual_account',
    `doku_code` VARCHAR(64) NULL,
    `flow_type` VARCHAR(16) NOT NULL DEFAULT 'direct',
    `image_path` VARCHAR(512) NULL,
    `description` VARCHAR(255) NULL,
    `instructions` TEXT NULL,
    `min_amount` INT UNSIGNED NOT NULL DEFAULT 1000,
    `max_amount` INT UNSIGNED NULL,
    `fee_type` VARCHAR(16) NOT NULL DEFAULT 'none',
    `fee_value` INT UNSIGNED NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 100,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_payment_methods_public_id`(`public_id`),
    UNIQUE INDEX `uq_payment_methods_code`(`code`),
    INDEX `idx_payment_methods_listing`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable payment_transactions
CREATE TABLE `payment_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `invoice_number` VARCHAR(64) NOT NULL,
    `user_id` BIGINT UNSIGNED NULL,
    `payment_method_id` BIGINT UNSIGNED NULL,
    `payment_method_code` VARCHAR(64) NOT NULL,
    `payment_method_name` VARCHAR(120) NOT NULL,
    `amount` INT UNSIGNED NOT NULL,
    `fee` INT UNSIGNED NOT NULL DEFAULT 0,
    `total_amount` INT UNSIGNED NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'IDR',
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `payment_code` VARCHAR(128) NULL,
    `checkout_url` VARCHAR(2048) NULL,
    `qr_content` TEXT NULL,
    `how_to_pay_url` VARCHAR(2048) NULL,
    `customer_name` VARCHAR(120) NOT NULL,
    `customer_email` VARCHAR(320) NOT NULL,
    `customer_phone` VARCHAR(32) NULL,
    `metadata` JSON NULL,
    `doku_response` JSON NULL,
    `manual_notes` TEXT NULL,
    `manual_updated_by` BIGINT UNSIGNED NULL,
    `manual_updated_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `expired_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_payment_transactions_public_id`(`public_id`),
    UNIQUE INDEX `uq_payment_transactions_invoice`(`invoice_number`),
    INDEX `idx_transactions_user`(`user_id`, `created_at`),
    INDEX `idx_transactions_status`(`status`, `created_at`),
    INDEX `idx_transactions_method_code`(`payment_method_code`),
    INDEX `idx_transactions_created`(`created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_transactions` ADD CONSTRAINT `fk_transactions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_transactions` ADD CONSTRAINT `fk_transactions_method` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_transactions` ADD CONSTRAINT `fk_transactions_manual_updater` FOREIGN KEY (`manual_updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Starter payment methods
INSERT INTO `payment_methods` (`public_id`, `name`, `code`, `category`, `doku_code`, `flow_type`, `image_path`, `description`, `min_amount`, `is_active`, `sort_order`) VALUES
(UUID(), 'BRI Virtual Account', 'bri', 'virtual_account', 'VIRTUAL_ACCOUNT_BRI', 'direct', '/images/payments/bri.svg', 'Bayar instan via Virtual Account Bank BRI (BRIVA) / BRImo', 1000, true, 10),
(UUID(), 'QRIS (Semua Pembayaran)', 'qris', 'qris', 'QRIS', 'checkout', '/images/payments/qris.svg', 'Scan QRIS via BCA, Mandiri, GoPay, OVO, ShopeePay, DANA', 1000, true, 20),
(UUID(), 'BCA Virtual Account', 'bca', 'virtual_account', 'VIRTUAL_ACCOUNT_BCA', 'direct', '/images/payments/bca.svg', 'Bayar via BCA Mobile, KlikBCA, atau ATM BCA', 10000, true, 30),
(UUID(), 'Mandiri Virtual Account', 'mandiri', 'virtual_account', 'VIRTUAL_ACCOUNT_BANK_MANDIRI', 'direct', '/images/payments/mandiri.svg', 'Bayar via Livin by Mandiri atau ATM Mandiri', 10000, true, 40),
(UUID(), 'BNI Virtual Account', 'bni', 'virtual_account', 'VIRTUAL_ACCOUNT_BNI', 'direct', '/images/payments/bni.svg', 'Bayar via BNI Mobile Banking atau ATM BNI', 10000, false, 50),
(UUID(), 'Permata Virtual Account', 'permata', 'virtual_account', 'VIRTUAL_ACCOUNT_BANK_PERMATA', 'direct', '/images/payments/permata.svg', 'Bayar via PermataMobile X atau ATM Permata', 10000, false, 60);

-- Insert our live tested transactions so admin has instant data to see
INSERT INTO `payment_transactions` (
    `public_id`, `invoice_number`, `payment_method_code`, `payment_method_name`,
    `amount`, `fee`, `total_amount`, `currency`, `status`, `payment_code`,
    `how_to_pay_url`, `customer_name`, `customer_email`, `customer_phone`,
    `expired_at`, `created_at`
) VALUES
(
    UUID(), 'INV-DIR-1793303684461', 'bri', 'BRI Virtual Account',
    20000, 0, 20000, 'IDR', 'PENDING', '1236260022058266',
    'https://app.doku.com/how-to-pay-v2/v2/bri-virtual-account/1236260022058266/Qr5ZsY5F-HvbS2yQBC0NNXmZxe0A0Rdgp8rjoFunykA',
    'DevNuby Tester', 'tester@devnuby.ai', '08123456789',
    DATE_ADD(NOW(), INTERVAL 60 MINUTE), NOW()
);
