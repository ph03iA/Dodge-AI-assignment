import { GoogleGenAI } from '@google/genai';

/**
 * LLM routing & fallbacks (see .env.local):
 *
 * GEMINI_API_KEY          — single key (default provider)
 * GEMINI_API_KEYS         — comma-separated keys; tries each on rate limit before other providers
 * GEMINI_MODEL            — e.g. gemini-2.0-flash
 *
 * LLM_FALLBACK_ORDER      — comma list, default: gemini,groq,openrouter
 *   Skips providers with missing keys.
 *
 * GROQ_API_KEY + GROQ_MODEL (default llama-3.3-70b-versatile)
 * OPENROUTER_API_KEY + OPENROUTER_MODEL (e.g. google/gemini-2.0-flash-001)
 * OPENROUTER_SITE_URL     — optional, for OpenRouter rankings
 */

const DB_SCHEMA = `
Tables (PostgreSQL / Neon):

customers (business_partner PK, customer, category, full_name, grouping, name, correspondence_lang, created_by, creation_date, first_name, last_name, org_name1, org_name2, is_blocked)
addresses (business_partner FK→customers, address_id, city, country, postal_code, region, street, PK(business_partner,address_id))
products (product PK, product_type, creation_date, gross_weight, weight_unit, net_weight, product_group, base_unit, division)
product_descriptions (product FK→products, language, description, PK(product,language))
plants (plant PK, plant_name, sales_organization, distribution_channel, division)
sales_orders (sales_order PK, order_type, sales_organization, distribution_channel, division, sold_to_party FK→customers, creation_date, total_net_amount, overall_delivery_status, overall_billing_status, transaction_currency, requested_delivery_date, payment_terms)
sales_order_items (sales_order FK→sales_orders, sales_order_item, item_category, material FK→products, requested_quantity, quantity_unit, net_amount, material_group, production_plant, PK(sales_order,sales_order_item))
deliveries (delivery_document PK, actual_goods_movement_date, creation_date, goods_movement_status, picking_status, shipping_point)
delivery_items (delivery_document FK→deliveries, delivery_document_item, actual_delivery_quantity, quantity_unit, plant, reference_sd_document ref→sales_order, reference_sd_document_item, PK(delivery_document,delivery_document_item))
billing_documents (billing_document PK, billing_type, creation_date, billing_date, is_cancelled, total_net_amount, transaction_currency, company_code, fiscal_year, accounting_document, sold_to_party FK→customers)
billing_document_items (billing_document FK→billing_documents, billing_document_item, material FK→products, billing_quantity, net_amount, reference_sd_document ref→sales_order, reference_sd_document_item, PK(billing_document,billing_document_item))
journal_entries (company_code, fiscal_year, accounting_document, accounting_document_item, gl_account, amount_in_trans_currency, transaction_currency, posting_date, document_type, customer FK→customers, clearing_date, clearing_document, PK(company_code,fiscal_year,accounting_document,accounting_document_item))
payments (company_code, fiscal_year, accounting_document, accounting_document_item, amount_in_trans_currency, transaction_currency, customer FK→customers, invoice_reference, sales_document, posting_date, PK(company_code,fiscal_year,accounting_document,accounting_document_item))
billing_document_cancellations (billing_document PK, billing_type, creation_date, billing_date, billing_is_cancelled, cancelled_billing_doc ref→billing_documents.billing_document, total_net_amount, transaction_currency, company_code, fiscal_year, accounting_document, sold_to_party FK→customers)
customer_company_assignments (customer FK→customers, company_code, payment_terms, reconciliation_account, accounting_clerk, PK(customer,company_code))
customer_sales_area_assignments (customer FK→customers, sales_organization, distribution_channel, division, currency, incoterms, supplying_plant, PK(customer,sales_organization,distribution_channel,division))
sales_order_schedule_lines (sales_order, sales_order_item, schedule_line, confirmed_delivery_date, confirmed_order_qty, order_quantity_unit, PK(sales_order,sales_order_item,schedule_line), FK(sales_order,sales_order_item)→sales_order_items)
product_plants (product FK→products, plant FK→plants, country_of_origin, mrp_type, profit_center, PK(product,plant))
product_storage_locations (product FK→products, plant FK→plants, storage_location, physical_inventory_block, PK(product,plant,storage_location))

Key joins:
- sales_orders.sold_to_party → customers.business_partner
- sales_order_items.material → products.product
- delivery_items.reference_sd_document → sales_orders.sales_order (links delivery to order)
- billing_document_items.reference_sd_document → sales_orders.sales_order (links billing to order)
- billing_documents.(company_code,fiscal_year,accounting_document) → journal_entries.(company_code,fiscal_year,accounting_document)
- payments.customer → customers.business_partner
- billing_documents.sold_to_party → customers.business_partner
- billing_document_cancellations.cancelled_billing_doc → billing_documents.billing_document; billing_document_cancellations.sold_to_party → customers.business_partner
- customer_company_assignments.customer → customers.business_partner
- customer_sales_area_assignments.customer → customers.business_partner
- sales_order_schedule_lines.(sales_order,sales_order_item) → sales_order_items.(sales_order,sales_order_item)
- product_plants.product → products.product; product_plants.plant → plants.plant
- product_storage_locations.(product,plant) → product_plants optional path; storage rows reference products and plants
`.trim();

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';

