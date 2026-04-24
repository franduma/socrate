import { GoogleGenerativeAI } from "@google/generative-ai";
import { Segment } from "../types";
import { v4 as uuidv4 } from "uuid";

type Provider = "gemini" | "hardwired_gemini" | "openai" | "claude" | "openrouter" | "codex";
export type SegmentGranularity = "intact" | "balanced" | "fine" | "markup";

type AnalysisResult = {
  title: string;
  segments: (Partial<Segment> & { metadata: { isPivot?: boolean; reason?: string } })[];
  analysis: {
    summary: string;
    themes: string[];
    suggestedTags: string[];
    deviations: string[];
    semanticSignature: string;
    knowledgeGraph: {
      nodes: { id: string; label: string; type: string; properties?: Record<string, any> }[];
      edges: { id: string; source: string; target: string; label: string }[];
    };
  };
};

export type ConnectionTestResult = {
  ok: boolean;
  provider: Provider;
  model?: string;
  details?: string;
};

type AnalyzeOptions = {
  granularity?: SegmentGranularity;
  customSegmentationInstruction?: string;
  semanticCollectionName?: string;
  semanticAttributeLabels?: string[];
  similarityThreshold?: number;
  vectorEngineMode?: "local" | "provider";
};

const GEMINI_MODELS_TO_TRY = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.5-flash-8b",
  "gemini-pro",
];

const OPENAI_MODELS_TO_TRY = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
const ABSTRACTION_SCORE_BY_LEVEL: Record<string, number> = {
  concret: 0.2,
  intermediaire: 0.45,
  conceptuel: 0.72,
  meta: 0.9,
};

const SEMANTIC_POSITION_BY_TYPE: Record<string, string> = {
  question: "position_initiale",
  initialposition: "position_initiale",
  socraticanalysis: "analyse_socratique",
  analysis: "analyse_socratique",
  concept: "concept",
  theme: "concept",
  keyword: "concept",
  evidence: "preuve",
  source: "preuve",
  actor: "acteur",
  person: "acteur",
  personne: "acteur",
  deviation: "deviation",
  objection: "deviation",
  conversation: "meta",
  tag: "meta",
};

const SEMANTIC_STOP_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "et", "ou", "mais", "donc", "or", "ni", "car",
  "que", "qui", "quoi", "dont", "où", "ce", "cet", "cette", "ces", "se", "sa", "son", "ses", "en", "dans",
  "sur", "sous", "avec", "sans", "pour", "par", "pas", "plus", "moins", "ne", "au", "aux", "a", "à", "est",
  "sont", "être", "été", "avoir", "fait", "faire", "comme", "si", "on", "il", "elle", "ils", "elles", "nous",
  "vous", "je", "tu", "mon", "ton", "ma", "ta", "mes", "tes", "leurs", "leur", "y", "lui", "eux", "cela",
  "ça", "c", "j", "n", "m", "t", "s", "qu", "aujourd", "hui"
]);

function getSegmentationInstruction(granularity: SegmentGranularity) {
  if (granularity === "intact") {
    return "Segmentation=INTACT: conserve de grands blocs cohérents. Vise 1 à 4 segments maximum.";
  }
  if (granularity === "fine") {
    return "Segmentation=FINE: découpe en micro-unités sémantiques (1 à 3 idées clés par segment). Vise 8 à 18 segments selon la longueur.";
  }
  if (granularity === "markup") {
    return "Segmentation=MARKUP: si l'entrée est du HTML/XML, sépare le code source du contenu lisible humain. Crée au minimum 2 segments: CODE_MARKUP puis CONTENU_EXTRAT. Conserve le texte complet.";
  }
  return "Segmentation=BALANCED: découpe équilibrée par intention/question/réponse. Vise 4 à 10 segments selon la longueur.";
}

function getSemanticComparisonInstruction(options?: AnalyzeOptions) {
  const labels = (options?.semanticAttributeLabels || []).filter(Boolean);
  if (!labels.length) return "";
  if (options?.vectorEngineMode === "local") {
    return `
Comparaison semantique:
- Le scoring vectoriel est gere localement par l'application.
- Retourne des noeuds/relations riches, mais n'invente pas de properties.adherenceRate.
`;
  }
  const threshold = typeof options?.similarityThreshold === "number" ? options.similarityThreshold : 0.35;
  const collectionName = options?.semanticCollectionName || "Collection personnalisée";
  return `
Comparaison sémantique guidée:
- Collection active: ${collectionName}
- Attributs de référence: ${labels.join(", ")}
- Seuil de similarité cible: ${threshold}
Pour chaque noeud du graphe, renseigne properties.adherenceRate (0..1) et properties.matchedAttributes (array) selon cette base.
`;
}

function normalizeAbstractionLevel(value: string) {
  const raw = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (raw.includes("meta")) return "meta";
  if (raw.includes("concept")) return "conceptuel";
  if (raw.includes("inter") || raw.includes("median")) return "intermediaire";
  if (raw.includes("concret") || raw.includes("fact")) return "concret";
  return "intermediaire";
}

