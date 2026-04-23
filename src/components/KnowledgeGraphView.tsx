import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { KnowledgeGraph } from '../types';
import { Share2, Info, Maximize2, Download } from 'lucide-react';

interface KnowledgeGraphViewProps {
  graph: KnowledgeGraph;
  onFullscreen?: () => void;
  standalone?: boolean;
}

export function KnowledgeGraphView({ graph, onFullscreen, standalone = false }: KnowledgeGraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRadius = 50;
  const arrowOffset = 14;
  const rawMarkerId = useId();
  const markerId = useMemo(() => `arrowhead-${rawMarkerId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawMarkerId]);
  const [semanticPositionColors, setSemanticPositionColors] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {
      position_initiale: '#3b82f6',
      analyse_socratique: '#f97316',
      concept: '#22c55e',
      preuve: '#8b5cf6',
      acteur: '#14b8a6',
      deviation: '#ef4444',
      meta: '#64748b',
    };
    try {
      const raw = localStorage.getItem('SEMANTIC_POSITION_COLORS');
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    const syncColors = () => {
      try {
        const raw = localStorage.getItem('SEMANTIC_POSITION_COLORS');
        if (raw) setSemanticPositionColors((prev) => ({ ...prev, ...JSON.parse(raw) }));
      } catch {
        // ignore parse failures
      }
    };
    const handler = () => syncColors();
    window.addEventListener('semantic-position-colors-changed', handler as EventListener);
    return () => {
      window.removeEventListener('semantic-position-colors-changed', handler as EventListener);
    };
  }, []);
  const safeGraph = useMemo(() => {
    const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const nodes = rawNodes
      .filter((n: any) => n && typeof n.id === 'string' && n.id.trim().length > 0)
      .map((n: any) => ({
        id: n.id,
        label: typeof n.label === 'string' && n.label.trim().length > 0 ? n.label : n.id,
        type: typeof n.type === 'string' && n.type.trim().length > 0 ? n.type : 'Concept',
        properties: n.properties || {},
      }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const rawEdges = Array.isArray(graph?.edges) ? graph.edges : [];
    const edges = rawEdges
      .filter((e: any) => {
        if (!e) return false;
        const source = String(e.source ?? '');
        const target = String(e.target ?? '');
        return source.length > 0 && target.length > 0 && nodeIds.has(source) && nodeIds.has(target);
      })
      .map((e: any) => ({
        id: typeof e.id === 'string' && e.id.trim().length > 0 ? e.id : `${e.source}-${e.target}`,
        source: String(e.source),
        target: String(e.target),
        label: typeof e.label === 'string' && e.label.trim().length > 0 ? e.label : 'related',
      }));

    return { nodes, edges };
  }, [graph]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (!safeGraph.nodes.length) return;

    const updateDimensions = () => {
      if (!containerRef.current || !svgRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let width = rect.width;
      let height = rect.height;

      // Fallback to clientWidth/Height if rect is zero (can happen in some flex scenarios)
      if (width === 0) width = containerRef.current.clientWidth;
      if (height === 0) height = containerRef.current.clientHeight;
      
      if (width === 0 || height === 0) return;

      const svg = d3.select(svgRef.current);
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      svg.selectAll("*").remove();

      const g = svg.append("g");

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 5])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
          const currentScale = event.transform.k;
          g.selectAll(".node-label")
            .style("font-size", `${11 / currentScale}px`);
          g.selectAll(".node-adherence")
            .style("font-size", `${9 / currentScale}px`);
          g.selectAll(".edge-label")
            .style("font-size", `${9 / currentScale}px`);
        });

      svg.call(zoom as any);

      try {
      const simulation = d3.forceSimulation<any>(safeGraph.nodes)
        .force("link", d3.forceLink<any, any>(safeGraph.edges).id(d => d.id).distance(250))
        .force("charge", d3.forceManyBody().strength(-1200))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(100));

      // Define arrow marker
      svg.append("defs").append("marker")
        .attr("id", markerId)
        .attr("viewBox", "0 -6 12 12")
        .attr("refX", 52)
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerUnits", "userSpaceOnUse")
        .attr("markerWidth", 12)
        .attr("markerHeight", 12)
        .attr("overflow", "visible")
        .append("path")
        .attr("d", "M 0,-6 L 12,0 L 0,6")
        .attr("fill", "#8b5e34")
        .style("stroke", "none");

      const link = g.append("g")
        .attr("stroke", "#9a9a83")
        .attr("stroke-opacity", 0.4)
        .selectAll("line")
        .data(safeGraph.edges)
        .join("line")
        .attr("marker-end", `url(#${markerId})`)
        .attr("stroke-width", 1.5);

      const edgeLabels = g.append("g")
        .selectAll("text")
        .data(safeGraph.edges)
        .join("text")
        .attr("class", "edge-label")
        .attr("font-size", "9px")
        .attr("fill", "#bc6c25")
        .attr("text-anchor", "middle")
        .attr("dy", -5)
        .style("font-weight", "bold")
        .text(d => d.label);

      const node = g.append("g")
        .selectAll("g")
        .data(safeGraph.nodes)
        .join("g")
        .attr("class", "node")
        .call(d3.drag<any, any>()
          .on("start", (event) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
          })
          .on("drag", (event) => {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
          })
          .on("end", (event) => {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
          }) as any);

      node.append("circle")
        .attr("r", 50) // Increased radius for better readability
        .attr("fill", d => {
          const semanticPosition = String(d?.properties?.semanticPosition || '').trim();
          let baseColor = semanticPosition && semanticPositionColors[semanticPosition]
            ? semanticPositionColors[semanticPosition]
            : '';
          const type = d.type?.toLowerCase() || "";
          if (!baseColor && type.includes('question')) baseColor = semanticPositionColors.position_initiale || "#3b82f6";
          if (!baseColor && (type.includes('analysis') || type.includes('socratic'))) baseColor = semanticPositionColors.analyse_socratique || "#f97316";
          if (!baseColor && (type.includes('evidence') || type.includes('source'))) baseColor = semanticPositionColors.preuve || "#8b5cf6";
          if (!baseColor && (type.includes('personne') || type.includes('acteur') || type.includes('actor'))) baseColor = semanticPositionColors.acteur || "#14b8a6";
          if (!baseColor && type.includes('concept')) baseColor = semanticPositionColors.concept || "#22c55e";
          if (!baseColor && (type.includes('idée') || type.includes('concept'))) baseColor = semanticPositionColors.concept || "#22c55e";
          if (!baseColor) baseColor = semanticPositionColors.concept || "#22c55e";
          const adherenceRate = Number(d?.properties?.adherenceRate);
          if (Number.isFinite(adherenceRate)) {
            const normalized = Math.max(0, Math.min(1, adherenceRate));
            return d3.interpolateRgb("#e5e7eb", baseColor)(normalized);
          }
          return baseColor;
        })
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .style("filter", "drop-shadow(0 4px 6px rgba(0,0,0,0.1))");

      node.append("text")
        .attr("class", "node-label")
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("fill", "#000")
        .attr("font-size", "11px")
        .attr("font-weight", "bold")
        .style("pointer-events", "none")
        .text(d => d.label);

      node.append("text")
        .attr("class", "node-adherence")
        .attr("dy", "1.9em")
        .attr("text-anchor", "middle")
        .attr("fill", "#111827")
        .attr("font-size", "9px")
        .attr("font-weight", "bold")
        .style("pointer-events", "none")
        .text((d: any) => {
          const score = Number(d?.properties?.adherenceRate);
          if (!Number.isFinite(score)) return "";
          return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
        });

      node.append("title")
        .text((d: any) => {
          const score = Number(d?.properties?.adherenceRate);
          const matched = Array.isArray(d?.properties?.matchedAttributes) ? d.properties.matchedAttributes : [];
          if (!Number.isFinite(score)) {
            return `${d.label}\nAdhésion: non calculée`;
          }
          const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
          const matches = matched.length ? matched.slice(0, 6).join(", ") : "Aucun attribut au-dessus du seuil";
          return `${d.label}\nAdhésion: ${pct}%\nAttributs: ${matches}`;
        });

      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            const len = Math.hypot(dx, dy) || 1;
            return d.target.x - (dx / len) * (nodeRadius + arrowOffset);
          })
          .attr("y2", (d: any) => {
            const dx = d.target.x - d.source.x;
            const dy = d.target.y - d.source.y;
            const len = Math.hypot(dx, dy) || 1;
            return d.target.y - (dy / len) * (nodeRadius + arrowOffset);
          });

        node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

        edgeLabels
          .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
          .attr("y", (d: any) => (d.source.y + d.target.y) / 2);
      });

      simulation.on("end", () => {
        if (!containerRef.current) return;
        const bBox = g.node()?.getBBox();
        if (!bBox || bBox.width === 0) return;
        
        const padding = 40;
        const cWidth = containerRef.current.clientWidth;
        const cHeight = containerRef.current.clientHeight;
        const fullWidth = bBox.width + padding * 2;
        const fullHeight = bBox.height + padding * 2;
        const midX = bBox.x + bBox.width / 2;
        const midY = bBox.y + bBox.height / 2;
        
        const scale = Math.min(1.5, 0.85 / Math.max(fullWidth / cWidth, fullHeight / cHeight));
        
        svg.transition()
          .duration(1000)
          .call(zoom.transform as any, d3.zoomIdentity
            .translate(cWidth / 2, cHeight / 2)
            .scale(scale)
            .translate(-midX, -midY));
      });

      return simulation;
      } catch (error) {
        console.error("KnowledgeGraph render failed:", error);
        svg.selectAll("*").remove();
        return null;
      }
    };

    const simulation = updateDimensions();
    const resizeObserver = new ResizeObserver(() => updateDimensions());
    resizeObserver.observe(containerRef.current);
    return () => {
      if (simulation) simulation.stop();
      resizeObserver.disconnect();
    };
  }, [safeGraph, markerId]);

  const exportToCypher = () => {
    const nodes = safeGraph.nodes.map(n => `CREATE (n${n.id.replace(/-/g, '')}:${n.type.replace(/\s+/g, '')} {id: "${n.id}", label: "${n.label}"})`).join('\n');
    const edges = safeGraph.edges.map(e => `MATCH (a), (b) WHERE a.id = "${e.source}" AND b.id = "${e.target}" CREATE (a)-[:${e.label.replace(/\s+/g, '_').toUpperCase()}]->(b)`).join('\n');
    const cypher = `${nodes}\n${edges}`;
    
    const blob = new Blob([cypher], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `socrate_graph_export.cypher`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div 
      className={`bg-white rounded-[32px] border border-natural-sand shadow-sm overflow-hidden flex flex-col relative group ${standalone ? 'h-full' : 'h-[600px]'}`} 
      ref={containerRef}
    >
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <h3 className="font-serif text-2xl text-natural-heading mb-1">Graphe Sémantique</h3>
        <p className="text-[9px] font-bold text-natural-muted uppercase tracking-[0.2em] flex items-center gap-2">
           <span className="w-1.5 h-1.5 bg-natural-accent rounded-full animate-pulse"></span>
           Ontologies & Relations
        </p>
      </div>

      <div className="absolute top-6 right-6 z-20 flex gap-2">
        {onFullscreen && !standalone && (
          <button 
            onClick={onFullscreen}
            className="p-3 bg-white/90 backdrop-blur rounded-2xl border border-natural-sand text-natural-brown hover:bg-natural-accent hover:text-white transition-all shadow-sm"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="absolute bottom-6 right-6 z-10 flex gap-2">
        <button 
          onClick={exportToCypher}
          className="bg-white/80 backdrop-blur px-4 py-2 rounded-xl border border-natural-sand text-[9px] font-bold uppercase tracking-widest text-natural-muted flex items-center gap-2 shadow-sm hover:bg-natural-accent hover:text-white transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Export Cypher
        </button>
      </div>
      
      <div className="flex-1 w-full bg-natural-bg/5 relative">
        {safeGraph.nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-natural-muted p-8 text-center bg-natural-sand/20">
            <Info className="w-10 h-10 mb-4 opacity-30" />
            <p className="font-serif text-lg italic opacity-70">Aucun graphe extrait pour ce segment</p>
          </div>
        )}
        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"></svg>
      </div>
    </div>
  );
}