function geminiKeyList() {
  const multi = process.env.GEMINI_API_KEYS;
  if (multi && multi.trim()) {
    return multi.split(',').map((k) => k.trim()).filter(Boolean);
  }
  const one = process.env.GEMINI_API_KEY;
  return one ? [one.trim()] : [];
}

function fallbackOrder() {
  const raw = process.env.LLM_FALLBACK_ORDER || 'gemini,groq,openrouter';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isRetryableLlmError(err) {
  const status = err?.status ?? err?.statusCode ?? err?.code;
  if (status === 429 || status === 503 || status === 529) return true;
  if (status === 402) return true;
  const msg = String(err?.message || err?.error?.message || err || '').toLowerCase();
  return /rate|quota|resource_exhausted|resource exhausted|too many requests|429|503|overloaded|capacity|billing|exhausted/i.test(
    msg
  );
}

async function geminiGenerate(apiKey, { systemInstruction, userContent, temperature, maxOutputTokens }) {
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: userContent,
    config: {
      systemInstruction,
      temperature,
      maxOutputTokens,
    },
  });
  const text = response?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

async function geminiGenerateWithKeyRotation(args) {
  const keys = geminiKeyList();
  if (keys.length === 0) throw new Error('No GEMINI_API_KEY(S) set');
  let lastErr;
  for (const key of keys) {
    try {
      return await geminiGenerate(key, args);
    } catch (e) {
      lastErr = e;
      if (!isRetryableLlmError(e)) throw e;
      console.warn('[llm] Gemini key exhausted or rate-limited, trying next key/provider…');
    }
  }
  throw lastErr;
}

async function openAiCompatibleChat(url, apiKey, model, extraHeaders, args) {
  const { systemInstruction, userContent, temperature, maxOutputTokens } = args;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      temperature,
      max_tokens: maxOutputTokens,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(raw.slice(0, 500) || res.statusText);
    err.status = res.status;
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON from LLM API');
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error('Empty chat completion response');
  return String(text).trim();
}

async function groqGenerate(args) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');
  return openAiCompatibleChat(
    'https://api.groq.com/openai/v1/chat/completions',
    key,
    GROQ_MODEL,
    {},
    args
  );
}

async function openRouterGenerate(args) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const referer = process.env.OPENROUTER_SITE_URL || 'http://localhost:3000';
  return openAiCompatibleChat(
    'https://openrouter.ai/api/v1/chat/completions',
    key,
    OPENROUTER_MODEL,
    {
      'HTTP-Referer': referer,
      'X-Title': 'Context Graph SAP O2C',
    },
    args
  );
}

/**
 * Run text generation with provider order + Gemini key rotation.
 * On rate limit / quota, tries next key (Gemini) then next provider.
 */
async function generateText(args) {
  const order = fallbackOrder();
  let lastErr;

  for (const provider of order) {
    try {
      if (provider === 'gemini') {
        if (geminiKeyList().length === 0) continue;
        return await geminiGenerateWithKeyRotation(args);
      }
      if (provider === 'groq') {
        if (!process.env.GROQ_API_KEY) continue;
        return await groqGenerate(args);
      }
      if (provider === 'openrouter') {
        if (!process.env.OPENROUTER_API_KEY) continue;
        return await openRouterGenerate(args);
      }
    } catch (e) {
      lastErr = e;
      if (!isRetryableLlmError(e)) throw e;
      console.warn(`[llm] provider "${provider}" failed:`, e?.message || e);
    }
  }

  throw lastErr || new Error('No LLM provider succeeded. Set GEMINI_API_KEY, GROQ_API_KEY, and/or OPENROUTER_API_KEY.');
}