function inferAbstractionLevel(text: string, type: string) {
  const t = `${text || ""} ${type || ""}`.toLowerCase();
  let score = 0;
  if (/\b(date|heure|lieu|personne|acteur|nom|chiffre|mesure|preuve|source|exemple)\b/.test(t)) score -= 2;
  if (/\b(concept|principe|modele|categorie|structure|hypothese|cadre|abstraction)\b/.test(t)) score += 2;
  if (/\b(methode|epistemologie|meta|critere|cadre d'analyse|strategie)\b/.test(t)) score += 3;
  if (String(text || "").length > 180) score += 1;
  if (score >= 3) return "meta";
  if (score >= 1) return "conceptuel";
  if (score <= -2) return "concret";
  return "intermediaire";
}

function normalizeTypeKey(type: string) {
  return String(type || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferSemanticPosition(type: string) {
  const key = normalizeTypeKey(type);
  return SEMANTIC_POSITION_BY_TYPE[key] || "concept";
}

function tokenizeSemantic(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SEMANTIC_STOP_WORDS.has(w));
}

function toSemanticVector(text: string): Map<string, number> {
  const vec = new Map<string, number>();
  for (const token of tokenizeSemantic(text)) {
    vec.set(token, (vec.get(token) || 0) + 1);
  }
  return vec;
}

function cosineSimilarityMap(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((va, key) => {
    na += va * va;
    const vb = b.get(key) || 0;
    dot += va * vb;
  });
  b.forEach((vb) => {
    nb += vb * vb;
  });
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!denom) return 0;
  return dot / denom;
}

function isQuestionLike(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (t.includes("?")) return true;
  return /\b(pourquoi|comment|que|quoi|quel|quelle|quels|quelles|est-ce|peux-tu|pouvez-vous|dois-je)\b/.test(t);
}

function getAnalysisSignalScore(text: string): number {
  const t = (text || "").toLowerCase();
  let score = 0;
  if (/\b(analyse|interpretation|synthese|conclusion|hypothese|postulat|contradiction|deviation|raisonnement)\b/.test(t)) score += 2;
  if (t.length > 240) score += 1;
  if (/\b(donc|ainsi|en consequence|ce qui implique|il ressort)\b/.test(t)) score += 1;
  if (isQuestionLike(t)) score -= 2;
  return score;
}

function truncateText(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function inferQuestionFromAnalysis(text: string): string {
  const tokens = tokenizeSemantic(text);
  const frequencies = new Map<string, number>();
  tokens.forEach((t) => frequencies.set(t, (frequencies.get(t) || 0) + 1));
  const topWords = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w);
  if (topWords.length === 0) {
    return "Quelle est la question de fond qui a motivé cette analyse socratique ?";
  }
  return `Comment clarifier le lien entre ${topWords.join(", ")} dans cette discussion ?`;
}

function buildLocalVectorDescription(text: string): string {
  const vec = toSemanticVector(text);
  const topTerms = [...vec.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term, weight]) => `${term}:${weight}`);
  if (topTerms.length === 0) return "Vecteur lexical indisponible (texte trop court).";
  return `Vecteur lexical local (top dimensions): ${topTerms.join(" | ")}`;
}

function buildLocalInterpretation(text: string, role: Segment["role"]): string {
  const questionTone = isQuestionLike(text) ? "orienté questionnement" : "orienté assertion";
  const analysisSignal = getAnalysisSignalScore(text);
  const posture = analysisSignal >= 2 ? "analyse structurée" : "propos exploratoire";
  return `Lecture locale: segment ${questionTone}, posture "${posture}", rôle détecté "${role}".`;
}

function isWeakGraphLabel(label: string) {
  const l = String(label || "").trim().toLowerCase();
  if (!l) return true;
  if (/^\d+([.,]\d+)?$/.test(l)) return true;
  if (/^(analyse|analysis|position|segment)\s*\d*$/i.test(l)) return true;
  return false;
}

function makeInformativeLabelFromText(text: string, fallback: string) {
  const tokens = tokenizeSemantic(String(text || ""))
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t))
    .slice(0, 7);
  if (!tokens.length) return fallback;
  return truncateText(tokens.join(" "), 62);
}

function cleanGraphNodeLabel(label: string, contextText = "", fallback = "Concept") {
  const candidate = String(label || "").trim();
  if (!candidate || isWeakGraphLabel(candidate)) {
    return makeInformativeLabelFromText(contextText, fallback);
  }
  return truncateText(candidate, 62);
}

function buildFallbackSegmentGraph(segment: any, index = 0) {
  const sourceText = String(segment.originalText || segment.content || "");
  const topTokens = tokenizeSemantic(sourceText).slice(0, 4);
  const centerId = `seg-core-${index}`;
  const centerAbstraction = segment.role === "assistant" ? "conceptuel" : "concret";
  const centerFallback = segment.role === "assistant" ? `Analyse ${index + 1}` : `Position ${index + 1}`;
  const centerLabel = cleanGraphNodeLabel(
    centerFallback,
    sourceText,
    centerFallback
  );
  const nodes: Array<{ id: string; label: string; type: string; properties?: Record<string, any> }> = [
    {
      id: centerId,
      label: centerLabel,
      type: segment.role === "assistant" ? "Analysis" : "Question",
      properties: {
        semanticPosition: segment.role === "assistant" ? "analyse_socratique" : "position_initiale",
        abstractionLevel: centerAbstraction,
        abstractionScore: ABSTRACTION_SCORE_BY_LEVEL[centerAbstraction],
      },
    },
  ];
  const edges: Array<{ id: string; source: string; target: string; label: string }> = [];
  topTokens.forEach((token, i) => {
    const tokenId = `seg-${index}-kw-${i}`;
    nodes.push({
      id: tokenId,
      label: token,
      type: "Keyword",
      properties: {
        semanticPosition: "concept",
        abstractionLevel: "intermediaire",
        abstractionScore: ABSTRACTION_SCORE_BY_LEVEL.intermediaire,
      },
    });
    edges.push({
      id: `seg-${index}-edge-${i}`,
      source: centerId,
      target: tokenId,
      label: "évoque",
    });
  });
  return { nodes, edges };
}

function buildFallbackConversationGraph(parsed: any): {
  nodes: { id: string; label: string; type: string; properties?: Record<string, any> }[];
  edges: { id: string; source: string; target: string; label: string }[];
} {
  const rootId = `conv-${uuidv4().substring(0, 8)}`;
  const rootLabel = parsed?.title || "Conversation";
  const nodes: { id: string; label: string; type: string; properties?: Record<string, any> }[] = [
    {
      id: rootId,
      label: rootLabel,
      type: "Conversation",
      properties: {
        semanticPosition: "meta",
        abstractionLevel: "meta",
        abstractionScore: ABSTRACTION_SCORE_BY_LEVEL.meta,
      },
    },
  ];
  const edges: { id: string; source: string; target: string; label: string }[] = [];

  const segs = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const maxSegments = Math.min(segs.length, 14);
  const tagNodeMap = new Map<string, string>();
  const segmentNodeIds: string[] = [];

  for (let i = 0; i < maxSegments; i++) {
    const seg = segs[i];
    const sid = `node-seg-${i}`;
    segmentNodeIds.push(sid);
    const rawLabel = String(seg?.content || seg?.originalText || `Segment ${i + 1}`);
    const readableLabel = cleanGraphNodeLabel(rawLabel, rawLabel, `Segment ${i + 1}`);
    nodes.push({
      id: sid,
      label: readableLabel,
      type: seg?.role === "assistant" ? "SocraticAnalysis" : "InitialPosition",
      properties: {
        index: i,
        semanticPosition: seg?.role === "assistant" ? "analyse_socratique" : "position_initiale",
        abstractionLevel: seg?.role === "assistant" ? "conceptuel" : "concret",
        abstractionScore: seg?.role === "assistant" ? ABSTRACTION_SCORE_BY_LEVEL.conceptuel : ABSTRACTION_SCORE_BY_LEVEL.concret,
      },
    });
    edges.push({
      id: `edge-root-${i}`,
      source: rootId,
      target: sid,
      label: seg?.role === "assistant" ? "analyse" : "position",
    });

    const tags = Array.isArray(seg?.tags) ? seg.tags.slice(0, 3) : [];
    tags.forEach((tag: string) => {
      if (!tag || typeof tag !== "string") return;
      let tagNodeId = tagNodeMap.get(tag);
      if (!tagNodeId) {
        tagNodeId = `tag-${tagNodeMap.size}`;
        tagNodeMap.set(tag, tagNodeId);
        nodes.push({
          id: tagNodeId,
          label: tag,
          type: "Tag",
          properties: {
            semanticPosition: "meta",
            abstractionLevel: "intermediaire",
            abstractionScore: ABSTRACTION_SCORE_BY_LEVEL.intermediaire,
          },
        });
      }
      edges.push({
        id: `edge-tag-${i}-${tagNodeId}`,
        source: sid,
        target: tagNodeId,
        label: "catégorie",
      });
    });
  }

  for (let i = 0; i < segmentNodeIds.length - 1; i++) {
    edges.push({
      id: `edge-seq-${i}`,
      source: segmentNodeIds[i],
      target: segmentNodeIds[i + 1],
      label: "enchaîne",
    });
  }

  return { nodes, edges };
}

