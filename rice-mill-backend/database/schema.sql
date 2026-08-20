-- Rice Mill ERP — Full Database Schema (generated from Sequelize model definitions)
-- Charset/engine: utf8mb4 / InnoDB. FKs assume this creation order.
-- NOTE: user.role_id and plant_master's own plant_id are intentionally NOT
-- foreign-keyed here to avoid circular creation-order issues; add via ALTER
-- TABLE after both tables exist if you need that constraint enforced in MySQL.
--
-- MIGRATION (2026-07-31): material_master.category changed from a fixed
-- 6-value ENUM to a free-text VARCHAR(30) so new categories can be added
-- from the app (Purchase Orders quick-add, Admin > Master Settings) instead
-- of only the original paddy/rice/husk/bran/broken/other. If you already
-- have a live database from before this change, run this once instead of
-- recreating the table (existing enum values are valid strings already, so
-- no data is lost or needs converting):
--
--   ALTER TABLE material_master MODIFY COLUMN category VARCHAR(30) NOT NULL;
--
-- Or just run `npm run db:sync` (sequelize.sync({ alter: true })) from
-- rice-mill-backend — it reads the updated model and alters the column the
-- same way.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `plant_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `plant_code` VARCHAR(20) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `address` TEXT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `roles` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `role_name` VARCHAR(50) NOT NULL UNIQUE,
  `description` TEXT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `permissions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `module` VARCHAR(50) NOT NULL,
  `action` ENUM('create', 'read', 'update', 'delete', 'approve') NOT NULL,
  `code` VARCHAR(100) NOT NULL UNIQUE,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  UNIQUE KEY `idx_permissions_module_action` (`module`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `role_permissions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `role_id` BIGINT NOT NULL,
  `permission_id` BIGINT NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`),
  FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`),
  UNIQUE KEY `idx_role_permissions_role_id_permission_id` (`role_id`, `permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `users` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `phone` VARCHAR(15) NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role_id` BIGINT NOT NULL,
  `employee_code` VARCHAR(30) NULL UNIQUE,
  `is_active` TINYINT(1) NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `uom_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `uom_code` VARCHAR(10) NOT NULL UNIQUE,
  `name` VARCHAR(50) NOT NULL,
  `conversion_factor` DECIMAL(10, 4) NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `variety_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `variety_name` VARCHAR(100) NOT NULL UNIQUE,
  `grain_type` ENUM('long', 'medium', 'short') NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `material_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `material_code` VARCHAR(30) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `category` VARCHAR(30) NOT NULL, -- free text, e.g. 'paddy'/'rice'/'husk'/'bran'/'broken'/'other' by default — not a DB-enforced enum
  `uom_id` BIGINT NULL,  -- normalized from raw "uom" string
  `variety_id` BIGINT NULL,
  `hsn_code` VARCHAR(15) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`uom_id`) REFERENCES `uom_master`(`id`),
  FOREIGN KEY (`variety_id`) REFERENCES `variety_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `warehouse_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `warehouse_code` VARCHAR(30) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `location` VARCHAR(255) NULL,
  `capacity` DECIMAL(12, 2) NULL,
  `type` ENUM('raw', 'fg') NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `bin_stack_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `bin_code` VARCHAR(30) NOT NULL UNIQUE,
  `warehouse_id` BIGINT NOT NULL,
  `capacity` DECIMAL(12, 2) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `machine_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `machine_code` VARCHAR(30) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `type` ENUM('huller', 'separator', 'shiner', 'color_sorter', 'grader', 'dryer', 'other') NOT NULL,
  `capacity_per_hr` DECIMAL(10, 2) NULL,
  `install_date` DATE NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `rate_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `material_id` BIGINT NOT NULL,
  `variety_id` BIGINT NULL,
  `base_rate` DECIMAL(10, 2) NOT NULL,
  `effective_date` DATE NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`variety_id`) REFERENCES `variety_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`),
  KEY `idx_rate_master_material_id_variety_id_effective_date` (`material_id`, `variety_id`, `effective_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `quality_parameter_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `parameter_name` VARCHAR(100) NOT NULL UNIQUE,
  `unit` VARCHAR(20) NULL,
  `acceptable_min` DECIMAL(10, 2) NULL,
  `acceptable_max` DECIMAL(10, 2) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `reason_code_master` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `category` ENUM('rejection', 'downtime', 'waste') NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `description` VARCHAR(255) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`),
  UNIQUE KEY `idx_reason_code_master_category_code` (`category`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `vendors` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `vendor_code` VARCHAR(30) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `gstin` VARCHAR(15) NULL UNIQUE,
  `address` TEXT NULL,
  `bank_details` JSON NULL,
  `rating` DECIMAL(3, 2) NULL DEFAULT 0,
  `credit_terms` VARCHAR(50) NULL,
  `vendor_type` ENUM('supplier', 'by_product_buyer') NULL DEFAULT 'supplier',
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `customers` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `customer_code` VARCHAR(30) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `gstin` VARCHAR(15) NULL UNIQUE,
  `address` TEXT NULL,
  `credit_limit` DECIMAL(12, 2) NULL DEFAULT 0,
  `customer_type` ENUM('fg', 'by_product') NULL DEFAULT 'fg',  -- note #25: by-product customers != FG customers
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `drivers` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `mobile` VARCHAR(15) NOT NULL UNIQUE,
  `license_no` VARCHAR(30) NULL UNIQUE,
  `photo_url` VARCHAR(255) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `vehicles` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `vehicle_no` VARCHAR(20) NOT NULL UNIQUE,
  `type` ENUM('truck', 'tractor_trolley') NOT NULL,
  `capacity` DECIMAL(10, 2) NULL,
  `owner_vendor_id` BIGINT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`owner_vendor_id`) REFERENCES `vendors`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `purchase_order` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `po_no` VARCHAR(30) NOT NULL UNIQUE,
  `vendor_id` BIGINT NOT NULL,
  `material_id` BIGINT NOT NULL,
  `variety_id` BIGINT NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `rate` DECIMAL(10, 2) NOT NULL,
  `po_date` DATE NOT NULL,
  `validity` DATE NULL,
  `do_no` VARCHAR(30) NULL,  -- Delivery Order number
  `uploaded_by_vendor` TINYINT(1) NULL DEFAULT 0,  -- note #12
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`),
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`variety_id`) REFERENCES `variety_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `gate_entry` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `token_no` VARCHAR(30) NOT NULL UNIQUE,  -- sequential
  `vehicle_id` BIGINT NOT NULL,
  `driver_id` BIGINT NOT NULL,
  `driver_photo_url` VARCHAR(255) NULL,
  `entry_type` ENUM('purchase','other','sales') NOT NULL DEFAULT 'purchase',
  `vendor_id` BIGINT NULL,  -- entry_type = 'purchase' only
  `po_id` BIGINT NULL,
  `so_id` BIGINT NULL,  -- entry_type = 'sales' only (outbound loading)
  `challan_no` VARCHAR(30) NULL,
  `material_id` BIGINT NULL,
  `expected_qty` DECIMAL(12, 2) NULL,
  `remarks` VARCHAR(255) NULL,
  `received_warehouse_id` BIGINT NULL,
  `entry_time` DATETIME NULL,
  `exit_time` DATETIME NULL,
  `gate_status` ENUM('waiting_token', 'waiting_sampling', 'sampling_done', 'accepted', 'rejected', 'waiting_weighment', 'in_process', 'unloading', 'unloaded', 'waiting_loading', 'loaded', 'parked', 'exited') NULL DEFAULT 'waiting_token',  -- notes #2,#5,#13
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`),
  FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`),
  FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`),
  FOREIGN KEY (`po_id`) REFERENCES `purchase_order`(`id`),
  FOREIGN KEY (`so_id`) REFERENCES `sales_order`(`id`),
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`received_warehouse_id`) REFERENCES `warehouse_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`),
  KEY `idx_gate_entry_gate_status` (`gate_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Outbound loading capture at the gate (entry_type = 'sales' flow).
