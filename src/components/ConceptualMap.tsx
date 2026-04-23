import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Conversation, Segment } from '../types';
import { Maximize2 } from 'lucide-react';

interface ConceptualMapProps {
  conversation: Conversation;
  segments: Segment[];
  onFullscreen?: () => void;
  onSelectSegment?: (segment: Segment) => void;
}

interface TreeNode {
  id: string;
  name: string;
  type: 'root' | 'theme' | 'tag' | 'segment' | 'summary';
  role?: string;
  isPivot?: boolean;
  parentLabel?: string;
  children?: TreeNode[];
  value?: string;
}

export function ConceptualMap({ conversation, segments, onFullscreen, onSelectSegment }: ConceptualMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !conversation || !segments.length) return;

    const width = 1200;
    const height = 800;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Zoom setup
    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        // Keep font size consistent relative to the user's view
        const currentScale = event.transform.k;
        g.selectAll(".node text")
          .style("font-size", (d: any) => {
             const baseSize = d.data.type === 'root' ? 18 : 12;
             return `${baseSize / currentScale}px`;
          });
        g.selectAll(".link-label textPath")
          .style("font-size", `${7 / currentScale}px`);
      });

    svg.call(zoom as any);

    // Dynamic Tree Logic - Linear Path with Branches
    // Build the tree data structure safely
    const buildHierarchy = () => {
      const nodeMap = new Map<string, TreeNode>();
      
      const rootNode: TreeNode = {
        id: 'root',
        name: conversation.title,
        type: 'root',
        children: []
      };
      nodeMap.set('root', rootNode);

      // Add Summary/Synthesis node
      if (conversation.semanticAnalysis?.summary) {
        rootNode.children!.push({
          id: 'summary',
          name: "Synthèse Socratique",
          type: 'summary',
          value: conversation.semanticAnalysis.summary,
          parentLabel: "RÉSULTANTE",
          children: []
        });
      }

      // Add Global Themes (Concepts)
      const themes = conversation.semanticAnalysis?.themes || [];
      if (themes.length > 0) {
        const themeAnchor: TreeNode = {
          id: 'themes-root',
          name: "Concepts Clés",
          type: 'theme',
          parentLabel: "ONTOLOGIE",
          children: themes.map((t, idx) => ({
            id: `theme-${idx}`,
            name: t,
            type: 'theme',
            parentLabel: "AXE",
            children: []
          }))
        };
        rootNode.children!.push(themeAnchor);
      }

      segments.forEach(s => {
        const segNode: TreeNode = {
          id: s.id,
          name: s.content.length > 50 ? s.content.substring(0, 50) + "..." : s.content,
          type: 'segment',
          role: s.role,
          isPivot: s.metadata?.isPivot,
          parentLabel: s.parentLabel || s.metadata?.reason,
          children: []
        };

        // Add Role branch
        segNode.children!.push({
          id: `role-${s.id}`,
          name: s.role === 'assistant' ? "SOCRATE" : "EXPLORATEUR",
          type: 'theme',
          parentLabel: "STANCE",
          children: []
        });

        // Add Pivot branch
        if (s.metadata?.isPivot) {
          segNode.children!.push({
            id: `pivot-${s.id}`,
            name: "Bifurcation",
            type: 'summary',
            parentLabel: "CHANGEMENT",
            children: []
          });
        }

        // Add Tags branch
        if (s.tags && s.tags.length > 0) {
          segNode.children!.push({
            id: `tags-root-${s.id}`,
            name: "Essence",
            type: 'theme',
            parentLabel: "CONCEPTS",
            children: s.tags.map((tag, idx) => ({
              id: `tag-${s.id}-${idx}`,
              name: tag,
              type: 'tag',
              children: []
            }))
          });
        }

        nodeMap.set(s.id, segNode);
      });

      // 2. Link them
      segments.forEach((s, i) => {
        const node = nodeMap.get(s.id);
        if (!node) return;

        let pId = s.parentId;
        if (!pId) {
          if (i === 0) pId = 'root';
          else pId = segments[i - 1].id;
        }

        const parent = nodeMap.get(pId);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
        } else {
          rootNode.children!.push(node);
        }
      });

      return rootNode;
    };

    const flowData = buildHierarchy();
    const root = d3.hierarchy(flowData);
    
    // Use a larger size and better separation
    const treeLayout = d3.tree<TreeNode>().nodeSize([200, 400]);
    treeLayout(root);

    // Apply vertical jitter/offset to ensure curves even in linear paths
    root.descendants().forEach((d, i) => {
      // Offset assistant and user nodes slightly to force curves in the links
      if (d.data.type === 'segment') {
        const roleOffset = (d.data as TreeNode).role === 'assistant' ? 40 : -40;
        d.x += roleOffset;
      }
    });

    // Links with Curves and Labels
    const linkGroup = g.selectAll(".link-group")
      .data(root.links())
      .enter().append("g")
      .attr("class", "link-group");

    // Horizontal Link Generator
    const horizontalLink = d3.linkHorizontal<any, any>()
      .x(d => d.y)
      .y(d => d.x);

    linkGroup.append("path")
      .attr("class", "link-path")
      .attr("id", (d, i) => `link-path-${i}`)
      .attr("fill", "none")
      .attr("stroke", d => {
        const target = d.target.data as TreeNode;
        return (target.isPivot || target.parentLabel) ? "#bc6c25" : "#4a4e40";
      })
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", d => (d.target.data as TreeNode).isPivot ? 3 : 1.5)
      .attr("stroke-dasharray", d => d.target.data.type === 'tag' ? "3,3" : "0")
      .attr("d", horizontalLink as any);

    // Add text labels on the paths
    linkGroup.filter(d => !!(d.target.data as any).parentLabel)
      .append("text")
      .attr("class", "link-label")
      .attr("dy", -5)
      .append("textPath")
      .attr("href", (d, i) => `#link-path-${root.links().indexOf(d)}`)
      .attr("startOffset", "40%")
      .style("font-size", "7px")
      .style("font-weight", "900")
      .style("text-transform", "uppercase")
      .style("letter-spacing", "0.1em")
      .style("fill", "#bc6c25")
      .style("font-family", "sans-serif")
      .text(d => (d.target.data as any).parentLabel);

    // Nodes
    const node = g.selectAll(".node")
      .data(root.descendants())
      .enter().append("g")
      .attr("class", d => `node type-${d.data.type}`)
      .attr("transform", d => `translate(${d.y},${d.x})`)
      .style("cursor", d => d.data.type === 'segment' ? "pointer" : "default")
      .on("click", (event, d) => {
        if (d.data.type === 'segment' && onSelectSegment) {
          const segment = segments.find(s => s.id === (d.data as TreeNode).id);
          if (segment) onSelectSegment(segment);
        }
      });

    node.append("circle")
      .attr("r", d => {
        if (d.data.type === 'root') return 12;
        if (d.data.type === 'summary') return 10;
        if (d.data.type === 'theme') return 8;
        return 7;
      })
      .attr("fill", d => {
        if (d.data.type === 'root') return "#283618";
        if (d.data.type === 'summary') return "#bc6c25";
        if (d.data.type === 'theme') return "#606c38";
        if ((d.data as TreeNode).isPivot) return "#bc6c25";
        if (d.data.type === 'tag') return "#fefae0";
        if (d.data.type === 'segment' && (d.data as TreeNode).role === 'assistant') return "#606c38";
        return "#dda15e";
      })
      .attr("stroke", d => {
        if (d.data.type === 'tag') return "#bc6c25";
        return "#fff";
      })
      .attr("stroke-width", 2);

    // Label container for segments
    node.append("text")
      .attr("dy", d => d.data.type === 'segment' ? "-1.2em" : ".35em")
      .attr("x", d => d.children ? -15 : 15)
      .style("text-anchor", d => d.children ? "end" : "start")
      .style("font-size", d => d.data.type === 'root' ? "18px" : "12px")
      .style("font-family", d => d.data.type === 'root' ? "serif" : "sans-serif")
      .style("font-weight", d => (d.data.type === 'root' || (d.data as TreeNode).isPivot) ? "900" : "600")
      .style("fill", d => {
        if (d.data.type === 'root') return "#2d2d2a";
        if ((d.data as TreeNode).isPivot) return "#8b5e34";
        return "#1a1a1a";
      })
      .text(d => d.data.name)
      .each(function(d) {
        if (d.data.type === 'segment') {
           d3.select(this).style("font-style", "italic");
        }
      });

    // Icons for segments
    node.filter(d => d.data.type === 'segment')
      .append("text")
      .attr("font-family", "serif")
      .attr("font-size", "8px")
      .attr("text-anchor", "middle")
      .attr("dy", "3px")
      .attr("fill", "white")
      .text(d => (d.data as TreeNode).role === 'assistant' ? 'S' : 'E');

    // Initial transform to center
    svg.call(zoom.transform as any, d3.zoomIdentity.translate(width / 6, height / 2).scale(0.8));

  }, [conversation, segments]);

  return (
    <div className="bg-white rounded-[40px] border border-natural-sand shadow-sm overflow-hidden flex flex-col h-[700px] relative group" ref={containerRef}>
      <div className="absolute top-8 left-8 z-10 pointer-events-none">
        <h3 className="font-serif text-3xl text-natural-heading mb-2">Parcours Conceptuel</h3>
        <p className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.3em] flex items-center gap-2">
           <span className="w-2 h-2 bg-natural-brown rounded-full"></span>
           Bifurcations & Synthèse Sémantique
        </p>
      </div>
      
      <div className="absolute top-8 right-8 z-20 flex flex-col gap-2">
        {onFullscreen && (
          <button 
            onClick={onFullscreen}
            className="flex items-center gap-2 bg-natural-accent text-white px-4 py-2.5 rounded-2xl shadow-lg shadow-natural-accent/20 hover:bg-natural-accent/90 transition-all font-bold text-xs uppercase tracking-widest self-end mb-2"
          >
            <Maximize2 className="w-4 h-4" />
            Plein Écran
          </button>
        )}
        <div className="bg-white p-4 rounded-2xl border border-natural-sand text-[10px] space-y-2 shadow-sm border-2">
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-[#606c38] rounded-full"></div> <span className="font-bold text-natural-heading">Socrate (Assistant)</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-[#dda15e] rounded-full border border-white"></div> <span className="font-bold text-natural-heading">Explorateur (User)</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-[#bc6c25] rounded-full"></div> <span className="font-bold text-[#bc6c25]">Bifurcation (Pivot)</span></div>
          <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 bg-[#fefae0] border border-[#bc6c25] rounded-full"></div> <span className="text-natural-muted font-bold">Concepts / Thématiques</span></div>
        </div>
        <p className="text-[10px] text-natural-heading text-right uppercase tracking-widest font-black bg-white/50 backdrop-blur px-2 py-1 rounded">Cliquez sur un segment pour lire</p>
      </div>

      <div className="flex-1 w-full bg-natural-bg/20">
        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"></svg>
      </div>
    </div>
  );
}