function ensureGraphCompleteness(parsed: any) {
  if (!parsed?.analysis) parsed.analysis = {};

  const globalKg = parsed.analysis.knowledgeGraph || { nodes: [], edges: [] };
  const globalNodes = Array.isArray(globalKg.nodes) ? globalKg.nodes : [];
  const globalEdges = Array.isArray(globalKg.edges) ? globalKg.edges : [];
  if (globalNodes.length === 0 || globalEdges.length === 0) {
    parsed.analysis.knowledgeGraph = buildFallbackConversationGraph(parsed);
  }

  if (!Array.isArray(parsed.segments)) return;
  parsed.segments = parsed.segments.map((seg: any, index: number) => {
    const localKg = seg?.knowledgeGraph || { nodes: [], edges: [] };
    const nodes = Array.isArray(localKg.nodes) ? localKg.nodes : [];
    const edges = Array.isArray(localKg.edges) ? localKg.edges : [];
    if (nodes.length === 0 || edges.length === 0) {
      return { ...seg, knowledgeGraph: buildFallbackSegmentGraph(seg, index) };
    }
    return seg;
  });
}

function enrichGraphRichness(parsed: any) {
  if (!parsed?.analysis?.knowledgeGraph) return;
  const kg = parsed.analysis.knowledgeGraph;
  const nodes: any[] = Array.isArray(kg.nodes) ? kg.nodes : [];
  const edges: any[] = Array.isArray(kg.edges) ? kg.edges : [];
  const existingIds = new Set(nodes.map((n: any) => n.id));
  const root = nodes.find((n: any) => normalizeTypeKey(n.type) === "conversation") || nodes[0];

  const suggested = [
    ...(parsed?.analysis?.themes || []),
    ...(parsed?.analysis?.suggestedTags || []),
  ].filter((x: any) => typeof x === "string" && x.trim().length > 0);

  if (suggested.length > 0) {
    suggested.slice(0, 8).forEach((label: string, i: number) => {
      const nid = `theme-${i}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (!existingIds.has(nid)) {
        nodes.push({
          id: nid,
          label,
          type: "Theme",
          properties: {
            semanticPosition: "concept",
            abstractionLevel: "conceptuel",
            abstractionScore: ABSTRACTION_SCORE_BY_LEVEL.conceptuel,
          },
        });
        existingIds.add(nid);
      }
      if (root) {
        edges.push({
          id: `edge-theme-${i}-${root.id}`,
          source: root.id,
          target: nid,
          label: "thématise",
        });
      }
    });
  }

  kg.nodes = nodes;
  kg.edges = edges;
}

function reconcileSocraticRoles(segments: any[]): any[] {
  const normalized = segments.map((seg) => ({
    ...seg,
    role: seg.role === "assistant" || seg.role === "system" ? "assistant" : "user",
  }));

  for (const seg of normalized) {
    if (seg.role !== "user") continue;
    const text = String(seg.originalText || seg.content || "");
    if (!isQuestionLike(text) && getAnalysisSignalScore(text) >= 2) {
      seg.role = "assistant";
      seg.tags = Array.isArray(seg.tags) ? [...new Set([...seg.tags, "analyse-socratique-detectee"])] : ["analyse-socratique-detectee"];
    }
  }

  const userSegments = normalized.filter((s) => s.role === "user");
  if (userSegments.length === 0) {
    const first = normalized[0];
    const question = inferQuestionFromAnalysis(String(first?.originalText || first?.content || ""));
    normalized.unshift({
      content: question,
      originalText: question,
      role: "user",
      semanticSignature: `inferred-q-${uuidv4().substring(0, 8)}`,
      tags: ["question-inferree"],
      knowledgeGraph: { nodes: [], edges: [] },
      metadata: { reason: "Question initiale inférée par similarité sémantique locale." },
    });
  }

  const userPool = normalized
    .filter((s) => s.role === "user")
    .map((s) => ({
      text: String(s.originalText || s.content || ""),
      vec: toSemanticVector(String(s.originalText || s.content || "")),
    }))
    .filter((s) => s.text.trim().length > 0);

  for (const seg of normalized) {
    if (seg.role !== "assistant") continue;
    const assistantText = String(seg.originalText || seg.content || "");
    const assistantVec = toSemanticVector(assistantText);
    let best: { text: string; score: number } | null = null;
    for (const cand of userPool) {
      const score = cosineSimilarityMap(assistantVec, cand.vec);
      if (!best || score > best.score) best = { text: cand.text, score };
    }
    if (best && best.score >= 0.12) {
      const hint = `Question associée (similarité ${Math.round(best.score * 100)}%): "${truncateText(best.text)}"`;
      seg.semanticInterpretation = seg.semanticInterpretation
        ? `${seg.semanticInterpretation}\n\n${hint}`
        : hint;
      if (!seg.semanticVectorDescription) {
        seg.semanticVectorDescription = buildLocalVectorDescription(assistantText);
      }
    }
  }

  return normalized;
}

function looksLikeStructuredDialog(text: string): boolean {
  const lines = String(text || "")
    .toLowerCase()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.some((l) => /^\[(user|assistant|system)\]/.test(l))) return true;
  if (lines.some((l) => /^(user|assistant|system)\s*:/.test(l))) return true;
  if (lines.some((l) => /^(q|r)\s*:/.test(l))) return true;
  if (lines.some((l) => /^(question|reponse|réponse)\s*:/.test(l))) return true;
  return false;
}

function isIntactLikeMode(options?: AnalyzeOptions): boolean {
  if (options?.granularity === "intact") return true;
  const instruction = String(options?.customSegmentationInstruction || "").toLowerCase();
  if (!instruction) return false;
  return (
    instruction.includes("segmentation=intact") ||
    instruction.includes("blocs longs") ||
    instruction.includes("grands blocs") ||
    instruction.includes("1 à 4 segments") ||
    instruction.includes("1-4")
  );
}

function forceIntactFreeTextShape(parsed: any, originalText: string, options?: AnalyzeOptions) {
  if (!isIntactLikeMode(options)) return;
  if (looksLikeStructuredDialog(originalText)) return;

  const inferredQuestion = inferQuestionFromAnalysis(originalText);
  const fullText = String(originalText || "").trim() || "Texte indisponible.";
  const existingSegments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const roles = new Set(existingSegments.map((s: any) => String(s?.role || "").toLowerCase()));
  const maxSegmentTextLen = existingSegments.reduce((max: number, s: any) => {
    const len = String(s?.originalText || s?.content || "").trim().length;
    return Math.max(max, len);
  }, 0);
  const coverage = fullText.length ? maxSegmentTextLen / fullText.length : 0;
  const alreadyHasQuestionAndAnalysis = roles.has("user") && (roles.has("assistant") || roles.has("system"));

  // Keep provider output only if it really preserves long-block structure and content coverage.
  if (alreadyHasQuestionAndAnalysis && coverage >= 0.75) return;

  parsed.segments = [
    {
      content: inferredQuestion,
      originalText: inferredQuestion,
      role: "user",
      semanticSignature: `intact-q-${uuidv4().substring(0, 8)}`,
      tags: ["question-inferree", "intact"],
      knowledgeGraph: { nodes: [], edges: [] },
      metadata: { reason: "Question inférée pour texte libre (mode blocs longs)." },
    },
    {
      content: fullText,
      originalText: fullText,
      role: "assistant",
      semanticSignature: `intact-a-${uuidv4().substring(0, 8)}`,
      tags: ["analyse-socratique-detectee", "intact"],
      knowledgeGraph: { nodes: [], edges: [] },
      metadata: { reason: "Texte source complet conservé (mode blocs longs)." },
    },
  ];
}

function forceSingleBlockSocraticPair(parsed: any, originalText: string, options?: AnalyzeOptions) {
  if (isMarkupMode(options)) return;
  if (looksLikeStructuredDialog(originalText)) return;

  const existingSegments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  if (existingSegments.length !== 1) return;

  const seg = existingSegments[0] || {};
  const role = String(seg?.role || "").toLowerCase();
  const content = String(seg?.originalText || seg?.content || "").trim();
  const fullText = String(originalText || "").trim();
  if (!content || !fullText) return;

  const hasAssistant = existingSegments.some((s: any) => {
    const r = String(s?.role || "").toLowerCase();
    return r === "assistant" || r === "system";
  });
  if (hasAssistant) return;

  const longEnough = content.length >= 80 || fullText.length >= 80;
  if (!longEnough) return;
  if (isQuestionLike(content)) return;

  const inferredQuestion = inferQuestionFromAnalysis(content);
  parsed.segments = [
    {
      content: inferredQuestion,
      originalText: inferredQuestion,
      role: "user",
      semanticSignature: `monoblock-q-${uuidv4().substring(0, 8)}`,
      tags: ["question-inferree", "fallback-monobloc"],
      knowledgeGraph: { nodes: [], edges: [] },
      metadata: { reason: "Question inferee: segmentation initiale monobloc detectee." },
    },
    {
      content: fullText,
      originalText: fullText,
      role: "assistant",
      semanticSignature: `monoblock-a-${uuidv4().substring(0, 8)}`,
      tags: ["analyse-socratique-detectee", "fallback-monobloc"],
      knowledgeGraph: seg?.knowledgeGraph || { nodes: [], edges: [] },
      metadata: { reason: "Texte libre conserve comme analyse socratique (normalisation monobloc)." },
    },
  ];
}

function isMarkupMode(options?: AnalyzeOptions): boolean {
  if (options?.granularity === "markup") return true;
  const instruction = String(options?.customSegmentationInstruction || "").toLowerCase();
  if (!instruction) return false;
  return (
    instruction.includes("segmentation=markup") ||
    instruction.includes("html") ||
    instruction.includes("xml") ||
    instruction.includes("code source")
  );
}

function looksLikeMarkup(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^\s*<\?xml[\s\S]*\?>/i.test(t)) return true;
  if (/<[a-zA-Z][\w:-]*[\s>]/.test(t) && /<\/?[a-zA-Z][\w:-]*>/.test(t)) return true;
  return false;
}

function decodeEntities(text: string): string {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractMarkupReadableText(text: string): string {
  return decodeEntities(
    String(text || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCnbcFrontpageMarkup(sourceCode: string, readable: string): boolean {
  const src = String(sourceCode || "").toLowerCase();
  const txt = String(readable || "").toLowerCase();
  return src.includes("cnbc") || txt.includes("cnbc") || src.includes("search.cnbc.com");
}

function formatRelativeTimeTimeline(readable: string): string {
  const raw = String(readable || "");
  if (!raw.trim()) return raw;

  // Force a new line before relative-time markers used in financial frontpages.
  // Examples: "7 hours ago", "4 hour ago", "26 min ago", "12 minutes ago".
  const withBreaks = raw.replace(
    /\s+(?=(?:\d+\s+(?:hours?|hrs?|minutes?|mins?|min)\s+ago)\b)/gi,
    "\n"
  );

  const lines = withBreaks
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const timeAnchoredLines = lines.filter((line) =>
    /^\d+\s+(hours?|hrs?|hr|h|minutes?|mins?|min|m)\s+ago\b/i.test(line)
  );

  // If we found timeline-like rows, prefer those for human readability.
  if (timeAnchoredLines.length >= 2) {
    return timeAnchoredLines.join("\n");
  }

  // Fallback: carve snippets around relative-time markers directly from the one-line text.
  const compact = raw.replace(/\s+/g, " ").trim();
  const snippets = [...compact.matchAll(/(\d+\s+(?:hours?|hrs?|hr|h|minutes?|mins?|min|m)\s+ago[\s\S]*?)(?=\d+\s+(?:hours?|hrs?|hr|h|minutes?|mins?|min|m)\s+ago|$)/gi)]
    .map((m) => String(m[1] || "").trim())
    .map((s) => s.length > 220 ? `${s.slice(0, 220)}...` : s)
    .filter(Boolean);
  if (snippets.length >= 2) {
    return snippets.join("\n");
  }
  return lines.join("\n");
}

function forceMarkupSplitShape(parsed: any, originalText: string, options?: AnalyzeOptions) {
  if (!isMarkupMode(options)) return;
  if (!looksLikeMarkup(originalText)) return;

  const sourceCode = String(originalText || "").trim();
  let readable = extractMarkupReadableText(sourceCode);
  if (looksLikeCnbcFrontpageMarkup(sourceCode, readable)) {
    readable = formatRelativeTimeTimeline(readable);
  }
  const existingSegments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const maxSegmentTextLen = existingSegments.reduce((max: number, s: any) => {
    const len = String(s?.originalText || s?.content || "").trim().length;
    return Math.max(max, len);
  }, 0);
  const coverage = sourceCode.length ? maxSegmentTextLen / sourceCode.length : 0;
  const hasReadableSegment = existingSegments.some((s: any) => {
    const role = String(s?.role || "").toLowerCase();
    const t = String(s?.originalText || s?.content || "");
    return (role === "assistant" || role === "system") && t.length >= Math.min(200, readable.length);
  });

  if (coverage >= 0.85 && hasReadableSegment) {
    if (looksLikeCnbcFrontpageMarkup(sourceCode, readable)) {
      parsed.segments = existingSegments.map((s: any) => {
        const role = String(s?.role || "").toLowerCase();
        if (role !== "assistant" && role !== "system") return s;
        const current = String(s?.originalText || s?.content || "");
        const formatted = formatRelativeTimeTimeline(current);
        return {
          ...s,
          content: formatted || current,
          originalText: formatted || current,
        };
      });
    }
    return;
  }

  parsed.segments = [
    {
      content: "CODE_MARKUP_SOURCE",
      originalText: sourceCode,
      role: "user",
      semanticSignature: `markup-code-${uuidv4().substring(0, 8)}`,
      tags: ["markup", "code-source"],
      knowledgeGraph: { nodes: [], edges: [] },
      metadata: { reason: "Code source HTML/XML isolé pour lecture technique." },
    },
    {
      content: readable || "Contenu lisible non détecté dans ce markup.",
      originalText: readable || "Contenu lisible non détecté dans ce markup.",
      role: "assistant",
      semanticSignature: `markup-content-${uuidv4().substring(0, 8)}`,
      tags: ["markup", "contenu-extrait"],
      knowledgeGraph: { nodes: [], edges: [] },
      metadata: { reason: "Contenu texte extrait du markup pour lecture humaine." },
    },
  ];
}

function getSelectedProvider(): Provider {
  return (localStorage.getItem("SELECTED_MODEL") as Provider) || "gemini";
}

function getGeminiApiKey() {
  return (
    localStorage.getItem("GEMINI_API_KEY_OVERRIDE") ||
    (import.meta.env.VITE_GEMINI_API_KEY as string) ||
    (process.env.GEMINI_API_KEY as string)
  );
}

function getHardwiredGeminiApiKey() {
  return (import.meta.env.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string);
}

function getOpenAIApiKey() {
  return localStorage.getItem("OPENAI_API_KEY") || localStorage.getItem("CODEX_API_KEY") || "";
}

function getSelectedGeminiModel() {
  return localStorage.getItem("GEMINI_MANUAL_MODEL") || null;
}

function getAI(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

function extractLikelyJsonObject(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return text;
  const fenced = text.replace(/```json|```/gi, "").trim();
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first >= 0 && last > first) return fenced.slice(first, last + 1);
  return fenced;
}

function parseModelJsonLoose(raw: string) {
  const candidate = extractLikelyJsonObject(raw);
  try {
    return JSON.parse(candidate);
  } catch {
    // Remove hard control chars that frequently break provider JSON payloads.
    const sanitized = candidate.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
    return JSON.parse(sanitized);
  }
}

function buildParseFallbackResult(originalText: string, parseError: any, options?: AnalyzeOptions): AnalysisResult {
  const reason = String(parseError?.message || "JSON invalide renvoye par le fournisseur IA.");
  return normalizeAnalysisPayload(
    {
      title: "Analyse (fallback local)",
      analysis: {
        summary: `Fallback local applique apres echec de parsing JSON: ${reason}`,
        themes: [],
        suggestedTags: ["fallback-local"],
        deviations: [],
        semanticSignature: `fallback-${uuidv4().substring(0, 8)}`,
        knowledgeGraph: { nodes: [], edges: [] },
      },
      segments: [
        {
          content: originalText,
          originalText,
          role: "user",
          semanticSignature: `fallback-seg-${uuidv4().substring(0, 8)}`,
          tags: ["fallback-local-json"],
          knowledgeGraph: { nodes: [], edges: [] },
          metadata: { reason: "Sortie JSON IA invalide; contenu preserve localement." },
        },
      ],
    },
    originalText,
    options
  );
}

function normalizeAnalysisPayload(parsed: any, originalText: string, options?: AnalyzeOptions): AnalysisResult {
  const safeParsed = parsed || {};
  forceIntactFreeTextShape(safeParsed, originalText, options);
  forceMarkupSplitShape(safeParsed, originalText, options);
  forceSingleBlockSocraticPair(safeParsed, originalText, options);

  if (!safeParsed.segments || safeParsed.segments.length === 0) {
    safeParsed.segments = [
      {
        content: originalText,
        originalText,
        role: "user",
        semanticSignature: `fallback-${uuidv4().substring(0, 8)}`,
        tags: ["archive-brute"],
        knowledgeGraph: { nodes: [], edges: [] },
      },
    ];
  }

  if (!safeParsed.analysis) {
    safeParsed.analysis = {
      summary: "Analyse sommaire indisponible",
      themes: [],
      suggestedTags: [],
      deviations: [],
      semanticSignature: uuidv4(),
      knowledgeGraph: { nodes: [], edges: [] },
    };
  }

  const globalKg = safeParsed.analysis.knowledgeGraph || { nodes: [], edges: [] };
  globalKg.nodes = (globalKg.nodes || []).map((n: any) => {
    const contextText = String(n?.properties?.sourceText || n?.properties?.context || n?.properties?.snippet || "");
    const cleanedLabel = cleanGraphNodeLabel(String(n?.label || n?.id || ""), contextText, "Concept");
    const level = normalizeAbstractionLevel(
      (n.properties && (n.properties.abstractionLevel || n.properties.abstraction_level)) ||
      inferAbstractionLevel(String(cleanedLabel || n.id || ""), String(n.type || "Concept"))
    );
    const scoreRaw = Number((n.properties && (n.properties.abstractionScore ?? n.properties.abstraction_score)) ?? ABSTRACTION_SCORE_BY_LEVEL[level]);
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, scoreRaw)) : ABSTRACTION_SCORE_BY_LEVEL[level];
    return {
      id: n.id || uuidv4(),
      label: cleanedLabel || n.id || "Unit",
      type: n.type || "Concept",
      properties: {
        ...(n.properties || {}),
        semanticPosition: (n.properties && n.properties.semanticPosition) || inferSemanticPosition(n.type || "Concept"),
        abstractionLevel: level,
        abstractionScore: score,
      },
    };
  });
  globalKg.edges = (globalKg.edges || []).map((e: any) => ({
    id: e.id || uuidv4(),
    source: e.source || "",
    target: e.target || "",
    label: e.label || "related",
  }));
  safeParsed.analysis.knowledgeGraph = globalKg;

  safeParsed.segments = safeParsed.segments.map((seg: any) => {
    const localKg = seg.knowledgeGraph || { nodes: [], edges: [] };
    localKg.nodes = (localKg.nodes || []).map((n: any) => {
      const contextText = String(seg?.originalText || seg?.content || n?.properties?.sourceText || "");
      const cleanedLabel = cleanGraphNodeLabel(String(n?.label || n?.id || ""), contextText, "Concept");
      const level = normalizeAbstractionLevel(
        (n.properties && (n.properties.abstractionLevel || n.properties.abstraction_level)) ||
        inferAbstractionLevel(String(cleanedLabel || n.id || ""), String(n.type || "Concept"))
      );
      const scoreRaw = Number((n.properties && (n.properties.abstractionScore ?? n.properties.abstraction_score)) ?? ABSTRACTION_SCORE_BY_LEVEL[level]);
      const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(1, scoreRaw)) : ABSTRACTION_SCORE_BY_LEVEL[level];
      return {
        id: n.id || uuidv4(),
        label: cleanedLabel || n.id || "Unit",
        type: n.type || "Concept",
        properties: {
          ...(n.properties || {}),
          semanticPosition: (n.properties && n.properties.semanticPosition) || inferSemanticPosition(n.type || "Concept"),
          abstractionLevel: level,
          abstractionScore: score,
        },
      };
    });
    localKg.edges = (localKg.edges || []).map((e: any) => ({
      id: e.id || uuidv4(),
      source: e.source || "",
      target: e.target || "",
      label: e.label || "related",
    }));

    return {
      ...seg,
      content: seg.content || "N/A",
      originalText: seg.originalText || seg.content || "N/A",
      tags: Array.isArray(seg.tags) ? seg.tags : [],
      knowledgeGraph: localKg,
      metadata: seg.metadata || {},
    };
  });

  safeParsed.segments = reconcileSocraticRoles(safeParsed.segments);
  ensureGraphCompleteness(safeParsed);
  enrichGraphRichness(safeParsed);

  return safeParsed as AnalysisResult;
}

async function callOpenAIChatCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: { temperature?: number; responseJson?: boolean }
) {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("Clé API OpenAI manquante.");

  let lastError: any;
  for (const model of OPENAI_MODELS_TO_TRY) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? 0.1,
          ...(options?.responseJson ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 404 || text.toLowerCase().includes("model")) {
          lastError = new Error(`Modèle OpenAI indisponible: ${model}`);
          continue;
        }
        throw new Error(`OpenAI HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const firstText = content.find((c: any) => c?.type === "text")?.text;
        if (typeof firstText === "string") return firstText;
      }
      throw new Error("Réponse OpenAI vide ou invalide.");
    } catch (error: any) {
      lastError = error;
      if (String(error?.message || "").includes("indisponible")) continue;
      throw error;
    }
  }

  throw new Error(`Échec OpenAI: ${lastError?.message || "modèle indisponible"}`);
}

