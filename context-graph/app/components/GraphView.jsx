'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { NODE_COLORS } from '@/lib/nodeColors';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

/** Deep clone so the panel retains all metadata regardless of force-graph's internal mutations. */
function snapshotNode(node) {
  if (!node || typeof node !== 'object') return node;
  try {
    return JSON.parse(JSON.stringify(node));
  } catch {
    return { ...node };
  }
}

function formatMetaValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

const PANEL_SKIP_KEYS = new Set([
  'id', 'type', 'label', 'color', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'index',
  '__indexColor', '__threeObj',
]);

const TYPE_LABELS = {
  customer: 'Customer',
  sales_order: 'Sales Order',
  sales_order_item: 'SO Item',
  delivery: 'Delivery',
  delivery_item: 'Delivery Item',
  billing: 'Billing',
  billing_item: 'Billing Item',
  journal_entry: 'Journal Entry',
  payment: 'Payment',
  product: 'Product',
  address: 'Address',
  plant: 'Plant',
  company: 'Company',
  sales_area: 'Sales area',
  schedule_line: 'Schedule line',
  billing_cancellation: 'Billing cancel',
  storage_location: 'Storage loc.',
};

export default function GraphView({ highlightIds = [], onNodeSelect, simulationActive = true }) {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [setupHint, setSetupHint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [expandStatus, setExpandStatus] = useState(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef(null);
  const fgRef = useRef(null);

  // Resize observer (rAF-coalesced — avoids layout thrash during drag-resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) setDimensions({ width, height });
      });
    });
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Pause force simulation when tab hidden or graph not visible (battery / main thread)
  useEffect(() => {
    if (loading || error) return;
    const apply = () => {
      const fg = fgRef.current;
      if (!fg?.pauseAnimation) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!simulationActive || hidden) fg.pauseAnimation();
      else fg.resumeAnimation?.();
    };
    const t = window.setTimeout(apply, 0);
    document.addEventListener('visibilitychange', apply);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', apply);
    };
  }, [simulationActive, loading, error, graphData.nodes.length]);

  // Fetch initial graph (AbortController avoids duplicate work in React Strict Mode dev double-mount)
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    async function fetchGraph() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/graph', { signal: ac.signal });
        if (!res.ok) throw new Error('Failed to load graph');
        const data = await res.json();
        if (cancelled) return;
        const { nodes = [], links = [], dbSetupRequired, message } = data;
        setGraphData({ nodes, links });
        setSetupHint(dbSetupRequired ? (message || 'Run npm run ingest to load the graph database.') : null);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchGraph();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  // Expand node — fetch neighbors and merge
  const expandNode = useCallback(async (nodeId) => {
    setExpandStatus('loading');
    try {
      const res = await fetch(`/api/node/${encodeURIComponent(nodeId)}`);
      if (!res.ok) {
        setExpandStatus('error');
        setTimeout(() => setExpandStatus(null), 2000);
        return;
      }
      const expansion = await res.json();
      const { nodes: expNodes = [], links: expLinks = [] } = expansion;

      setGraphData(prev => {
        const existingIds = new Set(prev.nodes.map(n => n.id));
        const newNodes = expNodes.filter(n => !existingIds.has(n.id));
        const existingLinks = new Set(prev.links.map(l =>
          `${typeof l.source === 'object' ? l.source.id : l.source}→${typeof l.target === 'object' ? l.target.id : l.target}`
        ));
        const newLinks = expLinks.filter(l => {
          const key = `${l.source}→${l.target}`;
          return !existingLinks.has(key);
        });
        
        if (newNodes.length === 0) {
          setExpandStatus('no-new');
          setTimeout(() => setExpandStatus(null), 2000);
        } else {
          setExpandStatus(`added ${newNodes.length} nodes`);
          setTimeout(() => setExpandStatus(null), 2000);
        }
        
        return {
          nodes: [...prev.nodes, ...newNodes],
          links: [...prev.links, ...newLinks],
        };
      });
    } catch (err) {
      console.error('Expand error:', err);
      setExpandStatus('error');
      setTimeout(() => setExpandStatus(null), 2000);
    }
  }, []);

  // Highlight set for O(1) lookup
  const highlightSet = useMemo(() => new Set(highlightIds), [highlightIds]);
  const highlightActive = highlightSet.size > 0;

  // Frame highlighted nodes after query results (only if they exist in the current graph)
  useEffect(() => {
    if (!highlightActive || !fgRef.current) return;
    const inGraph = graphData.nodes.some((n) => highlightSet.has(n.id));
    if (!inGraph) return;
    const t = window.setTimeout(() => {
      try {
        fgRef.current.zoomToFit(450, 72, (n) => highlightSet.has(n.id));
      } catch {
        /* ignore */
      }
    }, 100);
    return () => window.clearTimeout(t);
  }, [highlightIds, highlightActive, highlightSet, graphData.nodes]);

  const legendItems = useMemo(
    () => Object.entries(NODE_COLORS).map(([type, color]) => ({ type, color })),
    []
  );

  const handleNodeClick = useCallback((node) => {
    const snap = snapshotNode(node);
    setSelected(snap);
    if (onNodeSelect) onNodeSelect(snap);
  }, [onNodeSelect]);

  const handleNodeRightClick = useCallback((node, event) => {
    event.preventDefault();
    expandNode(node.id);
  }, [expandNode]);

  // Custom node rendering — dim non-highlighted nodes when chat sent a highlight set
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const isHighlighted = highlightSet.has(node.id);
    const isSelected = selected?.id === node.id;
    const dimmed = highlightActive && !isHighlighted && !isSelected;
    const size = isHighlighted || isSelected ? 5.2 : 3;

    const prevAlpha = ctx.globalAlpha;
    if (dimmed) ctx.globalAlpha = 0.2;

    // Node circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color || '#9ca3af';
    ctx.fill();

    ctx.globalAlpha = prevAlpha;

    // Highlight ring (stronger when chat-highlighted)
    if (isHighlighted || isSelected) {
      ctx.strokeStyle = isSelected ? '#0f172a' : '#c2410c';
      ctx.lineWidth = (isHighlighted ? 2.1 : 1.35) / globalScale;
      ctx.beginPath();
      ctx.arc(node.x, node.y, size + 1.2 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Label (only when zoomed in enough)
    if (globalScale > 1.65) {
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.35;
      ctx.font = `${Math.max(2.5, 8 / globalScale)}px "Source Sans 3", ui-sans-serif, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#334155';
      ctx.fillText(node.label, node.x, node.y + size + 2);
      ctx.restore();
    }
  }, [highlightActive, highlightSet, selected]);

  // Node size for collision/hit detection (must match visual size)
  const nodeVal = useCallback((node) => {
    const isHighlighted = highlightSet.has(node.id);
    const isSelected = selected?.id === node.id;
    return isHighlighted || isSelected ? 5.2 : 3;
  }, [highlightSet, selected]);

  const linkColor = useCallback(() => {
    return highlightActive ? 'rgba(51, 65, 85, 0.09)' : 'rgba(51, 65, 85, 0.22)';
  }, [highlightActive]);

  if (loading) {
    return (
      <div ref={containerRef} className="graph-container">
        <div className="graph-loading">
          <div className="spinner" />
          <p>Loading graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div ref={containerRef} className="graph-container">
        <div className="graph-error">
          <p>Error: {error}</p>
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="graph-container">
      {setupHint && (
        <div className="graph-setup-hint" role="status">
          {setupHint}
        </div>
      )}
      {/* Legend */}
      <div className="graph-legend">
        {legendItems.map(({ type, color }) => (
          <div key={type} className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: color }} />
            <span>{TYPE_LABELS[type] || type}</span>
          </div>
        ))}
        <div className="legend-counts">
          {graphData.nodes.length} nodes &middot; {graphData.links.length} edges
        </div>
      </div>

      {/* Force Graph */}
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        backgroundColor="oklch(0.94 0.012 95)"
        nodeCanvasObject={nodeCanvasObject}
        nodeVal={nodeVal}
        linkColor={linkColor}
        linkDirectionalArrowLength={0}
        linkWidth={0.5}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeRightClick}
        cooldownTicks={50}
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.4}
        maxSpeed={10}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />

      {/* Selected node panel */}
      {selected && (
        <div className="node-panel">
          <div className="node-panel-header">
            <span className="node-type-badge" style={{ backgroundColor: selected.color }}>
              {TYPE_LABELS[selected.type] || selected.type}
            </span>
            <button type="button" className="node-panel-close" onClick={() => setSelected(null)} aria-label="Close details">&times;</button>
          </div>
          <h3 className="node-panel-title">{selected.label}</h3>
          <div className="node-panel-meta">
            <div className="meta-row">
              <span className="meta-key">id</span>
              <span className="meta-value meta-value--mono">{formatMetaValue(selected.id)}</span>
            </div>
            <div className="meta-row">
              <span className="meta-key">type</span>
              <span className="meta-value">{formatMetaValue(selected.type)}</span>
            </div>
            {Object.entries(selected)
              .filter(([k]) => !PANEL_SKIP_KEYS.has(k))
              .map(([k, v]) => (
                <div key={k} className="meta-row">
                  <span className="meta-key">{k}</span>
                  <span className="meta-value">{formatMetaValue(v)}</span>
                </div>
              ))}
          </div>
          <button type="button" className="expand-btn" onClick={() => expandNode(selected.id)} disabled={expandStatus === 'loading'}>
            {expandStatus === 'loading' ? 'Expanding...' : expandStatus === 'no-new' ? 'Already loaded' : expandStatus === 'error' ? 'Error' : expandStatus ? expandStatus : 'Expand Neighbors'}
          </button>
        </div>
      )}
    </div>
  );
}