-- One row per gate entry: quantity-only record of what was loaded against
-- a Sales Order, distinct from the more granular Dispatch/FinishedGoods
-- picking flow used elsewhere.
CREATE TABLE `loading` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `loading_no` VARCHAR(30) NOT NULL UNIQUE,
  `gate_entry_id` BIGINT NOT NULL UNIQUE,
  `so_id` BIGINT NOT NULL,
  `loaded_qty` DECIMAL(12, 2) NOT NULL,
  `loaded_at` DATETIME NULL,
  `loading_operator_id` BIGINT UNSIGNED NULL,
  `remarks` VARCHAR(255) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`gate_entry_id`) REFERENCES `gate_entry`(`id`),
  FOREIGN KEY (`so_id`) REFERENCES `sales_order`(`id`),
  FOREIGN KEY (`loading_operator_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE `sampling` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `gate_entry_id` BIGINT NOT NULL,
  `sample_code` VARCHAR(30) NOT NULL UNIQUE,
  `collected_by` BIGINT NOT NULL,
  `collected_at` DATETIME NULL,
  `sent_to_lab_at` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`gate_entry_id`) REFERENCES `gate_entry`(`id`),
  FOREIGN KEY (`collected_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `lab_test` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `sampling_id` BIGINT NOT NULL,
  `moisture_pct` DECIMAL(5, 2) NULL,
  `broken_pct` DECIMAL(5, 2) NULL,
  `fm_pct` DECIMAL(5, 2) NULL,
  `color` VARCHAR(30) NULL,
  `smell` VARCHAR(30) NULL,
  `variety_detected` BIGINT NULL,
  `grain_size` VARCHAR(30) NULL,
  `comment` VARCHAR(500) NULL,
  `verdict` ENUM('accepted', 'rejected', 'negotiation') NOT NULL,
  `tested_by` BIGINT NOT NULL,
  `tested_at` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`sampling_id`) REFERENCES `sampling`(`id`),
  FOREIGN KEY (`variety_detected`) REFERENCES `variety_master`(`id`),
  FOREIGN KEY (`tested_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `negotiation` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `lab_test_id` BIGINT NOT NULL,
  `old_rate` DECIMAL(10, 2) NULL,
  `proposed_rate` DECIMAL(10, 2) NULL,
  `vendor_response` ENUM('accept', 'reject') NULL,
  `negotiated_by` BIGINT NULL,
  `negotiated_at` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`lab_test_id`) REFERENCES `lab_test`(`id`),
  FOREIGN KEY (`negotiated_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `weight_slip` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `gate_entry_id` BIGINT NOT NULL,
  `slip_no` VARCHAR(30) NOT NULL UNIQUE,
  `gross_weight` DECIMAL(10, 2) NOT NULL,
  `tare_weight` DECIMAL(10, 2) NOT NULL,
  `weighed_at` DATETIME NULL,
  `weighbridge_operator_id` BIGINT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`gate_entry_id`) REFERENCES `gate_entry`(`id`),
  FOREIGN KEY (`weighbridge_operator_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `purchase` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `po_id` BIGINT NULL,
  `gate_entry_id` BIGINT NOT NULL,
  `weight_slip_id` BIGINT NOT NULL,
  `final_rate` DECIMAL(10, 2) NOT NULL,
  `final_qty` DECIMAL(12, 2) NOT NULL,
  `amount` DECIMAL(14, 2) NOT NULL,
  `purchase_date` DATE NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`po_id`) REFERENCES `purchase_order`(`id`),
  FOREIGN KEY (`gate_entry_id`) REFERENCES `gate_entry`(`id`),
  FOREIGN KEY (`weight_slip_id`) REFERENCES `weight_slip`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `lots` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `lot_no` VARCHAR(30) NOT NULL UNIQUE,
  `purchase_id` BIGINT NULL,  -- null for production-generated lots
  `material_id` BIGINT NOT NULL,
  `variety_id` BIGINT NULL,
  `qty` DECIMAL(12, 2) NOT NULL DEFAULT 0,  -- ACCEPTED qty only; 0 until unloading is completed
  `parent_lot_id` BIGINT NULL,  -- self-FK: traceability backbone
  `destination` ENUM('warehouse','production') NULL,  -- set via PATCH /api/lots/:id/route
  `warehouse_id` BIGINT NULL,  -- chosen at Start Unloading, before the Stack exists
  `bin_id` BIGINT NULL,
  `unloading_status` ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  `bag_size` DECIMAL(10, 2) NULL,  -- kg per bag, entered at Complete Unloading
  `accepted_bags` INT NULL,
  `rejected_bags` INT NULL DEFAULT 0,
  `rejected_qty` DECIMAL(12, 2) NULL DEFAULT 0,  -- bag_size * rejected_bags, never enters Stack/Inventory
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`purchase_id`) REFERENCES `purchase`(`id`),
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`variety_id`) REFERENCES `variety_master`(`id`),
  FOREIGN KEY (`parent_lot_id`) REFERENCES `lots`(`id`),
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse_master`(`id`),
  FOREIGN KEY (`bin_id`) REFERENCES `bin_stack_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `stacks` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `stack_code` VARCHAR(30) NOT NULL UNIQUE,
  `lot_id` BIGINT NOT NULL,
  `warehouse_id` BIGINT NOT NULL,
  `bin_id` BIGINT NOT NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `stacked_at` DATETIME NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`),
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse_master`(`id`),
  FOREIGN KEY (`bin_id`) REFERENCES `bin_stack_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `inventory` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `lot_id` BIGINT NOT NULL,
  `material_id` BIGINT NOT NULL,
  `warehouse_id` BIGINT NULL,
  `stage` ENUM('raw', 'wip', 'fg', 'by_product') NOT NULL DEFAULT 'raw',  -- split out from ambiguous "warehouse_id/stage" in original doc
  `qty_in` DECIMAL(12, 2) NULL DEFAULT 0,
  `qty_out` DECIMAL(12, 2) NULL DEFAULT 0,
  `balance_qty` DECIMAL(12, 2) NULL DEFAULT 0,
  `as_of` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`),
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`),
  KEY `idx_inventory_lot_id_material_id_stage` (`lot_id`, `material_id`, `stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `production_batch` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_no` VARCHAR(30) NOT NULL UNIQUE,
  `lot_id` BIGINT NOT NULL,
  `process_type` ENUM('dry', 'wet') NOT NULL,  -- note #22
  `input_qty` DECIMAL(12, 2) NOT NULL,
  `production_date` DATE NOT NULL,
  `batch_status` ENUM('pending', 'in_progress', 'completed', 'on_hold') NULL DEFAULT 'pending',  -- renamed from generic "status" to avoid clashing with common record_status
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `quality_check` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `check_level` ENUM('bag', 'lot') NOT NULL,
  `accepted_qty` DECIMAL(12, 2) NULL,
  `rejected_qty` DECIMAL(12, 2) NULL,
  `reason_code_id` BIGINT NULL,
  `action` ENUM('replace', 'refund', 'scrap') NULL,
  `checked_by` BIGINT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`reason_code_id`) REFERENCES `reason_code_master`(`id`),
  FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `dryer` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `machine_id` BIGINT NOT NULL,
  `start_time` DATETIME NULL,
  `end_time` DATETIME NULL,
  `moisture_before` DECIMAL(5, 2) NULL,
  `moisture_after` DECIMAL(5, 2) NULL,
  `recheck_status` ENUM('pending', 'passed', 'failed') NULL DEFAULT 'pending',
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`machine_id`) REFERENCES `machine_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `machine_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `machine_id` BIGINT NOT NULL,
  `operator_id` BIGINT NULL,
  `start_time` DATETIME NULL,
  `end_time` DATETIME NULL,
  `running_hours` DECIMAL(6, 2) NULL,
  `input_qty` DECIMAL(12, 2) NULL,
  `output_qty` DECIMAL(12, 2) NULL,
  `recovery_pct` DECIMAL(5, 2) NULL,
  `downtime_minutes` INT NULL DEFAULT 0,
  `downtime_reason_id` BIGINT NULL,  -- note #1: why it stops
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`machine_id`) REFERENCES `machine_master`(`id`),
  FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`downtime_reason_id`) REFERENCES `reason_code_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `separator_output` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `input_qty` DECIMAL(12, 2) NULL,
  `cleaned_qty` DECIMAL(12, 2) NULL,
  `impurity_qty` DECIMAL(12, 2) NULL,
  `stone_qty` DECIMAL(12, 2) NULL,
  `dust_qty` DECIMAL(12, 2) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `shiner_process` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `stage_no` INT NOT NULL,
  `machine_id` BIGINT NULL,
  `input_qty` DECIMAL(12, 2) NULL,
  `output_qty` DECIMAL(12, 2) NULL,
  `loss_qty` DECIMAL(12, 2) NULL,
  `bran_qty` DECIMAL(12, 2) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`machine_id`) REFERENCES `machine_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `color_sorter` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `input_qty` DECIMAL(12, 2) NULL,
  `good_qty` DECIMAL(12, 2) NULL,
  `rejected_qty` DECIMAL(12, 2) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `length_grading` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `input_qty` DECIMAL(12, 2) NULL,
  `long_qty` DECIMAL(12, 2) NULL,
  `medium_qty` DECIMAL(12, 2) NULL,
  `broken_qty` DECIMAL(12, 2) NULL,
  `small_broken_qty` DECIMAL(12, 2) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `process_time_log` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `stage_name` VARCHAR(50) NOT NULL,
  `stage_start` DATETIME NOT NULL,
  `stage_end` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`),
  KEY `idx_process_time_log_batch_id_stage_name` (`batch_id`, `stage_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `packing` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `batch_id` BIGINT NOT NULL,
  `lot_id` BIGINT NULL,  -- output lot
  `pack_size` DECIMAL(10,2) NOT NULL, -- kg per bag; any positive number (common: 5/10/25/50, or a custom size)
  `bag_count` INT NOT NULL,
  `batch_no` VARCHAR(30) NULL,
  `qr_code` VARCHAR(255) NULL UNIQUE,
  `barcode` VARCHAR(100) NULL UNIQUE,
  `production_date` DATE NULL,
  `expiry_date` DATE NULL,
  `packed_by` BIGINT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`),
  FOREIGN KEY (`packed_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `finished_goods` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `packing_id` BIGINT NOT NULL,
  `warehouse_id` BIGINT NOT NULL,
  `rack_id` VARCHAR(30) NULL,
  `pallet_id` VARCHAR(30) NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `fg_status` ENUM('ready', 'on_hold', 'aging', 'dispatched') NULL DEFAULT 'ready',  -- renamed from generic "status"
  `ready_since` DATETIME NULL,  -- drives the aged_days virtual below — note #24
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`packing_id`) REFERENCES `packing`(`id`),
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouse_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `reject_material` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `source_stage` VARCHAR(50) NOT NULL,
  `batch_id` BIGINT NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `reason_code_id` BIGINT NULL,
  `disposition` ENUM('rework', 'scrap', 'return_to_vendor') NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`reason_code_id`) REFERENCES `reason_code_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `waste_management` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `source_stage` VARCHAR(50) NOT NULL,
  `batch_id` BIGINT NULL,
  `waste_type` ENUM('husk', 'dust', 'stone', 'other') NOT NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `disposal_method` VARCHAR(100) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `production_batch`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `by_product_inventory` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `material_id` BIGINT NOT NULL,  -- husk/bran/broken
  `qty_produced` DECIMAL(12, 2) NULL DEFAULT 0,
  `qty_sold` DECIMAL(12, 2) NULL DEFAULT 0,
  `qty_in_stock` DECIMAL(12, 2) NULL DEFAULT 0,  -- notes #19, #20
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `sales_order` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `so_no` VARCHAR(30) NOT NULL,  -- no longer unique: multiple line items (materials) can share one so_no
  `customer_id` BIGINT NOT NULL,
  `order_type` ENUM('fg', 'by_product') NOT NULL,  -- note #25
  `material_id` BIGINT NOT NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `dispatched_qty` DECIMAL(12, 2) NOT NULL DEFAULT 0,  -- running total loaded across (possibly multiple) trucks
  `rate` DECIMAL(10, 2) NOT NULL,
  `order_date` DATE NOT NULL,
  `so_status` ENUM('pending', 'confirmed', 'allocated', 'dispatched', 'closed', 'cancelled') NULL DEFAULT 'pending',  -- renamed from generic "status"
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`),
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `dispatch` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `so_id` BIGINT NOT NULL,
  `challan_no` VARCHAR(30) NOT NULL UNIQUE,
  `invoice_id` BIGINT NULL,
  `vehicle_id` BIGINT NOT NULL,
  `driver_id` BIGINT NOT NULL,
  `dispatch_weight` DECIMAL(12, 2) NULL,
  `dispatch_time` DATETIME NULL,
  `dispatch_type` ENUM('normal', 'direct_outward') NULL DEFAULT 'normal',  -- note #23: direct outward skips FG warehouse
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`so_id`) REFERENCES `sales_order`(`id`),
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`),
  FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `invoices` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_no` VARCHAR(30) NOT NULL UNIQUE,
  `dispatch_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `amount` DECIMAL(14, 2) NOT NULL,
  `tax` DECIMAL(10, 2) NULL DEFAULT 0,
  `invoice_date` DATE NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`dispatch_id`) REFERENCES `dispatch`(`id`),
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `payments` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_id` BIGINT NOT NULL,
  `amount_paid` DECIMAL(14, 2) NOT NULL,
  `payment_date` DATE NOT NULL,
  `mode` ENUM('cash', 'bank_transfer', 'cheque', 'upi', 'other') NOT NULL,
  `reference_no` VARCHAR(50) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `stock_movement` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `material_id` BIGINT NOT NULL,
  `lot_id` BIGINT NULL,
  `from_location` VARCHAR(100) NULL,
  `to_location` VARCHAR(100) NULL,
  `qty` DECIMAL(12, 2) NOT NULL,
  `movement_type` ENUM('in', 'out', 'transfer') NOT NULL,
  `moved_at` DATETIME NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`material_id`) REFERENCES `material_master`(`id`),
  FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `machine_maintenance` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `machine_id` BIGINT NOT NULL,
  `maintenance_type` ENUM('preventive', 'breakdown') NOT NULL,
  `start_time` DATETIME NULL,
  `end_time` DATETIME NULL,
  `cost` DECIMAL(10, 2) NULL,
  `performed_by` VARCHAR(100) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`machine_id`) REFERENCES `machine_master`(`id`),
  FOREIGN KEY (`plant_id`) REFERENCES `plant_master`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `audit_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `table_name` VARCHAR(50) NOT NULL,
  `record_id` BIGINT NOT NULL,
  `audit_action` ENUM('create', 'update', 'delete') NOT NULL,  -- renamed from "action" (reserved-ish / ambiguous)
  `old_value` JSON NULL,
  `new_value` JSON NULL,
  `performed_by` BIGINT NULL,
  `performed_at` DATETIME NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`performed_by`) REFERENCES `users`(`id`),
  KEY `idx_audit_logs_table_name_record_id` (`table_name`, `record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `notifications` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NULL,
  `role_id` BIGINT NULL,
  `channel` ENUM('app', 'sms', 'whatsapp') NOT NULL,  -- note #11
  `message` TEXT NOT NULL,
  `notif_status` ENUM('pending', 'sent', 'failed') NULL DEFAULT 'pending',  -- renamed from generic "status"
  `sent_at` DATETIME NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Deferred FKs (circular dependencies resolved post-creation)
