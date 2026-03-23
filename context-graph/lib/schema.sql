-- Context Graph System — Database Schema
-- Run this against your Neon PostgreSQL database

-- ============================================================
-- 1. Customers (from business_partners)
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  business_partner   VARCHAR(20) PRIMARY KEY,
  customer           VARCHAR(20),
  category           VARCHAR(5),
  full_name          TEXT,
  grouping           VARCHAR(10),
  name               TEXT,
  correspondence_lang VARCHAR(5),
  created_by         VARCHAR(20),
  creation_date      TIMESTAMPTZ,
  creation_time      VARCHAR(10),
  first_name         TEXT,
  form_of_address    VARCHAR(10),
  industry           VARCHAR(10),
  last_change_date   TIMESTAMPTZ,
  last_name          TEXT,
  org_name1          TEXT,
  org_name2          TEXT,
  is_blocked         BOOLEAN DEFAULT FALSE,
  is_marked_for_archiving BOOLEAN DEFAULT FALSE
);

-- Align older databases (CREATE TABLE IF NOT EXISTS skips when table shape differs)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS category VARCHAR(5);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS grouping VARCHAR(10);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS correspondence_lang VARCHAR(5);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS creation_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS creation_time VARCHAR(10);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS form_of_address VARCHAR(10);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS industry VARCHAR(10);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_change_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS org_name1 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS org_name2 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_marked_for_archiving BOOLEAN DEFAULT FALSE;

