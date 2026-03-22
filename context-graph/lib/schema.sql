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

-- ============================================================
-- 4. Product Descriptions (from product_descriptions)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_descriptions (
  product            VARCHAR(40) NOT NULL REFERENCES products(product) ON DELETE NO ACTION,
  language           VARCHAR(5) NOT NULL,
  description        TEXT,
  PRIMARY KEY (product, language)
);

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

CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer);
CREATE INDEX IF NOT EXISTS idx_pay_invoice_ref ON payments(invoice_reference);
CREATE INDEX IF NOT EXISTS idx_pay_sales_doc ON payments(sales_document);
CREATE INDEX IF NOT EXISTS idx_pay_acct_doc ON payments(company_code, fiscal_year, accounting_document);
