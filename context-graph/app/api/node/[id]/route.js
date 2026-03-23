import { NextResponse } from 'next/server';
import { isMissingSchemaError } from '@/lib/db';
import { buildGraph, getNodeNeighbors } from '@/lib/graphBuilder';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    // id format: "type:value" e.g. "sales_order:740506", "customer:310000108"
    // or "type:a:b:c:d" for composite keys like journal_entry:ABCD:2025:9400123662:001

    if (!id) {
      return NextResponse.json({ error: 'Node ID is required.' }, { status: 400 });
    }

    const decodedId = decodeURIComponent(id);
    const colonIdx = decodedId.indexOf(':');
    if (colonIdx === -1) {
      return NextResponse.json({ error: 'Invalid node ID format. Expected type:value' }, { status: 400 });
    }

    const type = decodedId.substring(0, colonIdx);
    const value = decodedId.substring(colonIdx + 1);

    const graph = await getNodeNeighbors(value, type);
    return NextResponse.json(graph);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({
        ...buildGraph({}),
        dbSetupRequired: true,
      });
    }
    console.error('Node API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