-- Legacy schemas sometimes used json/jsonb for string or time-shaped fields; plain VARCHAR inserts then fail
DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'customers'
      AND c.data_type IN ('json', 'jsonb')
  LOOP
    EXECUTE format(
      'ALTER TABLE customers ALTER COLUMN %I TYPE TEXT USING (CASE WHEN %I IS NULL THEN NULL ELSE (%I::jsonb)::text END)',
      col,
      col,
      col
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_customer ON customers(customer);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- ============================================================
-- 2. Addresses (from business_partner_addresses)
-- ============================================================
CREATE TABLE IF NOT EXISTS addresses (
  business_partner   VARCHAR(20) NOT NULL REFERENCES customers(business_partner) ON DELETE NO ACTION,
  address_id         VARCHAR(20) NOT NULL,
  validity_start     TIMESTAMPTZ,
  validity_end       TIMESTAMPTZ,
  address_uuid       VARCHAR(50),
  time_zone          VARCHAR(10),
  city               TEXT,
  country            VARCHAR(5),
  po_box             VARCHAR(20),
  po_box_city        TEXT,
  po_box_country     VARCHAR(5),
  po_box_region      VARCHAR(10),
  po_box_no_number   BOOLEAN,
  po_box_lobby       TEXT,
  po_box_postal_code VARCHAR(20),
  postal_code        VARCHAR(20),
  region             VARCHAR(10),
  street             TEXT,
  tax_jurisdiction   VARCHAR(20),
  transport_zone     VARCHAR(10),
  PRIMARY KEY (business_partner, address_id)
);

CREATE INDEX IF NOT EXISTS idx_addresses_bp ON addresses(business_partner);

-- ============================================================
-- 3. Products (from products)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  product            VARCHAR(40) PRIMARY KEY,
  product_type       VARCHAR(10),
  cross_plant_status VARCHAR(5),
  cross_plant_status_date TIMESTAMPTZ,
  creation_date      TIMESTAMPTZ,
  created_by         VARCHAR(20),
  last_change_date   TIMESTAMPTZ,
  last_change_datetime TEXT,
  is_marked_for_deletion BOOLEAN DEFAULT FALSE,
  product_old_id     VARCHAR(40),
  gross_weight       DECIMAL(15,3),
  weight_unit        VARCHAR(5),
  net_weight         DECIMAL(15,3),
  product_group      VARCHAR(20),
  base_unit          VARCHAR(5),
  division           VARCHAR(5),
  industry_sector    VARCHAR(5)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(10);
ALTER TABLE products ADD COLUMN IF NOT EXISTS cross_plant_status VARCHAR(5);
ALTER TABLE products ADD COLUMN IF NOT EXISTS cross_plant_status_date TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS creation_date TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_change_date TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_change_datetime TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_marked_for_deletion BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_old_id VARCHAR(40);
ALTER TABLE products ADD COLUMN IF NOT EXISTS gross_weight DECIMAL(15,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(5);
ALTER TABLE products ADD COLUMN IF NOT EXISTS net_weight DECIMAL(15,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_group VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_unit VARCHAR(5);
ALTER TABLE products ADD COLUMN IF NOT EXISTS division VARCHAR(5);
ALTER TABLE products ADD COLUMN IF NOT EXISTS industry_sector VARCHAR(5);

-- ============================================================
-- 4. Product Descriptions (from product_descriptions)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_descriptions (
  product            VARCHAR(40) NOT NULL REFERENCES products(product) ON DELETE NO ACTION,
  language           VARCHAR(5) NOT NULL,
  description        TEXT,
  PRIMARY KEY (product, language)
);

ALTER TABLE product_descriptions ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_prod_desc_product ON product_descriptions(product);

-- ============================================================
-- 5. Plants (from plants)
-- ============================================================
CREATE TABLE IF NOT EXISTS plants (
  plant              VARCHAR(10) PRIMARY KEY,
  plant_name         TEXT,
  valuation_area     VARCHAR(10),
  plant_customer     VARCHAR(20),
  plant_supplier     VARCHAR(20),
  factory_calendar   VARCHAR(5),
  default_purchasing_org VARCHAR(10),
  sales_organization VARCHAR(10),
  address_id         VARCHAR(20),
  plant_category     VARCHAR(5),
  distribution_channel VARCHAR(5),
  division           VARCHAR(5),
  language           VARCHAR(5),
  is_marked_for_archiving BOOLEAN DEFAULT FALSE
);

ALTER TABLE plants ADD COLUMN IF NOT EXISTS default_purchasing_org VARCHAR(10);

-- ============================================================
-- 6. Sales Orders (from sales_order_headers)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_orders (
  sales_order        VARCHAR(20) PRIMARY KEY,
  order_type         VARCHAR(10),
  sales_organization VARCHAR(10),
  distribution_channel VARCHAR(5),
  division           VARCHAR(5),
  sales_group        VARCHAR(10),
  sales_office       VARCHAR(10),
  sold_to_party      VARCHAR(20),
  creation_date      TIMESTAMPTZ,
  created_by         VARCHAR(20),
  last_change_datetime TEXT,
  total_net_amount   DECIMAL(15,2),
  overall_delivery_status VARCHAR(5),
  overall_billing_status VARCHAR(5),
  overall_ref_status VARCHAR(5),
  transaction_currency VARCHAR(5),
  pricing_date       TIMESTAMPTZ,
  requested_delivery_date TIMESTAMPTZ,
  billing_block      VARCHAR(5),
  delivery_block     VARCHAR(5),
  incoterms          VARCHAR(5),
  incoterms_location TEXT,
  payment_terms      VARCHAR(10),
  credit_check_status VARCHAR(5)
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_sold_to ON sales_orders(sold_to_party);
CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(creation_date);

-- ============================================================
-- 7. Sales Order Items (from sales_order_items)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_order_items (
  sales_order        VARCHAR(20) NOT NULL REFERENCES sales_orders(sales_order) ON DELETE NO ACTION,
  sales_order_item   VARCHAR(10) NOT NULL,
  item_category      VARCHAR(10),
  material           VARCHAR(40),
  requested_quantity DECIMAL(15,3),
  quantity_unit      VARCHAR(5),
  transaction_currency VARCHAR(5),
  net_amount         DECIMAL(15,2),
  material_group     VARCHAR(20),
  production_plant   VARCHAR(10),
  storage_location   VARCHAR(10),
  rejection_reason   VARCHAR(5),
  billing_block      VARCHAR(5),
  PRIMARY KEY (sales_order, sales_order_item)
);

ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS item_category VARCHAR(10);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS material VARCHAR(40);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS requested_quantity DECIMAL(15,3);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(5);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS transaction_currency VARCHAR(5);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS net_amount DECIMAL(15,2);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS material_group VARCHAR(20);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS production_plant VARCHAR(10);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS storage_location VARCHAR(10);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(5);
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS billing_block VARCHAR(5);

CREATE INDEX IF NOT EXISTS idx_soi_order ON sales_order_items(sales_order);
CREATE INDEX IF NOT EXISTS idx_soi_material ON sales_order_items(material);

-- ============================================================
-- 8. Deliveries (from outbound_delivery_headers)
-- ============================================================
CREATE TABLE IF NOT EXISTS deliveries (
  delivery_document  VARCHAR(20) PRIMARY KEY,
  actual_goods_movement_date TIMESTAMPTZ,
  actual_goods_movement_time VARCHAR(10),
  creation_date      TIMESTAMPTZ,
  creation_time      VARCHAR(10),
  delivery_block     VARCHAR(5),
  general_incompletion_status VARCHAR(5),
  billing_block      VARCHAR(5),
  last_change_date   TIMESTAMPTZ,
  goods_movement_status VARCHAR(5),
  picking_status     VARCHAR(5),
  proof_of_delivery_status VARCHAR(5),
  shipping_point     VARCHAR(10)
);

-- ============================================================
-- 9. Delivery Items (from outbound_delivery_items)
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_items (
  delivery_document  VARCHAR(20) NOT NULL REFERENCES deliveries(delivery_document) ON DELETE NO ACTION,
  delivery_document_item VARCHAR(10) NOT NULL,
  actual_delivery_quantity DECIMAL(15,3),
  batch              VARCHAR(20),
  quantity_unit      VARCHAR(5),
  billing_block      VARCHAR(5),
  last_change_date   TIMESTAMPTZ,
  plant              VARCHAR(10),
  reference_sd_document VARCHAR(20),
  reference_sd_document_item VARCHAR(10),
  storage_location   VARCHAR(10),
  PRIMARY KEY (delivery_document, delivery_document_item)
);

CREATE INDEX IF NOT EXISTS idx_di_delivery ON delivery_items(delivery_document);
CREATE INDEX IF NOT EXISTS idx_di_ref_sd ON delivery_items(reference_sd_document);
CREATE INDEX IF NOT EXISTS idx_di_ref_sd_item ON delivery_items(reference_sd_document, reference_sd_document_item);

-- ============================================================
-- 10. Billing Documents (from billing_document_headers)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_documents (
  billing_document   VARCHAR(20) PRIMARY KEY,
  billing_type       VARCHAR(10),
  creation_date      TIMESTAMPTZ,
  creation_time      VARCHAR(10),
  last_change_datetime TEXT,
  billing_date       TIMESTAMPTZ,
  is_cancelled       BOOLEAN DEFAULT FALSE,
  cancelled_billing_doc VARCHAR(20),
  total_net_amount   DECIMAL(15,2),
  transaction_currency VARCHAR(5),
  company_code       VARCHAR(10),
  fiscal_year        VARCHAR(4),
  accounting_document VARCHAR(20),
  sold_to_party      VARCHAR(20)
);

ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS billing_type VARCHAR(10);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS creation_date TIMESTAMPTZ;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS creation_time VARCHAR(10);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS last_change_datetime TEXT;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS billing_date TIMESTAMPTZ;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE;
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS cancelled_billing_doc VARCHAR(20);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS total_net_amount DECIMAL(15,2);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS transaction_currency VARCHAR(5);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS company_code VARCHAR(10);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(4);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS accounting_document VARCHAR(20);
ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS sold_to_party VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_bd_sold_to ON billing_documents(sold_to_party);
CREATE INDEX IF NOT EXISTS idx_bd_acct_doc ON billing_documents(company_code, fiscal_year, accounting_document);
CREATE INDEX IF NOT EXISTS idx_bd_date ON billing_documents(creation_date);

-- ============================================================
-- 11. Billing Document Items (from billing_document_items)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_document_items (
  billing_document   VARCHAR(20) NOT NULL REFERENCES billing_documents(billing_document) ON DELETE NO ACTION,
  billing_document_item VARCHAR(10) NOT NULL,
  material           VARCHAR(40),
  billing_quantity   DECIMAL(15,3),
  quantity_unit      VARCHAR(5),
  net_amount         DECIMAL(15,2),
  transaction_currency VARCHAR(5),
  reference_sd_document VARCHAR(20),
  reference_sd_document_item VARCHAR(10),
  PRIMARY KEY (billing_document, billing_document_item)
);

ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(5);
ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS material VARCHAR(40);
ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS billing_quantity DECIMAL(15,3);
ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS net_amount DECIMAL(15,2);
ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS transaction_currency VARCHAR(5);
ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS reference_sd_document VARCHAR(20);
ALTER TABLE billing_document_items ADD COLUMN IF NOT EXISTS reference_sd_document_item VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_bdi_doc ON billing_document_items(billing_document);
CREATE INDEX IF NOT EXISTS idx_bdi_material ON billing_document_items(material);
CREATE INDEX IF NOT EXISTS idx_bdi_ref_sd ON billing_document_items(reference_sd_document);

-- ============================================================
-- 12. Journal Entries (from journal_entry_items_accounts_receivable)
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  company_code       VARCHAR(10) NOT NULL,
  fiscal_year        VARCHAR(4) NOT NULL,
  accounting_document VARCHAR(20) NOT NULL,
  accounting_document_item VARCHAR(10) NOT NULL,
  gl_account         VARCHAR(20),
  reference_document VARCHAR(20),
  cost_center        VARCHAR(20),
  profit_center      VARCHAR(20),
  transaction_currency VARCHAR(5),
  amount_in_trans_currency DECIMAL(15,2),
  company_code_currency VARCHAR(5),
  amount_in_cc_currency DECIMAL(15,2),
  posting_date       TIMESTAMPTZ,
  document_date      TIMESTAMPTZ,
  document_type      VARCHAR(5),
  assignment_reference VARCHAR(30),
  last_change_datetime TEXT,
  customer           VARCHAR(20),
  financial_account_type VARCHAR(5),
  clearing_date      TIMESTAMPTZ,
  clearing_document  VARCHAR(20),
  clearing_doc_fiscal_year VARCHAR(4),
  PRIMARY KEY (company_code, fiscal_year, accounting_document, accounting_document_item)
);

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS company_code VARCHAR(10);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(4);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS accounting_document VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS accounting_document_item VARCHAR(10);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS gl_account VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reference_document VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS cost_center VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS profit_center VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS transaction_currency VARCHAR(5);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS amount_in_trans_currency DECIMAL(15,2);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS company_code_currency VARCHAR(5);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS amount_in_cc_currency DECIMAL(15,2);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS posting_date TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS document_date TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS document_type VARCHAR(5);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS assignment_reference VARCHAR(30);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS last_change_datetime TEXT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS customer VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS financial_account_type VARCHAR(5);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS clearing_date TIMESTAMPTZ;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS clearing_document VARCHAR(20);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS clearing_doc_fiscal_year VARCHAR(4);

CREATE INDEX IF NOT EXISTS idx_je_acct_doc ON journal_entries(company_code, fiscal_year, accounting_document);
CREATE INDEX IF NOT EXISTS idx_je_customer ON journal_entries(customer);
CREATE INDEX IF NOT EXISTS idx_je_ref_doc ON journal_entries(reference_document);

-- ============================================================
-- 13. Payments (from payments_accounts_receivable)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  company_code       VARCHAR(10) NOT NULL,
  fiscal_year        VARCHAR(4) NOT NULL,
  accounting_document VARCHAR(20) NOT NULL,
  accounting_document_item VARCHAR(10) NOT NULL,
  clearing_date      TIMESTAMPTZ,
  clearing_document  VARCHAR(20),
  clearing_doc_fiscal_year VARCHAR(4),
  amount_in_trans_currency DECIMAL(15,2),
  transaction_currency VARCHAR(5),
  amount_in_cc_currency DECIMAL(15,2),
  company_code_currency VARCHAR(5),
  customer           VARCHAR(20),
  invoice_reference  VARCHAR(20),
  invoice_ref_fiscal_year VARCHAR(4),
  sales_document     VARCHAR(20),
  sales_document_item VARCHAR(10),
  posting_date       TIMESTAMPTZ,
  document_date      TIMESTAMPTZ,
  assignment_reference VARCHAR(30),
  gl_account         VARCHAR(20),
  financial_account_type VARCHAR(5),
  profit_center      VARCHAR(20),
  cost_center        VARCHAR(20),
  PRIMARY KEY (company_code, fiscal_year, accounting_document, accounting_document_item)
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_code VARCHAR(10);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS accounting_document VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS accounting_document_item VARCHAR(10);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clearing_date TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clearing_document VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS clearing_doc_fiscal_year VARCHAR(4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_in_trans_currency DECIMAL(15,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_currency VARCHAR(5);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_in_cc_currency DECIMAL(15,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_code_currency VARCHAR(5);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_reference VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_ref_fiscal_year VARCHAR(4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sales_document VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sales_document_item VARCHAR(10);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS posting_date TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS document_date TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS assignment_reference VARCHAR(30);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gl_account VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS financial_account_type VARCHAR(5);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS profit_center VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cost_center VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer);
CREATE INDEX IF NOT EXISTS idx_pay_invoice_ref ON payments(invoice_reference);
CREATE INDEX IF NOT EXISTS idx_pay_sales_doc ON payments(sales_document);
CREATE INDEX IF NOT EXISTS idx_pay_acct_doc ON payments(company_code, fiscal_year, accounting_document);

-- ============================================================
-- 14. Billing document cancellations (from billing_document_cancellations)
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_document_cancellations (
  billing_document   VARCHAR(20) PRIMARY KEY,
  billing_type       VARCHAR(10),
  creation_date      TIMESTAMPTZ,
  creation_time      VARCHAR(10),
  last_change_datetime TEXT,
  billing_date       TIMESTAMPTZ,
  billing_is_cancelled BOOLEAN DEFAULT TRUE,
  cancelled_billing_doc VARCHAR(20),
  total_net_amount   DECIMAL(15,2),
  transaction_currency VARCHAR(5),
  company_code       VARCHAR(10),
  fiscal_year        VARCHAR(4),
  accounting_document VARCHAR(20),
  sold_to_party      VARCHAR(20)
);

ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS billing_type VARCHAR(10);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS creation_date TIMESTAMPTZ;
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS creation_time VARCHAR(10);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS last_change_datetime TEXT;
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS billing_date TIMESTAMPTZ;
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS billing_is_cancelled BOOLEAN DEFAULT TRUE;
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS cancelled_billing_doc VARCHAR(20);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS total_net_amount DECIMAL(15,2);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS transaction_currency VARCHAR(5);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS company_code VARCHAR(10);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS fiscal_year VARCHAR(4);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS accounting_document VARCHAR(20);
ALTER TABLE billing_document_cancellations ADD COLUMN IF NOT EXISTS sold_to_party VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_bdc_sold_to ON billing_document_cancellations(sold_to_party);
CREATE INDEX IF NOT EXISTS idx_bdc_acct ON billing_document_cancellations(company_code, fiscal_year, accounting_document);

-- ============================================================
-- 15. Customer ↔ company (from customer_company_assignments)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_company_assignments (
  customer           VARCHAR(20) NOT NULL REFERENCES customers(business_partner) ON DELETE NO ACTION,
  company_code       VARCHAR(10) NOT NULL,
  accounting_clerk   TEXT,
  accounting_clerk_fax TEXT,
  accounting_clerk_email TEXT,
  accounting_clerk_phone TEXT,
  alternative_payer_account VARCHAR(20),
  payment_blocking_reason VARCHAR(10),
  payment_methods_list TEXT,
  payment_terms      VARCHAR(10),
  reconciliation_account VARCHAR(20),
  deletion_indicator BOOLEAN DEFAULT FALSE,
  customer_account_group VARCHAR(10),
  PRIMARY KEY (customer, company_code)
);

CREATE INDEX IF NOT EXISTS idx_cca_company ON customer_company_assignments(company_code);

-- ============================================================
-- 16. Customer ↔ sales area (from customer_sales_area_assignments)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_sales_area_assignments (
  customer           VARCHAR(20) NOT NULL REFERENCES customers(business_partner) ON DELETE NO ACTION,
  sales_organization VARCHAR(10) NOT NULL,
  distribution_channel VARCHAR(5) NOT NULL,
  division           VARCHAR(5) NOT NULL,
  billing_blocked    VARCHAR(5),
  complete_delivery_defined BOOLEAN,
  credit_control_area VARCHAR(10),
  currency           VARCHAR(5),
  customer_payment_terms VARCHAR(10),
  delivery_priority  VARCHAR(5),
  incoterms          VARCHAR(10),
  incoterms_location TEXT,
  sales_group        VARCHAR(10),
  sales_office       VARCHAR(10),
  shipping_condition VARCHAR(5),
  sls_unlimited_overdelivery BOOLEAN,
  supplying_plant    VARCHAR(10),
  sales_district     VARCHAR(10),
  exchange_rate_type VARCHAR(5),
  PRIMARY KEY (customer, sales_organization, distribution_channel, division)
);

CREATE INDEX IF NOT EXISTS idx_csaa_customer ON customer_sales_area_assignments(customer);

-- ============================================================
-- 17. Sales order schedule lines (from sales_order_schedule_lines)
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_order_schedule_lines (
  sales_order        VARCHAR(20) NOT NULL,
  sales_order_item   VARCHAR(10) NOT NULL,
  schedule_line      VARCHAR(10) NOT NULL,
  confirmed_delivery_date TIMESTAMPTZ,
  order_quantity_unit VARCHAR(5),
  confirmed_order_qty DECIMAL(15,3),
  PRIMARY KEY (sales_order, sales_order_item, schedule_line),
  FOREIGN KEY (sales_order, sales_order_item) REFERENCES sales_order_items(sales_order, sales_order_item) ON DELETE NO ACTION
);

ALTER TABLE sales_order_schedule_lines ADD COLUMN IF NOT EXISTS confirmed_delivery_date TIMESTAMPTZ;
ALTER TABLE sales_order_schedule_lines ADD COLUMN IF NOT EXISTS order_quantity_unit VARCHAR(5);
ALTER TABLE sales_order_schedule_lines ADD COLUMN IF NOT EXISTS confirmed_order_qty DECIMAL(15,3);

CREATE INDEX IF NOT EXISTS idx_sosl_order ON sales_order_schedule_lines(sales_order);

-- ============================================================
-- 18. Product ↔ plant (from product_plants)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_plants (
  product            VARCHAR(40) NOT NULL REFERENCES products(product) ON DELETE NO ACTION,
  plant              VARCHAR(10) NOT NULL REFERENCES plants(plant) ON DELETE NO ACTION,
  country_of_origin  VARCHAR(5),
  region_of_origin   VARCHAR(10),
  production_invtry_managed_loc VARCHAR(20),
  availability_check_type VARCHAR(5),
  fiscal_year_variant VARCHAR(5),
  profit_center      VARCHAR(20),
  mrp_type           VARCHAR(5),
  PRIMARY KEY (product, plant)
);

ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS country_of_origin VARCHAR(5);
ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS region_of_origin VARCHAR(10);
ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS production_invtry_managed_loc VARCHAR(20);
ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS availability_check_type VARCHAR(5);
ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS fiscal_year_variant VARCHAR(5);
ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS profit_center VARCHAR(20);
ALTER TABLE product_plants ADD COLUMN IF NOT EXISTS mrp_type VARCHAR(5);

CREATE INDEX IF NOT EXISTS idx_pp_plant ON product_plants(plant);

-- ============================================================
-- 19. Product storage locations (from product_storage_locations)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_storage_locations (
  product            VARCHAR(40) NOT NULL REFERENCES products(product) ON DELETE NO ACTION,
  plant              VARCHAR(10) NOT NULL REFERENCES plants(plant) ON DELETE NO ACTION,
  storage_location   VARCHAR(10) NOT NULL,
  physical_inventory_block VARCHAR(5),
  date_last_posted_count_unrestricted TIMESTAMPTZ,
  PRIMARY KEY (product, plant, storage_location)
);

ALTER TABLE product_storage_locations ADD COLUMN IF NOT EXISTS physical_inventory_block VARCHAR(5);
ALTER TABLE product_storage_locations ADD COLUMN IF NOT EXISTS date_last_posted_count_unrestricted TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_psl_plant ON product_storage_locations(plant);
