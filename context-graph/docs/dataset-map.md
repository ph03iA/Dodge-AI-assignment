# SAP Order-to-Cash Dataset Map

## Source → Table Mapping

| # | Source Folder | Files | ~Rows | SQL Table | PK |
|---|---|---|---|---|---|
| 1 | `business_partners` | 1 | 8 | `customers` | `business_partner` |
| 2 | `business_partner_addresses` | 1 | 8 | `addresses` | `(business_partner, address_id)` |
| 3 | `products` | 2 | 69 | `products` | `product` |
| 4 | `product_descriptions` | 2 | 69 | `product_descriptions` | `(product, language)` |
| 5 | `plants` | 1 | 44 | `plants` | `plant` |
| 6 | `sales_order_headers` | 1 | 100 | `sales_orders` | `sales_order` |
| 7 | `sales_order_items` | 2 | 167 | `sales_order_items` | `(sales_order, sales_order_item)` |
| 8 | `outbound_delivery_headers` | 1 | 86 | `deliveries` | `delivery_document` |
| 9 | `outbound_delivery_items` | 2 | 137 | `delivery_items` | `(delivery_document, delivery_document_item)` |
| 10 | `billing_document_headers` | 2 | 163 | `billing_documents` | `billing_document` |
| 11 | `billing_document_items` | 2 | 245 | `billing_document_items` | `(billing_document, billing_document_item)` |
| 12 | `journal_entry_items_accounts_receivable` | 4 | 123 | `journal_entries` | `(company_code, fiscal_year, accounting_document, accounting_document_item)` |
| 13 | `payments_accounts_receivable` | 1 | 120 | `payments` | `(company_code, fiscal_year, accounting_document, accounting_document_item)` |

## Optional / Enrichment Tables

| Source Folder | Files | Rows | Notes |
|---|---|---|---|
| `sales_order_schedule_lines` | 2 | 179 | FK to sales_order_items |
| `billing_document_cancellations` | 1 | 80 | Subset of billing headers |
| `customer_company_assignments` | 1 | 8 | Company-level customer config |
| `customer_sales_area_assignments` | 1 | 28 | Sales area config |
| `product_plants` | 4 | 3,036 | Product–plant links |
| `product_storage_locations` | 18 | 16,723 | Storage location data |

## O2C Chain — Join Keys

```
Customer (business_partner / soldToParty)
    │
    ▼
Sales Order (salesOrder) ← soldToParty → Customer
    │
    ▼
Sales Order Item (salesOrder + salesOrderItem) ← material → Product
    │
    ▼ referenceSdDocument / referenceSdDocumentItem
Outbound Delivery (deliveryDocument)
    │
    ▼
Delivery Item (deliveryDocument + deliveryDocumentItem) ← referenceSdDocument → Sales Order
    │
    ▼ (billing lines reference the *delivery*, not the SO)
Billing Document (billingDocument) ← soldToParty → Customer
    │                               ← companyCode + fiscalYear + accountingDocument → Journal Entry
    ▼
Billing Document Item (billingDocument + billingDocumentItem) ← referenceSdDocument → **Outbound delivery** (same id as deliveryDocument; not the sales order)
    │
    ▼ companyCode + fiscalYear + accountingDocument
Journal Entry (companyCode + fiscalYear + accountingDocument + item) ← customer → Customer
    │
    ▼ customer + invoiceReference
Payment (companyCode + fiscalYear + accountingDocument + item) ← customer → Customer
```

## Nested Fields

| Field | Entities | Handling |
|---|---|---|
| `creationTime` `{hours,minutes,seconds}` | billing_document_headers, business_partners, outbound_delivery_headers | Flatten to `HH:MM:SS` string |
| `actualGoodsMovementTime` `{hours,minutes,seconds}` | outbound_delivery_headers | Flatten to `HH:MM:SS` string |