// ── Guardrail check ────────────────────────────────────────────
export async function checkGuardrail(message) {
  const offTopicPatterns = [
    /capital\s+of/i, /president\s+of/i, /weather\s+in/i,
    /recipe\s+for/i, /how\s+to\s+cook/i, /translate\s+/i,
    /write\s+(me\s+)?a\s+(poem|story|essay|song|joke)/i,
    /what\s+is\s+the\s+(meaning|definition)\s+of\s+life/i,
    /tell\s+me\s+a\s+joke/i,
  ];

  const o2cTerms = [
    'order', 'sales', 'billing', 'invoice', 'delivery', 'payment',
    'customer', 'product', 'material', 'journal', 'accounting',
    'shipped', 'billed', 'delivered', 'amount', 'quantity',
    'company', 'plant', 'document', 'receivable', 'credit',
  ];

  const lowerMsg = message.toLowerCase();
  const hasO2CTerm = o2cTerms.some((t) => lowerMsg.includes(t));
  const isOffTopic = offTopicPatterns.some((p) => p.test(message));

  if (isOffTopic && !hasO2CTerm) {
    return false;
  }

  const answer = await generateText({
    systemInstruction: `You are a guardrail classifier for a SAP Order-to-Cash dataset query system.
The system contains data about: sales orders, order items, outbound deliveries, billing documents, journal entries, payments, customers/business partners, products, plants, and addresses.

Determine if the user's question is a legitimate, on-domain question about this SAP O2C dataset.

Rules:
- Questions about sales, orders, billing, deliveries, payments, customers, products, materials, journal entries, accounting documents, plants, or any business process in the Order-to-Cash flow are ON-DOMAIN.
- Questions about general knowledge, trivia, creative writing, coding help, personal advice, or anything unrelated to this specific dataset are OFF-DOMAIN.
- Questions that merely mention business terms but ask for creative content (e.g. "write a story about billing") are OFF-DOMAIN.

Respond with ONLY the word YES (on-domain) or NO (off-domain). Nothing else.`,
    userContent: message,
    temperature: 0,
    maxOutputTokens: 5,
  });

  return answer.trim().toUpperCase() === 'YES';
}

