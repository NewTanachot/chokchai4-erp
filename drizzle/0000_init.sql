CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`work_date` text NOT NULL,
	`clock_in` integer NOT NULL,
	`clock_out` integer,
	`source` text DEFAULT 'clock' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attendance_employee_idx` ON `attendance` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `attendance_date_idx` ON `attendance` (`work_date`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`user_name` text,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`entity_label` text,
	`action` text NOT NULL,
	`changes` text,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_logs_at_idx` ON `audit_logs` (`at`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`line_id` text,
	`email` text,
	`shop_name` text,
	`tax_id` text,
	`address` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `doc_sequences` (
	`key` text PRIMARY KEY NOT NULL,
	`last_no` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`nickname` text,
	`position` text,
	`phone` text,
	`line_id` text,
	`national_id` text,
	`birth_date` text,
	`address` text,
	`emergency_name` text,
	`emergency_phone` text,
	`start_date` text,
	`end_date` text,
	`is_active` integer DEFAULT true NOT NULL,
	`pay_type` text DEFAULT 'monthly' NOT NULL,
	`pay_rate` integer DEFAULT 0 NOT NULL,
	`social_security` integer DEFAULT false NOT NULL,
	`bank_name` text,
	`bank_account` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `employees_name_idx` ON `employees` (`first_name`);--> statement-breakpoint
CREATE TABLE `leaves` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`half_day` integer DEFAULT false NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaves_employee_date_unique` ON `leaves` (`employee_id`,`date`) WHERE "leaves"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `leaves_date_idx` ON `leaves` (`date`);--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payroll_runs_period_idx` ON `payroll_runs` (`period_start`);--> statement-breakpoint
CREATE TABLE `payslip_items` (
	`id` text PRIMARY KEY NOT NULL,
	`payslip_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`amount` integer NOT NULL,
	`qty` real,
	`rate` real,
	`auto` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslip_items_payslip_idx` ON `payslip_items` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`employee_name` text NOT NULL,
	`position` text,
	`pay_type` text NOT NULL,
	`pay_rate` integer NOT NULL,
	`stats` text NOT NULL,
	`earnings` integer DEFAULT 0 NOT NULL,
	`deductions` integer DEFAULT 0 NOT NULL,
	`net` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`paid_at` integer,
	`payment_method` text,
	`paid_by` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payslips_run_employee_unique` ON `payslips` (`run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `payslips_employee_idx` ON `payslips` (`employee_id`);--> statement-breakpoint
CREATE TABLE `price_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` integer,
	`new_value` integer NOT NULL,
	`source` text NOT NULL,
	`transaction_id` text,
	`user_id` text,
	`user_name` text,
	`at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_changes_item_idx` ON `price_changes` (`item_type`,`item_id`,`at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text,
	`barcode` text,
	`name` text NOT NULL,
	`category_id` text,
	`brand` text,
	`model` text,
	`spec` text,
	`unit` text DEFAULT 'ชิ้น' NOT NULL,
	`cost_price` integer DEFAULT 0 NOT NULL,
	`sell_price` integer DEFAULT 0 NOT NULL,
	`stock_qty` real DEFAULT 0 NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`track_stock` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`) WHERE "products"."sku" IS NOT NULL AND "products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE TABLE `salary_advances` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`payslip_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `salary_advances_employee_idx` ON `salary_advances` (`employee_id`,`date`);--> statement-breakpoint
CREATE INDEX `salary_advances_payslip_idx` ON `salary_advances` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `service_items` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`default_price` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'ครั้ง' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `service_items_name_idx` ON `service_items` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`type` text NOT NULL,
	`qty` real NOT NULL,
	`unit_cost` integer,
	`transaction_id` text,
	`transaction_item_id` text,
	`note` text,
	`occurred_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_product_idx` ON `stock_movements` (`product_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_tx_idx` ON `stock_movements` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction_items` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_type` text NOT NULL,
	`product_id` text,
	`service_item_id` text,
	`name` text NOT NULL,
	`unit` text,
	`qty` real NOT NULL,
	`unit_price` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`unit_cost` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_item_id`) REFERENCES `service_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transaction_items_tx_idx` ON `transaction_items` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_items_product_idx` ON `transaction_items` (`product_id`);--> statement-breakpoint
CREATE INDEX `transaction_items_service_idx` ON `transaction_items` (`service_item_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`doc_no` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`occurred_at` integer NOT NULL,
	`customer_id` text,
	`contact_name` text,
	`contact_phone` text,
	`vehicle_plate` text,
	`vehicle_model` text,
	`mileage` integer,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`vat_mode` text DEFAULT 'none' NOT NULL,
	`vat_rate` real DEFAULT 0 NOT NULL,
	`vat_amount` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`payment_status` text DEFAULT 'paid' NOT NULL,
	`paid_at` integer,
	`note` text,
	`voided_at` integer,
	`void_reason` text,
	`created_by` text,
	`updated_by` text,
	`voided_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_doc_no_unique` ON `transactions` (`doc_no`);--> statement-breakpoint
CREATE INDEX `transactions_occurred_idx` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_customer_idx` ON `transactions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `transactions_type_occurred_idx` ON `transactions` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_plate_idx` ON `transactions` (`vehicle_plate`);--> statement-breakpoint
CREATE INDEX `transactions_paid_idx` ON `transactions` (`paid_at`);--> statement-breakpoint
CREATE INDEX `transactions_created_by_idx` ON `transactions` (`created_by`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`password_hash` text,
	`employee_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_employee_unique` ON `users` (`employee_id`) WHERE "users"."employee_id" IS NOT NULL AND "users"."deleted_at" IS NULL;