const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const DATA_DIR = path.resolve(__dirname, '..', '..', 'sap-order-to-cash-dataset', 'sap-o2c-data');

// ── Helpers ────────────────────────────────────────────────────

/** Read all part-*.jsonl files from a folder, return parsed rows */
function readJSONLParts(entityFolder) {
  const dir = path.join(DATA_DIR, entityFolder);
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  const rows = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8').trim();
    for (const line of content.split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

/** Clean a value: empty string → null, nested time objects → HH:MM:SS */
function cleanVal(val, key) {
  if (val === '' || val === undefined) return null;
  if (key === 'creationTime' || key === 'actualGoodsMovementTime') {
    if (typeof val === 'object' && val !== null) {
      const h = String(val.hours ?? 0).padStart(2, '0');
      const m = String(val.minutes ?? 0).padStart(2, '0');
      const s = String(val.seconds ?? 0).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
  }
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  return val;
}

/** Clean an entire row */
function cleanRow(row) {
  const cleaned = {};
  for (const [k, v] of Object.entries(row)) {
    cleaned[k] = cleanVal(v, k);
  }
  return cleaned;
}

/** Batch insert helper — builds parameterized query with ON CONFLICT */
async function batchUpsert(tableName, columns, jsonKeys, conflictKeys, rows) {
  if (rows.length === 0) return 0;

  let inserted = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;

    for (const row of batch) {
      const cleaned = cleanRow(row);
      const rowParams = [];
      for (const jk of jsonKeys) {
        params.push(cleaned[jk] ?? null);
        rowParams.push(`$${paramIdx++}`);
      }
      values.push(`(${rowParams.join(', ')})`);
    }

    const conflictCols = conflictKeys.join(', ');
    const updateCols = columns
      .filter(c => !conflictKeys.includes(c))
      .map(c => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const conflictClause = updateCols
      ? `ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`
      : `ON CONFLICT (${conflictCols}) DO NOTHING`;

    const query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${values.join(', ')} ${conflictClause}`;

    await sql(query, params);
    inserted += batch.length;
  }
  return inserted;
}

// ── Table Ingest Functions ─────────────────────────────────────

async function ingestCustomers() {
  const rows = readJSONLParts('business_partners');
  const columns = [
    'business_partner', 'customer', 'category', 'full_name', 'grouping', 'name',
    'correspondence_lang', 'created_by', 'creation_date', 'creation_time',
    'first_name', 'form_of_address', 'industry', 'last_change_date', 'last_name',
    'org_name1', 'org_name2', 'is_blocked', 'is_marked_for_archiving'
  ];
  const jsonKeys = [
    'businessPartner', 'customer', 'businessPartnerCategory', 'businessPartnerFullName',
    'businessPartnerGrouping', 'businessPartnerName', 'correspondenceLanguage',
    'createdByUser', 'creationDate', 'creationTime', 'firstName', 'formOfAddress',
    'industry', 'lastChangeDate', 'lastName', 'organizationBpName1', 'organizationBpName2',
    'businessPartnerIsBlocked', 'isMarkedForArchiving'
  ];
  return batchUpsert('customers', columns, jsonKeys, ['business_partner'], rows);
}

async function ingestAddresses() {
  const rows = readJSONLParts('business_partner_addresses');
  const columns = [
    'business_partner', 'address_id', 'validity_start', 'validity_end', 'address_uuid',
    'time_zone', 'city', 'country', 'po_box', 'po_box_city', 'po_box_country',
    'po_box_region', 'po_box_no_number', 'po_box_lobby', 'po_box_postal_code',
    'postal_code', 'region', 'street', 'tax_jurisdiction', 'transport_zone'
  ];
  const jsonKeys = [
    'businessPartner', 'addressId', 'validityStartDate', 'validityEndDate', 'addressUuid',
    'addressTimeZone', 'cityName', 'country', 'poBox', 'poBoxDeviatingCityName',
    'poBoxDeviatingCountry', 'poBoxDeviatingRegion', 'poBoxIsWithoutNumber', 'poBoxLobbyName',
    'poBoxPostalCode', 'postalCode', 'region', 'streetName', 'taxJurisdiction', 'transportZone'
  ];
  return batchUpsert('addresses', columns, jsonKeys, ['business_partner', 'address_id'], rows);
}

async function ingestProducts() {
  const rows = readJSONLParts('products');
  const columns = [
    'product', 'product_type', 'cross_plant_status', 'cross_plant_status_date',
    'creation_date', 'created_by', 'last_change_date', 'last_change_datetime',
    'is_marked_for_deletion', 'product_old_id', 'gross_weight', 'weight_unit',
    'net_weight', 'product_group', 'base_unit', 'division', 'industry_sector'
  ];
  const jsonKeys = [
    'product', 'productType', 'crossPlantStatus', 'crossPlantStatusValidityDate',
    'creationDate', 'createdByUser', 'lastChangeDate', 'lastChangeDateTime',
    'isMarkedForDeletion', 'productOldId', 'grossWeight', 'weightUnit',
    'netWeight', 'productGroup', 'baseUnit', 'division', 'industrySector'
  ];
  return batchUpsert('products', columns, jsonKeys, ['product'], rows);
}

async function ingestProductDescriptions() {
  const rows = readJSONLParts('product_descriptions');
  const columns = ['product', 'language', 'description'];
  const jsonKeys = ['product', 'language', 'productDescription'];
  return batchUpsert('product_descriptions', columns, jsonKeys, ['product', 'language'], rows);
}

async function ingestPlants() {
  const rows = readJSONLParts('plants');
  const columns = [
    'plant', 'plant_name', 'valuation_area', 'plant_customer', 'plant_supplier',
    'factory_calendar', 'default_purchasing_org', 'sales_organization', 'address_id',
    'plant_category', 'distribution_channel', 'division', 'language', 'is_marked_for_archiving'
  ];
  const jsonKeys = [
    'plant', 'plantName', 'valuationArea', 'plantCustomer', 'plantSupplier',
    'factoryCalendar', 'defaultPurchasingOrganization', 'salesOrganization', 'addressId',
    'plantCategory', 'distributionChannel', 'division', 'language', 'isMarkedForArchiving'
  ];
  return batchUpsert('plants', columns, jsonKeys, ['plant'], rows);
}

async function ingestSalesOrders() {
  const rows = readJSONLParts('sales_order_headers');
  const columns = [
    'sales_order', 'order_type', 'sales_organization', 'distribution_channel', 'division',
    'sales_group', 'sales_office', 'sold_to_party', 'creation_date', 'created_by',
    'last_change_datetime', 'total_net_amount', 'overall_delivery_status',
    'overall_billing_status', 'overall_ref_status', 'transaction_currency',
    'pricing_date', 'requested_delivery_date', 'billing_block', 'delivery_block',
    'incoterms', 'incoterms_location', 'payment_terms', 'credit_check_status'
  ];
  const jsonKeys = [
    'salesOrder', 'salesOrderType', 'salesOrganization', 'distributionChannel',
    'organizationDivision', 'salesGroup', 'salesOffice', 'soldToParty', 'creationDate',
    'createdByUser', 'lastChangeDateTime', 'totalNetAmount', 'overallDeliveryStatus',
    'overallOrdReltdBillgStatus', 'overallSdDocReferenceStatus', 'transactionCurrency',
    'pricingDate', 'requestedDeliveryDate', 'headerBillingBlockReason', 'deliveryBlockReason',
    'incotermsClassification', 'incotermsLocation1', 'customerPaymentTerms', 'totalCreditCheckStatus'
  ];
  return batchUpsert('sales_orders', columns, jsonKeys, ['sales_order'], rows);
}

async function ingestSalesOrderItems() {
  const rows = readJSONLParts('sales_order_items');
  const columns = [
    'sales_order', 'sales_order_item', 'item_category', 'material', 'requested_quantity',
    'quantity_unit', 'transaction_currency', 'net_amount', 'material_group',
    'production_plant', 'storage_location', 'rejection_reason', 'billing_block'
  ];
  const jsonKeys = [
    'salesOrder', 'salesOrderItem', 'salesOrderItemCategory', 'material', 'requestedQuantity',
    'requestedQuantityUnit', 'transactionCurrency', 'netAmount', 'materialGroup',
    'productionPlant', 'storageLocation', 'salesDocumentRjcnReason', 'itemBillingBlockReason'
  ];
  return batchUpsert('sales_order_items', columns, jsonKeys, ['sales_order', 'sales_order_item'], rows);
}

async function ingestDeliveries() {
  const rows = readJSONLParts('outbound_delivery_headers');
  const columns = [
    'delivery_document', 'actual_goods_movement_date', 'actual_goods_movement_time',
    'creation_date', 'creation_time', 'delivery_block', 'general_incompletion_status',
    'billing_block', 'last_change_date', 'goods_movement_status', 'picking_status',
    'proof_of_delivery_status', 'shipping_point'
  ];
  const jsonKeys = [
    'deliveryDocument', 'actualGoodsMovementDate', 'actualGoodsMovementTime',
    'creationDate', 'creationTime', 'deliveryBlockReason', 'hdrGeneralIncompletionStatus',
    'headerBillingBlockReason', 'lastChangeDate', 'overallGoodsMovementStatus',
    'overallPickingStatus', 'overallProofOfDeliveryStatus', 'shippingPoint'
  ];
  return batchUpsert('deliveries', columns, jsonKeys, ['delivery_document'], rows);
}

async function ingestDeliveryItems() {
  const rows = readJSONLParts('outbound_delivery_items');
  const columns = [
    'delivery_document', 'delivery_document_item', 'actual_delivery_quantity', 'batch',
    'quantity_unit', 'billing_block', 'last_change_date', 'plant',
    'reference_sd_document', 'reference_sd_document_item', 'storage_location'
  ];
  const jsonKeys = [
    'deliveryDocument', 'deliveryDocumentItem', 'actualDeliveryQuantity', 'batch',
    'deliveryQuantityUnit', 'itemBillingBlockReason', 'lastChangeDate', 'plant',
    'referenceSdDocument', 'referenceSdDocumentItem', 'storageLocation'
  ];
  return batchUpsert('delivery_items', columns, jsonKeys, ['delivery_document', 'delivery_document_item'], rows);
}

async function ingestBillingDocuments() {
  const rows = readJSONLParts('billing_document_headers');
  const columns = [
    'billing_document', 'billing_type', 'creation_date', 'creation_time',
    'last_change_datetime', 'billing_date', 'is_cancelled', 'cancelled_billing_doc',
    'total_net_amount', 'transaction_currency', 'company_code', 'fiscal_year',
    'accounting_document', 'sold_to_party'
  ];
  const jsonKeys = [
    'billingDocument', 'billingDocumentType', 'creationDate', 'creationTime',
    'lastChangeDateTime', 'billingDocumentDate', 'billingDocumentIsCancelled',
    'cancelledBillingDocument', 'totalNetAmount', 'transactionCurrency',
    'companyCode', 'fiscalYear', 'accountingDocument', 'soldToParty'
  ];
  return batchUpsert('billing_documents', columns, jsonKeys, ['billing_document'], rows);
}

async function ingestBillingDocumentItems() {
  const rows = readJSONLParts('billing_document_items');
  const columns = [
    'billing_document', 'billing_document_item', 'material', 'billing_quantity',
    'quantity_unit', 'net_amount', 'transaction_currency',
    'reference_sd_document', 'reference_sd_document_item'
  ];
  const jsonKeys = [
    'billingDocument', 'billingDocumentItem', 'material', 'billingQuantity',
    'billingQuantityUnit', 'netAmount', 'transactionCurrency',
    'referenceSdDocument', 'referenceSdDocumentItem'
  ];
  return batchUpsert('billing_document_items', columns, jsonKeys, ['billing_document', 'billing_document_item'], rows);
}

async function ingestJournalEntries() {
  const rows = readJSONLParts('journal_entry_items_accounts_receivable');
  const columns = [
    'company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item',
    'gl_account', 'reference_document', 'cost_center', 'profit_center',
    'transaction_currency', 'amount_in_trans_currency', 'company_code_currency',
    'amount_in_cc_currency', 'posting_date', 'document_date', 'document_type',
    'assignment_reference', 'last_change_datetime', 'customer',
    'financial_account_type', 'clearing_date', 'clearing_document', 'clearing_doc_fiscal_year'
  ];
  const jsonKeys = [
    'companyCode', 'fiscalYear', 'accountingDocument', 'accountingDocumentItem',
    'glAccount', 'referenceDocument', 'costCenter', 'profitCenter',
    'transactionCurrency', 'amountInTransactionCurrency', 'companyCodeCurrency',
    'amountInCompanyCodeCurrency', 'postingDate', 'documentDate', 'accountingDocumentType',
    'assignmentReference', 'lastChangeDateTime', 'customer',
    'financialAccountType', 'clearingDate', 'clearingAccountingDocument', 'clearingDocFiscalYear'
  ];
  return batchUpsert('journal_entries', columns, jsonKeys,
    ['company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item'], rows);
}

async function ingestPayments() {
  const rows = readJSONLParts('payments_accounts_receivable');
  const columns = [
    'company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item',
    'clearing_date', 'clearing_document', 'clearing_doc_fiscal_year',
    'amount_in_trans_currency', 'transaction_currency',
    'amount_in_cc_currency', 'company_code_currency', 'customer',
    'invoice_reference', 'invoice_ref_fiscal_year', 'sales_document', 'sales_document_item',
    'posting_date', 'document_date', 'assignment_reference', 'gl_account',
    'financial_account_type', 'profit_center', 'cost_center'
  ];
  const jsonKeys = [
    'companyCode', 'fiscalYear', 'accountingDocument', 'accountingDocumentItem',
    'clearingDate', 'clearingAccountingDocument', 'clearingDocFiscalYear',
    'amountInTransactionCurrency', 'transactionCurrency',
    'amountInCompanyCodeCurrency', 'companyCodeCurrency', 'customer',
    'invoiceReference', 'invoiceReferenceFiscalYear', 'salesDocument', 'salesDocumentItem',
    'postingDate', 'documentDate', 'assignmentReference', 'glAccount',
    'financialAccountType', 'profitCenter', 'costCenter'
  ];
  return batchUpsert('payments', columns, jsonKeys,
    ['company_code', 'fiscal_year', 'accounting_document', 'accounting_document_item'], rows);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('Starting data ingestion...\n');

  // Run schema first
  const schemaSQL = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'schema.sql'), 'utf8');
  // Split by semicolons and run each statement
  const statements = schemaSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`📋 Running schema (${statements.length} statements)...`);
  for (const stmt of statements) {
    await sql(stmt);
  }
  console.log('Schema applied\n');

  // Ingest in dependency order
  const steps = [
    ['customers', ingestCustomers],
    ['addresses', ingestAddresses],
    ['products', ingestProducts],
    ['product_descriptions', ingestProductDescriptions],
    ['plants', ingestPlants],
    ['sales_orders', ingestSalesOrders],
    ['sales_order_items', ingestSalesOrderItems],
    ['deliveries', ingestDeliveries],
    ['delivery_items', ingestDeliveryItems],
    ['billing_documents', ingestBillingDocuments],
    ['billing_document_items', ingestBillingDocumentItems],
    ['journal_entries', ingestJournalEntries],
    ['payments', ingestPayments],
  ];

  const results = {};
  for (const [name, fn] of steps) {
    try {
      const count = await fn();
      results[name] = count;
      console.log(`${name}: ${count} rows`);
    } catch (err) {
      console.error(`${name}: ${err.message}`);
      results[name] = `ERROR: ${err.message}`;
    }
  }

  console.log('\nSummary:');
  console.table(results);
  console.log('\nIngestion complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