ALTER TABLE `plant_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `plant_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `roles` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `roles` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `permissions` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `permissions` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `role_permissions` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `role_permissions` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `users` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `users` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `uom_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `uom_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `variety_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `variety_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `material_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `material_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `warehouse_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `warehouse_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `bin_stack_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `bin_stack_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `machine_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `machine_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `rate_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `rate_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `quality_parameter_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `quality_parameter_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `reason_code_master` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `reason_code_master` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `vendors` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `vendors` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `customers` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `customers` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `drivers` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `drivers` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `vehicles` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `vehicles` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `purchase_order` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `purchase_order` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `gate_entry` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `gate_entry` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `sampling` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `sampling` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `lab_test` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `lab_test` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `negotiation` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `negotiation` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `weight_slip` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `weight_slip` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `purchase` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `purchase` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `lots` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `lots` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `stacks` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `stacks` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `inventory` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `inventory` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `production_batch` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `production_batch` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `quality_check` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `quality_check` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `dryer` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `dryer` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `machine_logs` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `machine_logs` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `separator_output` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `separator_output` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `shiner_process` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `shiner_process` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `color_sorter` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `color_sorter` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `length_grading` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `length_grading` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `process_time_log` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `process_time_log` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `packing` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `packing` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `finished_goods` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `finished_goods` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `reject_material` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `reject_material` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `waste_management` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `waste_management` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `by_product_inventory` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `by_product_inventory` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `sales_order` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `sales_order` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `dispatch` ADD FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`);
ALTER TABLE `dispatch` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `dispatch` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `invoices` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `invoices` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `payments` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `payments` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `stock_movement` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `stock_movement` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `machine_maintenance` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `machine_maintenance` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `audit_logs` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `audit_logs` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);
ALTER TABLE `notifications` ADD FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `notifications` ADD FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`);

SET FOREIGN_KEY_CHECKS = 1;