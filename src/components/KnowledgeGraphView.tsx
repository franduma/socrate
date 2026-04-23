import React, { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (!graph || !graph.nodes || !graph.nodes.length) return;

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
          g.selectAll(".edge-label")
            .style("font-size", `${9 / currentScale}px`);
        });

      svg.call(zoom as any);

      const simulation = d3.forceSimulation<any>(graph.nodes)
        .force("link", d3.forceLink<any, any>(graph.edges).id(d => d.id).distance(250))
        .force("charge", d3.forceManyBody().strength(-1200))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(100));

      // Define arrow marker
      svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "-0 -5 10 10")
        .attr("refX", 55) // Offset arrow for node radius
        .attr("refY", 0)
        .attr("orient", "auto")
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("xoverflow", "visible")
        .append("path")
        .attr("d", "M 0,-5 L 10,0 L 0,5")
        .attr("fill", "#9a9a83")
        .style("stroke", "none");

      const link = g.append("g")
        .attr("stroke", "#9a9a83")
        .attr("stroke-opacity", 0.4)
        .selectAll("line")
        .data(graph.edges)
        .join("line")
        .attr("marker-end", "url(#arrowhead)")
        .attr("stroke-width", 1.5);

      const edgeLabels = g.append("g")
        .selectAll("text")
        .data(graph.edges)
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
        .data(graph.nodes)
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
          const type = d.type?.toLowerCase() || "";
          if (type.includes('personne') || type.includes('acteur')) return "#4a4e40";
          if (type.includes('idée') || type.includes('concept')) return "#bc6c25";
          return "#b08968";
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

      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

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
    };

    const simulation = updateDimensions();
    const resizeObserver = new ResizeObserver(() => updateDimensions());
    resizeObserver.observe(containerRef.current);
    return () => {
      if (simulation) simulation.stop();
      resizeObserver.disconnect();
    };
  }, [graph]);

  const exportToCypher = () => {
    const nodes = graph.nodes.map(n => `CREATE (n${n.id.replace(/-/g, '')}:${n.type.replace(/\s+/g, '')} {id: "${n.id}", label: "${n.label}"})`).join('\n');
    const edges = graph.edges.map(e => `MATCH (a), (b) WHERE a.id = "${e.source}" AND b.id = "${e.target}" CREATE (a)-[:${e.label.replace(/\s+/g, '_').toUpperCase()}]->(b)`).join('\n');
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
        {(!graph || !graph.nodes || graph.nodes.length === 0) && (
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