export async function analyzeAndSegmentConversation(text: string, options?: AnalyzeOptions): Promise<AnalysisResult> {
  const provider = getSelectedProvider();
  const segmentationInstruction =
    options?.customSegmentationInstruction?.trim() ||
    getSegmentationInstruction(options?.granularity || "balanced");
  const semanticComparisonInstruction = getSemanticComparisonInstruction(options);

  if (provider === "openai") {
    const prompt = `
 Tu es Socrate, expert en maieutique. Deconstruis cet echange.
 ${segmentationInstruction}
 ${semanticComparisonInstruction}
 Regle de role: si le segment est une question/probleme initial -> role="user"; si c'est une explication/raisonnement/reponse -> role="assistant".
 Produis un graphe riche et varié: noeuds de types différents (Conversation, Question, SocraticAnalysis, Concept, Theme, Evidence, Actor, Deviation).
 Chaque noeud doit inclure properties.semanticPosition parmi: position_initiale, analyse_socratique, concept, preuve, acteur, deviation, meta.
 Chaque noeud doit inclure properties.abstractionLevel parmi: concret, intermediaire, conceptuel, meta.
 Chaque noeud doit inclure properties.abstractionScore (0..1) cohérent avec abstractionLevel.
 Utilise des labels de relations explicites (ex: soutient, oppose, clarifie, illustre, dérive_de, contextualise).

Retourne STRICTEMENT un objet JSON avec cette structure:
{
  "title": "Titre",
  "analysis": {
    "summary": "Resume",
    "themes": [],
    "suggestedTags": [],
    "deviations": [],
    "semanticSignature": "S1",
    "knowledgeGraph": { "nodes": [], "edges": [] }
  },
  "segments": [
    {
      "content": "R",
      "originalText": "T",
      "role": "user",
      "semanticSignature": "H1",
      "tags": [],
      "knowledgeGraph": { "nodes": [], "edges": [] }
    }
  ]
}

TEXTE: ${JSON.stringify(text)}
`;

    const rawText = await callOpenAIChatCompletion([{ role: "user", content: prompt }], {
      temperature: 0.1,
      responseJson: true,
    });
    try {
      const parsed = parseModelJsonLoose(rawText);
      return normalizeAnalysisPayload(parsed, text, options);
    } catch (parseError) {
      return buildParseFallbackResult(text, parseError, options);
    }
  }

  const apiKey = provider === "hardwired_gemini" ? getHardwiredGeminiApiKey() : getGeminiApiKey();
  const manualModel = getSelectedGeminiModel();

  if (!apiKey) {
    if (provider === "hardwired_gemini") {
      throw new Error("Gemini hard wired indisponible. Configurez GEMINI_API_KEY dans l'environnement de l'app.");
    }
    throw new Error("Clé API Gemini manquante. Veuillez la configurer dans les Paramètres.");
  }

  const genAI = getAI(apiKey);
  const maxRetries = 2;
  let lastError: any;
  const modelsToUse = manualModel ? [manualModel] : GEMINI_MODELS_TO_TRY;

  for (const currentModelName of modelsToUse) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const waitTime = (String(lastError?.message || "").includes("quota") ? 10000 : 2000) * attempt;
          await new Promise((r) => setTimeout(r, waitTime));
        }

        const model = genAI.getGenerativeModel({
          model: currentModelName,
          generationConfig: {
            responseMimeType:
              currentModelName.includes("pro") || currentModelName.includes("flash")
                ? "application/json"
                : undefined,
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout (${currentModelName})`)), 180000)
        );

        const apiPromise = model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `
 Tu es Socrate, expert en maieutique. Deconstruis cet echange.
 ${segmentationInstruction}
 ${semanticComparisonInstruction}
 Regle de role: si le segment est une question/probleme initial -> role="user"; si c'est une explication/raisonnement/reponse -> role="assistant".
 Produis un graphe riche et varié: noeuds de types différents (Conversation, Question, SocraticAnalysis, Concept, Theme, Evidence, Actor, Deviation).
 Chaque noeud doit inclure properties.semanticPosition parmi: position_initiale, analyse_socratique, concept, preuve, acteur, deviation, meta.
 Chaque noeud doit inclure properties.abstractionLevel parmi: concret, intermediaire, conceptuel, meta.
 Chaque noeud doit inclure properties.abstractionScore (0..1) cohérent avec abstractionLevel.
 Utilise des labels de relations explicites (ex: soutient, oppose, clarifie, illustre, dérive_de, contextualise).

STRUCTURE (JSON STRICT):
{
  "title": "Titre",
  "analysis": { "summary": "Resume", "themes": [], "suggestedTags": [], "deviations": [], "semanticSignature": "S1", "knowledgeGraph": { "nodes": [], "edges": [] } },
  "segments": [{ "content": "R", "originalText": "T", "role": "user", "semanticSignature": "H1", "tags": [], "knowledgeGraph": { "nodes": [], "edges": [] } }]
}

TEXTE: ${JSON.stringify(text)}
`,
                },
              ],
            },
          ],
        });

        const response = (await Promise.race([apiPromise, timeoutPromise])) as any;
        const rawText = response.response.text();
        try {
          const parsed = parseModelJsonLoose(rawText);
          return normalizeAnalysisPayload(parsed, text, options);
        } catch (parseError) {
          const message = String((parseError as any)?.message || "");
          if (message.toLowerCase().includes("json")) {
            return buildParseFallbackResult(text, parseError, options);
          }
          throw parseError;
        }
      } catch (err: any) {
        lastError = err;
        if (String(err?.message || "").includes("404") || String(err?.message || "").includes("not found")) {
          break;
        }
      }
    }
  }

  throw new Error(
    `Échec de connexion aux services d'IA (Gemini). Tous les modèles testés ont échoué. Erreur finale: ${lastError?.message}`
  );
}

export async function deepAnalyzeConversation(text: string): Promise<string> {
  const provider = getSelectedProvider();

  if (provider === "openai") {
    const prompt = `
Tu es un expert en analyse semantique profonde.
ANALYSE CE TEXTE:
"${text.replace(/"/g, '\\"')}"
FORMAT: Markdown structure.
`;
    return callOpenAIChatCompletion([{ role: "user", content: prompt }], { temperature: 0.2 });
  }

  const apiKey = provider === "hardwired_gemini" ? getHardwiredGeminiApiKey() : getGeminiApiKey();
  if (!apiKey) throw new Error("Clé API manquante.");

  const genAI = getAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODELS_TO_TRY[0] });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Tu es un expert en analyse semantique profonde.
