import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { KnowledgeGraph, SegmentationTrace } from '../types';
import { Share2, Info, Maximize2, Download, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';

interface KnowledgeGraphViewProps {
  graph: KnowledgeGraph;
  onFullscreen?: () => void;
  standalone?: boolean;
  contextCorpus?: string[];
  trace?: SegmentationTrace;
}

type NodeInsight = {
  label: string;
  references: string[];
  themeSummary: string;
};

const LOCAL_STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'en', 'dans', 'sur', 'avec', 'pour', 'par',
  'que', 'qui', 'quoi', 'dont', 'est', 'sont', 'etre', 'avoir', 'this', 'that', 'with', 'from', 'into', 'about',
  'the', 'and', 'for', 'you', 'your', 'their', 'our', 'mais', 'donc', 'car', 'plus', 'moins', 'pas', 'comme',
  'nous', 'vous', 'ils', 'elles', 'elle', 'lui', 'eux', 'aux', 'au', 'ce', 'cet', 'cette', 'ces'
]);

function normalizeToken(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeInterest(text: string): string[] {
  return normalizeToken(text).split(/\s+/).filter((t) => t.length > 2);
}

function vectorizeInterest(text: string): Map<string, number> {
  const map = new Map<string, number>();
  tokenizeInterest(text).forEach((t) => map.set(t, (map.get(t) || 0) + 1));
  return map;
}

function cosineInterest(a: Map<string, number>, b: Map<string, number>) {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((va, k) => {
    na += va * va;
    dot += va * (b.get(k) || 0);
  });
  b.forEach((vb) => {
    nb += vb * vb;
  });
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function scoreAttributeAgainstText(attributeLabel: string, unitText: string) {
  const label = String(attributeLabel || '').trim();
  const text = String(unitText || '').trim();
  if (!label || !text) return 0;
  const labelVec = vectorizeInterest(label);
  const unitVec = vectorizeInterest(text);
  const labelTokens = tokenizeInterest(label);
  const unitTokenSet = new Set(tokenizeInterest(text));
  const bestCosine = cosineInterest(labelVec, unitVec);
  const bestLexical = labelTokens.length
    ? labelTokens.filter((t) => unitTokenSet.has(t)).length / labelTokens.length
    : 0;
  const phraseHit = labelTokens.length
    ? tokenizeInterest(text).join(' ').includes(labelTokens.join(' '))
    : false;
  // Use a blended score instead of max() to avoid binary/over-polarized 100% outputs.
  const blended = (bestCosine * 0.6) + (bestLexical * 0.35) + ((phraseHit ? 1 : 0) * 0.05);
  return Math.max(0, Math.min(1, blended));
}

function scoreAttributeAgainstCorpus(attributeLabel: string, units: string[]) {
  const scored = (units || [])
    .map((unit) => scoreAttributeAgainstText(attributeLabel, unit))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);
  if (!scored.length) return 0;
  const top = scored.slice(0, Math.min(5, scored.length));
  const weights = [1, 0.8, 0.6, 0.4, 0.2];
  const weightedSum = top.reduce((sum, score, idx) => sum + score * weights[idx], 0);
  const weightTotal = top.reduce((sum, _score, idx) => sum + weights[idx], 0) || 1;
  return Math.max(0, Math.min(1, weightedSum / weightTotal));
}

function slugLabel(value: string) {
  return normalizeToken(String(value || '')).replace(/\s+/g, '-').trim();
}

function collectNodeContextFromCorpus(label: string, corpus: string[]) {
  const normalizedLabel = normalizeToken(label);
  if (!normalizedLabel) return '';
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const chunk of corpus || []) {
    const clean = toHumanReadableChunk(chunk);
    if (!clean) continue;
    for (const sentence of splitIntoSentences(clean)) {
      const normSentence = normalizeToken(sentence);
      if (!normSentence || !normSentence.includes(normalizedLabel)) continue;
      if (seen.has(normSentence)) continue;
      seen.add(normSentence);
      refs.push(sentence);
      if (refs.length >= 12) break;
    }
    if (refs.length >= 12) break;
  }
  return refs.join(' ');
}

