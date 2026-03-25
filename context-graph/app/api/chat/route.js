import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { extractGraphNodeIdsFromRows } from '@/lib/extractGraphNodeIds';
import {
  checkGuardrail,
  generateSQL,
  normalizeChatHistory,
  normalizeSqlQueryRows,
  sanitizeSQL,
  synthesizeAnswer,
} from '@/lib/llm';

export async function POST(request) {
  try {
    const body = await request.json();
    const { message, history: rawHistory } = body;
    const history = normalizeChatHistory(rawHistory);

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }

    // Step 1: Guardrail check
    const isOnDomain = await checkGuardrail(message, { history });
    if (!isOnDomain) {
      return NextResponse.json({
        answer: 'This system is designed to answer questions related to the provided SAP Order-to-Cash dataset only. Please ask a question about sales orders, deliveries, billing documents, payments, customers, or products.',
        sql: null,
        results: null,
        highlightNodeIds: [],
        blocked: true,
      });
    }

    // Step 2: Generate SQL
    let rawSQL;
    try {
      rawSQL = await generateSQL(message, { history });
    } catch (err) {
      return NextResponse.json({
        answer: 'I was unable to generate a query for your question. Please try rephrasing it.',
        sql: null,
        results: null,
        highlightNodeIds: [],
        blocked: false,
      });
    }

    // Step 3: Sanitize SQL
    let cleanSQL;
    try {
      cleanSQL = sanitizeSQL(rawSQL);
    } catch (err) {
      return NextResponse.json({
        answer: `The generated query was rejected for safety: ${err.message}`,
        sql: rawSQL,
        results: null,
        highlightNodeIds: [],
        blocked: false,
      });
    }

    // Step 4: Execute against Neon
    let results;
    try {
      const raw = await sql.query(cleanSQL);
      results = normalizeSqlQueryRows(raw);
    } catch (err) {
      console.error('SQL execution error:', err.message, '\nSQL:', cleanSQL);
      return NextResponse.json({
        answer: `There was an error running the query. The database returned: ${err.message}. Please try rephrasing your question.`,
        sql: cleanSQL,
        results: null,
        highlightNodeIds: [],
        blocked: false,
      });
    }

    const fullResults = results.slice(0, 50);
    const highlightNodeIds = extractGraphNodeIdsFromRows(results);

    // Step 5: Synthesize answer from results
    const answer = await synthesizeAnswer(message, results, { sql: cleanSQL, history });

    return NextResponse.json({
      answer,
      sql: cleanSQL,
      results: fullResults,
      highlightNodeIds,
      blocked: false,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({
      answer: 'An unexpected error occurred. Please try again.',
      sql: null,
      results: null,
      highlightNodeIds: [],
      blocked: false,
    }, { status: 500 });
  }
}
