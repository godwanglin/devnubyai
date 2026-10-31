-- Migrate single discount into dedicated monthly and yearly discounts.
ALTER TABLE `plans`
    ADD COLUMN `discount_monthly_type` VARCHAR(16) NULL AFTER `currency`,
    ADD COLUMN `discount_monthly_value` INT UNSIGNED NULL AFTER `discount_monthly_type`,
    ADD COLUMN `discount_yearly_type` VARCHAR(16) NULL AFTER `discount_monthly_value`,
    ADD COLUMN `discount_yearly_value` INT UNSIGNED NULL AFTER `discount_yearly_type`;

-- Copy existing discount to monthly discount if present
UPDATE `plans`
SET `discount_monthly_type` = `discount_type`,
    `discount_monthly_value` = `discount_value`
WHERE `discount_type` IS NOT NULL;

-- Drop legacy generic discount columns
ALTER TABLE `plans`
    DROP COLUMN `discount_type`,
    DROP COLUMN `discount_value`;