ANALYSE CE TEXTE: "${text.replace(/"/g, '\\"')}"
FORMAT: Markdown structure.
`,
          },
        ],
      },
    ],
  });

  return result.response.text() || "Analyse indisponible.";
}

export async function enrichSegmentSemantics(
  text: string,
  role: Segment["role"],
  conversationSummary = ""
): Promise<{ semanticVectorDescription: string; semanticInterpretation: string }> {
  const localVector = buildLocalVectorDescription(text);
  const localInterpretation = buildLocalInterpretation(text, role);
  const provider = getSelectedProvider();

  const prompt = `
Tu dois produire une sortie JSON stricte:
{
  "semanticVectorDescription": "description vectorielle concise",
  "semanticInterpretation": "interpretation socratique concise"
}

Contexte conversation: ${JSON.stringify(conversationSummary)}
Role du segment: ${role}
Texte du segment: ${JSON.stringify(text)}
`;

  try {
    if (provider === "openai") {
      const raw = await callOpenAIChatCompletion([{ role: "user", content: prompt }], {
        temperature: 0.1,
        responseJson: true,
      });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      return {
        semanticVectorDescription: parsed?.semanticVectorDescription || localVector,
        semanticInterpretation: parsed?.semanticInterpretation || localInterpretation,
      };
    }

    if (provider === "gemini" || provider === "hardwired_gemini") {
      const apiKey = provider === "hardwired_gemini" ? getHardwiredGeminiApiKey() : getGeminiApiKey();
      if (!apiKey) {
        return { semanticVectorDescription: localVector, semanticInterpretation: localInterpretation };
      }
      const genAI = getAI(apiKey);
      const modelName = getSelectedGeminiModel() || GEMINI_MODELS_TO_TRY[0];
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 1024 },
      });
      const result = await model.generateContent(prompt);
      const raw = result.response.text();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      return {
        semanticVectorDescription: parsed?.semanticVectorDescription || localVector,
        semanticInterpretation: parsed?.semanticInterpretation || localInterpretation,
      };
    }
  } catch (_err) {
    // Fallback local if provider call fails.
  }

  return { semanticVectorDescription: localVector, semanticInterpretation: localInterpretation };
}

export async function testGeminiConnection(): Promise<ConnectionTestResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, provider: "gemini", details: "Clé API Gemini absente." };
  }

  const preferredModel = getSelectedGeminiModel();
  const modelsToTry = preferredModel ? [preferredModel] : GEMINI_MODELS_TO_TRY;
  let lastError: any;

  for (const modelName of modelsToTry) {
    try {
      const genAI = getAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("test");
      const ok = !!result.response.text();
      if (ok) return { ok: true, provider: "gemini", model: modelName };
    } catch (err: any) {
      lastError = err;
    }
  }

  return {
    ok: false,
    provider: "gemini",
    model: preferredModel || GEMINI_MODELS_TO_TRY[0],
    details: lastError?.message || "Échec de connexion Gemini.",
  };
}

async function testOpenAIConnection(): Promise<ConnectionTestResult> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return { ok: false, provider: "openai", details: "Clé API OpenAI absente." };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, provider: "openai", details: `OpenAI HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();
    const availableIds = new Set<string>((data?.data || []).map((m: any) => m?.id).filter(Boolean));
    const picked = OPENAI_MODELS_TO_TRY.find((m) => availableIds.has(m));

    return { ok: true, provider: "openai", model: picked || "unknown" };
  } catch (err) {
    console.error("Test OpenAI failed:", err);
    return { ok: false, provider: "openai", details: (err as any)?.message || "Échec OpenAI." };
  }
}

