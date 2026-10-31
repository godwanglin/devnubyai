-- Add nullable plan discounts. NULL type/value means no discount.
ALTER TABLE `plans`
    ADD COLUMN `discount_type` VARCHAR(16) NULL AFTER `currency`,
    ADD COLUMN `discount_value` INT UNSIGNED NULL AFTER `discount_type`;