// ── Generate SQL ───────────────────────────────────────────────
export async function generateSQL(message) {
  return generateText({
    systemInstruction: `You are a SQL query generator for a PostgreSQL database containing SAP Order-to-Cash data.

${DB_SCHEMA}

Rules:
1. Generate ONLY a single SELECT query. No INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, or TRUNCATE.
2. Always add a reasonable LIMIT (50-100 rows max) unless the user asks for a specific count.
3. Use ONLY the tables and columns listed above. Do not invent columns.
4. Do NOT wrap in markdown fences or add any commentary. Output ONLY the raw SQL.
5. Use proper JOINs to connect related tables when needed.
6. For product names, JOIN product_descriptions with language = 'EN'.
7. For tracing flows: use delivery_items.reference_sd_document to link deliveries to sales orders, and billing_document_items.reference_sd_document to link billing to sales orders. Link billing to journal entries via (company_code, fiscal_year, accounting_document).
8. Delivered but not billed (incomplete flow): sales orders that appear on at least one delivery line but have no billing line pointing to that order. Prefer NOT EXISTS: FROM delivery_items di WHERE di.reference_sd_document IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing_document_items bdi WHERE bdi.reference_sd_document = di.reference_sd_document). Return DISTINCT sales_order ids; LIMIT 50–100.
9. Billed without delivery: sales orders referenced on billing lines but never on any delivery line for that order. NOT EXISTS (SELECT 1 FROM delivery_items di WHERE di.reference_sd_document = bdi.reference_sd_document) with FROM billing_document_items bdi WHERE bdi.reference_sd_document IS NOT NULL. DISTINCT reference_sd_document; LIMIT 50–100.
10. Use LEFT JOINs / NOT EXISTS / IS NULL for missing links; prefer NOT EXISTS when comparing existence across fact tables.
11. CRITICAL — table aliases: Every alias (bd, bdi, di, so, je, etc.) MUST appear in FROM or JOIN. Never write WHERE bd.col = ... unless FROM billing_documents bd (or JOIN ... bd) is present in the same SELECT. If unsure, use full table names instead of aliases.
12. Tracing one billing document through sales order → delivery → billing → journal: start FROM billing_documents, JOIN billing_document_items for reference_sd_document (= sales_order), LEFT JOIN delivery_items ON delivery_items.reference_sd_document = billing_document_items.reference_sd_document, LEFT JOIN deliveries ON deliveries.delivery_document = delivery_items.delivery_document, LEFT JOIN journal_entries ON journal_entries.company_code = billing_documents.company_code AND journal_entries.fiscal_year = billing_documents.fiscal_year AND journal_entries.accounting_document = billing_documents.accounting_document. Filter WHERE billing_documents.billing_document = '<id>'. Include billing_documents.accounting_document only if it is non-null for JE link.
13. Products with the highest number of billing documents: use billing_document_items (material = product). COUNT(DISTINCT bdi.billing_document) GROUP BY bdi.material. JOIN products p ON p.product = bdi.material LEFT JOIN product_descriptions pd ON pd.product = bdi.material AND pd.language = 'EN'. ORDER BY count DESC LIMIT 20–50.

Example trace query (output SQL only, no prose; use the billing document number from the user's message in WHERE):
SELECT bd.billing_document, bdi.reference_sd_document AS sales_order, di.delivery_document, bd.company_code, bd.fiscal_year, bd.accounting_document, je.accounting_document_item, je.amount_in_trans_currency
FROM billing_documents bd
INNER JOIN billing_document_items bdi ON bdi.billing_document = bd.billing_document
LEFT JOIN delivery_items di ON di.reference_sd_document = bdi.reference_sd_document
LEFT JOIN deliveries d ON d.delivery_document = di.delivery_document
LEFT JOIN journal_entries je ON je.company_code = bd.company_code AND je.fiscal_year = bd.fiscal_year AND je.accounting_document = bd.accounting_document
WHERE bd.billing_document = '90504248'
LIMIT 100`,
    userContent: message,
    temperature: 0,
    maxOutputTokens: 1024,
  });
}

// ── Sanitize SQL ───────────────────────────────────────────────
export function sanitizeSQL(rawSQL) {
  let sql = rawSQL.trim();

  sql = sql.replace(/^```(?:sql)?\s*/im, '').replace(/\s*```\s*$/im, '');
  sql = sql.trim();

  const selectMatch = sql.match(/\bSELECT\b/i);
  if (selectMatch) {
    sql = sql.substring(selectMatch.index);
  }

  if (!/^\s*SELECT/i.test(sql)) {
    throw new Error('Only SELECT queries are allowed.');
  }

  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|EXEC)\b/i;
  if (forbidden.test(sql)) {
    throw new Error('Query contains forbidden keywords.');
  }

  sql = sql.replace(/;/g, '');
  sql = sql.trim();

  sql = sql.replace(/\n\s*--[^\n]*$/g, '');
  sql = sql.replace(/\n\s*(This|Note|The above|Here|I )[^\n]*$/gi, '');
  sql = sql.trim();

  if (/\b(information_schema|pg_catalog|pg_)\b/i.test(sql)) {
    throw new Error('System catalog access is not allowed.');
  }

  return sql;
}

// ── Synthesize answer ──────────────────────────────────────────
export async function synthesizeAnswer(message, results) {
  if (!results || results.length === 0) {
    return 'No matching data was found for your query.';
  }

  const cappedResults = results.slice(0, 30);

  return generateText({
    systemInstruction: `You are an analyst answering questions about a SAP Order-to-Cash dataset.
Answer the user's question STRICTLY based on the provided query results.
- Do NOT invent or assume data not present in the results.
- If the results are empty, say so.
- Use natural language. Be concise and clear.
- For tabular data, present it in a readable format.
- Keep your answer under 500 words.`,
    userContent: `User question: ${message}\n\nQuery results (JSON):\n${JSON.stringify(cappedResults, null, 2)}`,
    temperature: 0.2,
    maxOutputTokens: 2048,
  });
}

export { DB_SCHEMA };