export async function testProviderConnection(provider?: Provider): Promise<ConnectionTestResult> {
  const selected = provider || getSelectedProvider();

  if (selected === "gemini") return testGeminiConnection();
  if (selected === "hardwired_gemini") {
    const apiKey = getHardwiredGeminiApiKey();
    if (!apiKey) {
      return {
        ok: false,
        provider: "hardwired_gemini",
        details: "GEMINI_API_KEY (env) introuvable pour Hard wired Gemini.",
      };
    }

    const preferredModel = getSelectedGeminiModel() || GEMINI_MODELS_TO_TRY[0];
    try {
      const genAI = getAI(apiKey);
      const model = genAI.getGenerativeModel({ model: preferredModel });
      const result = await model.generateContent("test");
      return {
        ok: !!result.response.text(),
        provider: "hardwired_gemini",
        model: preferredModel,
      };
    } catch (err: any) {
      return {
        ok: false,
        provider: "hardwired_gemini",
        model: preferredModel,
        details: err?.message || "Échec Hard wired Gemini.",
      };
    }
  }
  if (selected === "openai") return testOpenAIConnection();
  if (selected === "openrouter") {
    const ok = !!localStorage.getItem("OPENROUTER_API_KEY");
    return { ok, provider: "openrouter", model: "google/gemini-2.0-flash-001" };
  }
  if (selected === "claude") {
    const ok = !!localStorage.getItem("CLAUDE_API_KEY");
    return { ok, provider: "claude", model: "configured-via-key" };
  }
  if (selected === "codex") {
    const ok = !!localStorage.getItem("CODEX_API_KEY");
    return { ok, provider: "codex", model: "configured-via-key" };
  }

  return { ok: false, provider: selected, details: "Provider inconnu." };
}