function decodeEntities(text: string) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function toHumanReadableChunk(text: string) {
  const raw = String(text || '');
  const withoutMarkup = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutMarkup)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoSentences(text: string) {
  return String(text || '')
    .replace(/[ \t]+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitIntoReadableLines(text: string) {
  return String(text || '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isRelativeTimeLine(line: string) {
  return /^\d+\s+(hours?|hrs?|hr|h|minutes?|mins?|min|m)\s+ago\b/i.test(String(line || '').trim());
}

function buildNodeInsight(label: string, corpus: string[]): NodeInsight {
  const normalizedLabel = normalizeToken(label);
  const refs: string[] = [];
  const seen = new Set<string>();
  const timelineRefs: string[] = [];
  const seenTimeline = new Set<string>();

  corpus.forEach((chunk) => {
    const cleanChunk = toHumanReadableChunk(chunk);
    if (!cleanChunk) return;
    splitIntoReadableLines(cleanChunk).forEach((line) => {
      if (!isRelativeTimeLine(line)) return;
      const normalized = normalizeToken(line);
      if (seenTimeline.has(normalized)) return;
      seenTimeline.add(normalized);
      timelineRefs.push(line);
    });
    splitIntoSentences(cleanChunk).forEach((sentence) => {
      const normalized = normalizeToken(sentence);
      if (!normalizedLabel || !normalized.includes(normalizedLabel)) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      refs.push(sentence);
    });
  });

  const mergedRefs = [...timelineRefs, ...refs];
  const limitedRefs = mergedRefs.slice(0, 80);
  const freq = new Map<string, number>();
  limitedRefs.forEach((ref) => {
    normalizeToken(ref).split(' ').forEach((token) => {
      if (token.length < 4 || LOCAL_STOP_WORDS.has(token)) return;
      if (token === normalizedLabel) return;
      freq.set(token, (freq.get(token) || 0) + 1);
    });
  });
  const topThemes = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([token]) => token);
  const themeSummary = topThemes.length
    ? `Themes associes: ${topThemes.join(', ')}`
    : `Themes associes: corpus trop court ou peu d'occurrences autour de "${label}".`;

  return {
    label,
    references: limitedRefs,
    themeSummary,
  };
}

export function KnowledgeGraphView({ graph, onFullscreen, standalone = false, contextCorpus = [], trace }: KnowledgeGraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRadius = 50;
  const arrowOffset = 14;
  const rawMarkerId = useId();
  const markerId = useMemo(() => `arrowhead-${rawMarkerId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawMarkerId]);
  const [selectedNodeInsight, setSelectedNodeInsight] = useState<NodeInsight | null>(null);
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
  const [abstractionLevelColors, setAbstractionLevelColors] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {
      concret: '#0ea5e9',
      intermediaire: '#10b981',
      conceptuel: '#f59e0b',
      meta: '#a855f7',
    };
    try {
      const raw = localStorage.getItem('ABSTRACTION_LEVEL_COLORS');
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  });
  const [activeSemanticCollectionId, setActiveSemanticCollectionId] = useState<string>(() =>
    localStorage.getItem('SELECTED_SEMANTIC_COLLECTION_ID') || ''
  );
  const [activeSemanticSimilarity, setActiveSemanticSimilarity] = useState<number>(() => {
    const raw = localStorage.getItem('SEMANTIC_SIMILARITY_THRESHOLD');
    const n = raw ? Number(raw) : 0.35;
    if (!Number.isFinite(n)) return 0.35;
    return Math.max(0, Math.min(1, n));
  });
  const semanticAttributes = useLiveQuery(() => db.semanticAttributes.toArray()) || [];
  const semanticAttributeCollections = useLiveQuery(() => db.semanticAttributeCollections.toArray()) || [];

  useEffect(() => {
    const syncColors = () => {
      try {
        const raw = localStorage.getItem('SEMANTIC_POSITION_COLORS');
        if (raw) setSemanticPositionColors((prev) => ({ ...prev, ...JSON.parse(raw) }));
        const rawAbstraction = localStorage.getItem('ABSTRACTION_LEVEL_COLORS');
        if (rawAbstraction) setAbstractionLevelColors((prev) => ({ ...prev, ...JSON.parse(rawAbstraction) }));
      } catch {
        // ignore parse failures
      }
    };
    const handler = () => syncColors();
    window.addEventListener('semantic-position-colors-changed', handler as EventListener);
    window.addEventListener('semantic-style-changed', handler as EventListener);
    return () => {
      window.removeEventListener('semantic-position-colors-changed', handler as EventListener);
      window.removeEventListener('semantic-style-changed', handler as EventListener);
    };
  }, []);
  useEffect(() => {
    const syncSemanticProfile = () => {
      setActiveSemanticCollectionId(localStorage.getItem('SELECTED_SEMANTIC_COLLECTION_ID') || '');
      const raw = localStorage.getItem('SEMANTIC_SIMILARITY_THRESHOLD');
      const n = raw ? Number(raw) : 0.35;
      setActiveSemanticSimilarity(Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.35);
    };
    const handler = () => syncSemanticProfile();
    window.addEventListener('semantic-profile-changed', handler as EventListener);
    window.addEventListener('storage', handler as EventListener);
    return () => {
      window.removeEventListener('semantic-profile-changed', handler as EventListener);
      window.removeEventListener('storage', handler as EventListener);
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
  const activeAttributeLabels = useMemo(() => {
    const selectedCollection = semanticAttributeCollections.find((c: any) => c.id === activeSemanticCollectionId);
    if (!selectedCollection) return [] as string[];
    return semanticAttributes
      .filter((a: any) => selectedCollection.attributeIds.includes(a.id))
      .map((a: any) => String(a.label || '').trim())
      .filter(Boolean);
  }, [semanticAttributeCollections, semanticAttributes, activeSemanticCollectionId]);
  const effectiveAttributeLabels = useMemo(() => {
    if (activeAttributeLabels.length > 0) return activeAttributeLabels;
    const traceLabels = Array.isArray(trace?.semanticAttributeLabels)
      ? trace!.semanticAttributeLabels!.map((label) => String(label || '').trim()).filter(Boolean)
      : [];
    return traceLabels;
  }, [activeAttributeLabels, trace]);
  const attributeCorpusScores = useMemo(() => {
    if (!effectiveAttributeLabels.length) return new Map<string, number>();
    const corpusUnits = [
      ...contextCorpus.map((u) => String(u || '')),
      ...safeGraph.nodes.map((n: any) => `${String(n?.label || '')} ${String(n?.type || '')} ${String(n?.properties?.semanticPosition || '')}`),
    ].filter((u) => String(u || '').trim().length > 0);
    const map = new Map<string, number>();
    effectiveAttributeLabels.forEach((label) => {
      const best = scoreAttributeAgainstCorpus(label, corpusUnits);
      map.set(label, Math.max(0, Math.min(1, best)));
    });
    return map;
  }, [effectiveAttributeLabels, contextCorpus, safeGraph]);
  const displayGraph = useMemo(() => {
    if (!safeGraph?.nodes?.length || !effectiveAttributeLabels.length) return safeGraph;
    const threshold = Number.isFinite(activeSemanticSimilarity)
      ? activeSemanticSimilarity
      : (Number.isFinite(trace?.similarityThreshold as number) ? Number(trace!.similarityThreshold) : 0.35);
    const contentNodes = safeGraph.nodes.map((node: any) => {
      const nodeText = `${String(node?.label || '')} ${String(node?.type || '')} ${String(node?.properties?.semanticPosition || '')}`;
      const nodeContext = collectNodeContextFromCorpus(String(node?.label || ''), contextCorpus);
      const fullNodeText = `${nodeText} ${nodeContext}`.trim();
      const scoredAttributes = effectiveAttributeLabels
        .map((label) => ({ label, score: scoreAttributeAgainstText(label, fullNodeText) }))
        .sort((a, b) => b.score - a.score);
      const best = scoredAttributes.length ? scoredAttributes[0].score : 0;
      const matched = scoredAttributes.filter((entry) => entry.score >= threshold).map((entry) => entry.label);
      const topScored = scoredAttributes.slice(0, 5).map((entry) => ({
        label: entry.label,
        score: Math.round(entry.score * 1000) / 10,
      }));
      return {
        ...node,
        properties: {
          ...(node.properties || {}),
          isProfileAttribute: false,
          adherenceRate: Math.max(0, Math.min(1, best)),
          matchedAttributes: matched,
          scoredAttributes: topScored,
        },
      };
    });
    const profileNodes = effectiveAttributeLabels.map((label) => {
      const bestAcrossNodes = Number(attributeCorpusScores.get(label) || 0);
      return {
        id: `profile-attr-${slugLabel(label)}`,
        label,
        type: 'ProfilAttribut',
        properties: {
          semanticPosition: 'theme',
          isProfileAttribute: true,
          adherenceRate: Math.max(0, Math.min(1, bestAcrossNodes)),
          matchedAttributes: bestAcrossNodes >= threshold ? [label] : [],
          scoredAttributes: [{ label, score: Math.round(bestAcrossNodes * 1000) / 10 }],
        },
      };
    });

    const profileEdges = effectiveAttributeLabels.flatMap((label) => {
      let targetNodes = contentNodes
        .map((n: any) => {
          const scored = Array.isArray(n?.properties?.scoredAttributes) ? n.properties.scoredAttributes : [];
          const hit = scored.find((entry: any) => entry?.label === label);
          const scorePct = Number(hit?.score);
          return { nodeId: String(n.id), scorePct: Number.isFinite(scorePct) ? scorePct : 0 };
        })
        .sort((a, b) => b.scorePct - a.scorePct)
        .slice(0, 3);
      const strong = targetNodes.filter((row) => row.scorePct >= 15);
      if (strong.length > 0) {
        targetNodes = strong;
      } else {
        targetNodes = targetNodes.slice(0, 2).filter((row) => row.scorePct > 0);
      }
      return targetNodes.map((row, index) => ({
        id: `profile-edge-${slugLabel(label)}-${row.nodeId}-${index}`,
        source: `profile-attr-${slugLabel(label)}`,
        target: row.nodeId,
        label: `${row.scorePct.toFixed(1)}%`,
      }));
    });

    const nodes = [...contentNodes, ...profileNodes];
    const edges = [...safeGraph.edges, ...profileEdges];
    return { ...safeGraph, nodes, edges };
  }, [safeGraph, effectiveAttributeLabels, activeSemanticSimilarity, trace, contextCorpus, attributeCorpusScores]);
  const interestSummary = useMemo(() => {
    const nodes = Array.isArray(displayGraph?.nodes)
      ? displayGraph.nodes.filter((n: any) => !n?.properties?.isProfileAttribute)
      : [];
    const scored = nodes
      .map((n: any) => Number(n?.properties?.adherenceRate))
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.max(0, Math.min(1, v)));
    if (!scored.length) {
      return {
        hasScore: false,
        global: 0,
        topAttributes: [] as Array<{ label: string; count: number }>,
      };
    }
    const global = scored.reduce((sum, v) => sum + v, 0) / scored.length;
    const counts = new Map<string, number>();
    nodes.forEach((n: any) => {
      const matched = Array.isArray(n?.properties?.matchedAttributes)
        ? n.properties.matchedAttributes
        : [];
      matched.forEach((attr: any) => {
        const label = String(attr || '').trim();
        if (!label) return;
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });
    const topAttributes = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));
    return { hasScore: true, global, topAttributes };
  }, [displayGraph]);
  const runtimeInterestSummary = useMemo(() => {
    if (!effectiveAttributeLabels.length) {
      return {
        hasScore: false,
        global: 0,
        topAttributes: [] as Array<{ label: string; count: number }>,
      };
    }
    if (!attributeCorpusScores.size) {
      return {
        hasScore: false,
        global: 0,
        topAttributes: [] as Array<{ label: string; count: number }>,
      };
    }

    const threshold = Number.isFinite(activeSemanticSimilarity)
      ? activeSemanticSimilarity
      : (Number.isFinite(trace?.similarityThreshold as number) ? Number(trace!.similarityThreshold) : 0.35);
    const entries = effectiveAttributeLabels.map((label) => {
      const score = Number(attributeCorpusScores.get(label) || 0);
      return { label, score: Math.max(0, Math.min(1, score)), matched: score >= threshold };
    });

    const global = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
    return {
      hasScore: true,
      global: Math.max(0, Math.min(1, global)),
      topAttributes: entries
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((e) => ({ label: e.label, count: Math.max(0, Math.round(e.score * 1000) / 10) })),
    };
  }, [effectiveAttributeLabels, activeSemanticSimilarity, displayGraph, trace, attributeCorpusScores]);
  const interestDisplay = useMemo(() => {
    if (runtimeInterestSummary.hasScore) return runtimeInterestSummary;
    if (interestSummary.hasScore) return interestSummary;
    if (!trace || !Number.isFinite(trace.interestGlobalScore as number)) {
      return interestSummary;
    }
    const traceAttrs = Array.isArray(trace.interestAttributeScores)
      ? trace.interestAttributeScores
      : [];
    const topAttributes = traceAttrs
      .filter((entry) => entry && String(entry.label || '').trim().length > 0)
      .filter((entry) => entry.matched || Number(entry.score) >= 0.2)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 5)
      .map((entry) => ({ label: String(entry.label), count: Math.max(0, Math.round(Number(entry.score || 0) * 1000) / 10) }));
    return {
      hasScore: true,
      global: Number(trace.interestGlobalScore),
      topAttributes,
    };
  }, [runtimeInterestSummary, interestSummary, trace]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (!displayGraph.nodes.length) return;

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
      // D3 mutates link source/target in-place; work on cloned arrays to avoid stale references across rerenders.
      const simNodes = displayGraph.nodes.map((n: any) => ({ ...n, properties: { ...(n?.properties || {}) } }));
      const simEdges = displayGraph.edges.map((e: any) => ({
        ...e,
        source: typeof e?.source === 'object' ? String(e.source?.id || '') : String(e?.source || ''),
        target: typeof e?.target === 'object' ? String(e.target?.id || '') : String(e?.target || ''),
      }));
      const simulation = d3.forceSimulation<any>(simNodes)
        .force("link", d3.forceLink<any, any>(simEdges).id(d => d.id).distance(250))
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
        .data(simEdges)
        .join("line")
        .attr("marker-end", `url(#${markerId})`)
        .attr("stroke-width", 1.5);

      const edgeLabels = g.append("g")
        .selectAll("text")
        .data(simEdges)
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
        .data(simNodes)
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
          }) as any)
        .on("click", (_event: any, d: any) => {
          const insight = buildNodeInsight(d.label || d.id || "Node", contextCorpus || []);
          setSelectedNodeInsight(insight);
        });

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
        .attr("stroke", (d: any) => {
          const level = String(d?.properties?.abstractionLevel || '').toLowerCase();
          return abstractionLevelColors[level] || abstractionLevelColors.intermediaire || '#ffffff';
        })
        .attr("stroke-width", 3)
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
          return `${(Math.max(0, Math.min(1, score)) * 100).toFixed(1)}%`;
        });

      node.append("title")
        .text((d: any) => {
          const score = Number(d?.properties?.adherenceRate);
          const matched = Array.isArray(d?.properties?.matchedAttributes) ? d.properties.matchedAttributes : [];
          const scored = Array.isArray(d?.properties?.scoredAttributes) ? d.properties.scoredAttributes : [];
          if (!Number.isFinite(score)) {
            return `${d.label}\nAdhésion: non calculée`;
          }
          const pct = (Math.max(0, Math.min(1, score)) * 100).toFixed(1);
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
  }, [displayGraph, markerId, semanticPositionColors, abstractionLevelColors, contextCorpus]);

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

      <div className="absolute top-[86px] left-6 z-10 pointer-events-none">
        <div className="bg-white/90 backdrop-blur border border-natural-sand rounded-2xl px-3 py-2 shadow-sm max-w-[560px]">
          {interestDisplay.hasScore ? (
            <div className="space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-natural-muted">
                Profil d&apos;interet local (moyenne): {(interestDisplay.global * 100).toFixed(1)}%
              </p>
              {false && interestDisplay.topAttributes.length > 0 && (
                <p className="text-[10px] text-natural-stone leading-relaxed">
                  {interestSummary.topAttributes.map((a) => `${a.label} (${a.count})`).join(' • ')}
                </p>
              )}
              {interestDisplay.topAttributes.length > 0 && (
                <p className="text-[10px] text-natural-stone leading-relaxed">
                  {interestDisplay.topAttributes.map((a) => `${a.label} (${a.count}%)`).join(', ')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[9px] font-black uppercase tracking-widest text-natural-muted">
              Profil d&apos;interet local: non calcule
            </p>
          )}
        </div>
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
        {displayGraph.nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-natural-muted p-8 text-center bg-natural-sand/20">
            <Info className="w-10 h-10 mb-4 opacity-30" />
            <p className="font-serif text-lg italic opacity-70">Aucun graphe extrait pour ce segment</p>
          </div>
        )}
        <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"></svg>
      </div>
      {selectedNodeInsight && (
        <div className="absolute inset-0 z-30 bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={() => setSelectedNodeInsight(null)}>
          <div
            className="w-full max-w-3xl max-h-[80vh] bg-white border border-natural-sand rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-natural-sand flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-black text-natural-muted">References du noeud</p>
                <h4 className="font-serif text-2xl text-natural-heading">{selectedNodeInsight.label}</h4>
              </div>
              <button
                onClick={() => setSelectedNodeInsight(null)}
                className="p-2 rounded-xl hover:bg-natural-sand text-natural-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[62vh] overflow-y-auto space-y-4">
              <div className="bg-natural-bg/40 border border-natural-sand rounded-2xl p-4 text-sm text-natural-heading">
                {selectedNodeInsight.themeSummary}
              </div>
              {selectedNodeInsight.references.length === 0 ? (
                <p className="text-sm text-natural-muted italic">Aucune reference explicite retrouvee pour ce noeud dans le corpus courant.</p>
              ) : (
                <div className="space-y-2">
                  {selectedNodeInsight.references.map((ref, idx) => (
                    <div key={`${idx}-${ref.slice(0, 20)}`} className="p-3 rounded-xl border border-natural-sand bg-white text-sm text-natural-text">
                      {ref}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
