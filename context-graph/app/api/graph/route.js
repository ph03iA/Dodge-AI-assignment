import { NextResponse } from 'next/server';
import sql, { isMissingSchemaError } from '@/lib/db';
import { buildGraph } from '@/lib/graphBuilder';
import { OVERVIEW_MAX_PRODUCT_STORAGE_LOCS } from '@/lib/graphLimits';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const seed = searchParams.get('seed');       // e.g. "740506" (sales order id)
    const seedType = searchParams.get('type');   // e.g. "sales_order"
    const depth = parseInt(searchParams.get('depth') || '1', 10);

    let data = {};

    if (seed && seedType) {
      // Strategy B: seed-based neighborhood loading
      switch (seedType) {
        case 'sales_order': {
          data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ${seed}`;
          const so = data.salesOrders[0];
          if (so) {
            data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${so.sold_to_party}`;
            data.salesOrderItems = await sql`SELECT * FROM sales_order_items WHERE sales_order = ${seed}`;
            data.deliveryItems = await sql`SELECT * FROM delivery_items WHERE reference_sd_document = ${seed}`;
            const dIds = [...new Set(data.deliveryItems.map(di => di.delivery_document))];
            if (dIds.length) data.deliveries = await sql`SELECT * FROM deliveries WHERE delivery_document = ANY(${dIds})`;
            // billing_items.reference_sd_document points to delivery, not SO - need to use delivery IDs
            if (dIds.length) {
              data.billingItems = await sql`SELECT * FROM billing_document_items WHERE reference_sd_document = ANY(${dIds})`;
              const bIds = [...new Set(data.billingItems.map(bi => bi.billing_document))];
              if (bIds.length) {
                data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ANY(${bIds})`;
              }
            }
            if (depth >= 2) {
              for (const bd of data.billingDocuments) {
                if (bd.accounting_document) {
                  const jes = await sql`SELECT * FROM journal_entries WHERE company_code = ${bd.company_code} AND fiscal_year = ${bd.fiscal_year} AND accounting_document = ${bd.accounting_document}`;
                  data.journalEntries = [...(data.journalEntries || []), ...jes];
                }
              }
            }
            const mats = [...new Set(data.salesOrderItems.map(i => i.material).filter(Boolean))];
            if (mats.length) {
              data.products = await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ANY(${mats})`;
              data.productPlants = await sql`SELECT * FROM product_plants WHERE product = ANY(${mats})`;
              data.productStorageLocations =
                await sql`SELECT * FROM product_storage_locations WHERE product = ANY(${mats}) LIMIT ${OVERVIEW_MAX_PRODUCT_STORAGE_LOCS}`;
              const plantIds = [
                ...new Set([
                  ...(data.productPlants || []).map((p) => p.plant),
                  ...(data.productStorageLocations || []).map((p) => p.plant),
                ]),
              ].filter(Boolean);
              if (plantIds.length) {
                data.plants = await sql`SELECT * FROM plants WHERE plant = ANY(${plantIds})`;
              }
            }
            data.salesOrderScheduleLines =
              await sql`SELECT * FROM sales_order_schedule_lines WHERE sales_order = ${seed}`;
          }
          break;
        }
        case 'customer': {
          data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${seed}`;
          data.addresses = await sql`SELECT * FROM addresses WHERE business_partner = ${seed}`;
          data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sold_to_party = ${seed} LIMIT 10`;
          data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE sold_to_party = ${seed} LIMIT 10`;
          data.customerCompanyAssignments =
            await sql`SELECT * FROM customer_company_assignments WHERE customer = ${seed}`;
          data.customerSalesAreaAssignments =
            await sql`SELECT * FROM customer_sales_area_assignments WHERE customer = ${seed}`;
          break;
        }
        case 'billing': {
          data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ${seed}`;
          data.billingItems = await sql`SELECT * FROM billing_document_items WHERE billing_document = ${seed}`;
          data.billingDocumentCancellations = await sql`
            SELECT * FROM billing_document_cancellations
            WHERE billing_document = ${seed} OR cancelled_billing_doc = ${seed}
            LIMIT 25`;
          const bd = data.billingDocuments[0];
          if (bd) {
            if (bd.sold_to_party) data.customers = await sql`SELECT * FROM customers WHERE business_partner = ${bd.sold_to_party}`;
            if (bd.accounting_document) {
              data.journalEntries = await sql`SELECT * FROM journal_entries WHERE company_code = ${bd.company_code} AND fiscal_year = ${bd.fiscal_year} AND accounting_document = ${bd.accounting_document}`;
            }
            // billing_items.reference_sd_document = delivery_document, need to get sales_order via delivery_items
            const deliveryIds = [...new Set(data.billingItems.map(bi => bi.reference_sd_document).filter(Boolean))];
            if (deliveryIds.length) {
              const diRows = await sql`SELECT DISTINCT reference_sd_document FROM delivery_items WHERE delivery_document = ANY(${deliveryIds})`;
              const soIds = diRows.map(r => r.reference_sd_document).filter(Boolean);
              if (soIds.length) data.salesOrders = await sql`SELECT * FROM sales_orders WHERE sales_order = ANY(${soIds})`;
            }
          }
          break;
        }
        default:
          return NextResponse.json({ error: `Unknown seed type: ${seedType}` }, { status: 400 });
      }
    } else {
      // Optimized: Load sample of entities for fast initial render, expand on demand
      data.customers = await sql`SELECT * FROM customers`;
      data.salesOrders = await sql`SELECT * FROM sales_orders`;
      data.salesOrderItems = await sql`SELECT soi.* FROM sales_order_items soi INNER JOIN sales_orders so ON soi.sales_order = so.sales_order`;
      data.deliveries = await sql`SELECT DISTINCT d.* FROM deliveries d INNER JOIN delivery_items di ON d.delivery_document = di.delivery_document`;
      data.deliveryItems = await sql`SELECT di.* FROM delivery_items di`;
      const deliveryIds = [...new Set((data.deliveryItems || []).map(di => di.delivery_document).filter(Boolean))];
      if (deliveryIds.length > 0) {
        data.billingItems = await sql`SELECT * FROM billing_document_items WHERE reference_sd_document = ANY(${deliveryIds})`;
        const billingIds = [...new Set((data.billingItems || []).map(bi => bi.billing_document).filter(Boolean))];
        if (billingIds.length > 0) {
          data.billingDocuments = await sql`SELECT * FROM billing_documents WHERE billing_document = ANY(${billingIds})`;
        }
      } else {
        data.billingItems = [];
        data.billingDocuments = [];
      }
      data.salesOrderScheduleLines = await sql`SELECT sol.* FROM sales_order_schedule_lines sol`;
      const custIds = [...new Set(data.customers.map((c) => c.business_partner).filter(Boolean))];
      if (custIds.length) {
        data.customerCompanyAssignments =
          await sql`SELECT * FROM customer_company_assignments WHERE customer = ANY(${custIds})`;
        data.customerSalesAreaAssignments =
          await sql`SELECT * FROM customer_sales_area_assignments WHERE customer = ANY(${custIds})`;
      }
      data.billingDocumentCancellations = await sql`SELECT * FROM billing_document_cancellations`;
      data.plants = await sql`SELECT * FROM plants`;
      const mats = [...new Set(data.salesOrderItems.map((i) => i.material).filter(Boolean))];
      if (mats.length) {
        data.products = await sql`SELECT p.*, pd.description FROM products p LEFT JOIN product_descriptions pd ON p.product = pd.product AND pd.language = 'EN' WHERE p.product = ANY(${mats})`;
        data.productPlants = await sql`SELECT * FROM product_plants WHERE product = ANY(${mats})`;
        data.productStorageLocations =
          await sql`SELECT * FROM product_storage_locations WHERE product = ANY(${mats}) LIMIT ${OVERVIEW_MAX_PRODUCT_STORAGE_LOCS}`;
      }
      // Journal lines for loaded billings: tie via FI triple (matches graphBuilder / ingest), not only reference_document
      if (data.billingDocuments && data.billingDocuments.length > 0) {
        const bdIds = data.billingDocuments.map((bd) => bd.billing_document);
        data.journalEntries = await sql`
          SELECT je.* FROM journal_entries je
          WHERE EXISTS (
            SELECT 1 FROM billing_documents bd
            WHERE bd.billing_document = ANY(${bdIds})
              AND bd.company_code IS NOT NULL AND bd.fiscal_year IS NOT NULL AND bd.accounting_document IS NOT NULL
              AND bd.company_code = je.company_code
              AND bd.fiscal_year = je.fiscal_year
              AND bd.accounting_document = je.accounting_document
          )
          LIMIT 50
        `;
      }
      // Load payments (sample first 50)
      data.payments = await sql`SELECT * FROM payments LIMIT 50`;
    }

    const graph = buildGraph(data);
    return NextResponse.json(graph);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn(
        'Graph API: tables missing (run schema + ingest). See npm run ingest in context-graph.'
      );
      return NextResponse.json({
        ...buildGraph({}),
        dbSetupRequired: true,
        message:
          'Database tables are missing. From the context-graph folder run npm run ingest (needs DATABASE_URL in .env.local and sap-order-to-cash-dataset/sap-o2c-data).',
      });
    }
    console.error('Graph API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