async function chatWithOpenAI(
  prompt: string,
  history: { role: "user" | "assistant" | "system"; content: string }[]
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: prompt },
  ];

  return callOpenAIChatCompletion(messages, { temperature: 0.3 });
}

export async function chatWithGemini(
  prompt: string,
  history: { role: "user" | "assistant" | "system"; content: string }[]
): Promise<string> {
  const selectedProvider = getSelectedProvider();

  if (selectedProvider === "openai") {
    return chatWithOpenAI(prompt, history);
  }

  if (selectedProvider === "openrouter") {
    const orKey = localStorage.getItem("OPENROUTER_API_KEY");
    if (!orKey) throw new Error("Clé API OpenRouter manquante.");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          ...history.map((m) => ({
            role: m.role === "system" ? "system" : m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Erreur OpenRouter";
  }

  if (selectedProvider !== "gemini" && selectedProvider !== "hardwired_gemini") {
    throw new Error(`Le provider "${selectedProvider}" n'est pas encore implémenté pour le chat.`);
  }

  const apiKey = selectedProvider === "hardwired_gemini" ? getHardwiredGeminiApiKey() : getGeminiApiKey();
  const manualModel = getSelectedGeminiModel();
  if (!apiKey) throw new Error("Clé API Gemini manquante.");

  const genAI = getAI(apiKey);
  const systemMessage = history.find((m) => m.role === "system");
  const chatHistory = history.filter((m) => m.role !== "system");
  let lastError: any;
  const modelsToUse = manualModel ? [manualModel] : GEMINI_MODELS_TO_TRY;

  for (const currentModelName of modelsToUse) {
    try {
      const model = genAI.getGenerativeModel({
        model: currentModelName,
        systemInstruction: systemMessage ? systemMessage.content : undefined,
      });

      const validHistory: { role: "user" | "model"; parts: { text: string }[] }[] = [];
      let expectedRole: "user" | "model" = "user";

      for (const msg of chatHistory) {
        const role = msg.role === "user" ? "user" : "model";
        if (role === expectedRole) {
          validHistory.push({ role, parts: [{ text: msg.content }] });
          expectedRole = expectedRole === "user" ? "model" : "user";
        }
      }

      const chat = model.startChat({ history: validHistory });
      const result = await chat.sendMessage(prompt);
      return result.response.text() || "Désolé, je n'ai pas pu générer de réponse.";
    } catch (error: any) {
      lastError = error;
      if (String(error?.message || "").includes("404") || String(error?.message || "").includes("not found")) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Le Chat Socrate n'a pas pu se connecter à l'IA. Vérifiez votre clé API Gemini. Erreur: ${lastError?.message}`
  );
}
