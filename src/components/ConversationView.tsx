import {
  ChevronLeft, 
  Tag, 
  Calendar, 
  User, 
  Bot, 
  Trash2, 
  Brain, 
  Compass, 
  HelpCircle, 
  Network, 
  List,
  Maximize2,
  X,
  FileText,
  BrainCircuit,
  Quote,
  Zap,
  Loader2,
  Share2,
  Activity,
  BookOpenText,
  Sparkles,
  Fingerprint,
  Settings
} from 'lucide-react';
import { Readability } from '@mozilla/readability';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDate, cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { Component, Fragment, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Segment, SegmentationTrace } from '../types';

const ConceptualMap = lazy(() =>
  import('./ConceptualMap').then((module) => ({ default: module.ConceptualMap }))
);

const KnowledgeGraphView = lazy(() =>
  import('./KnowledgeGraphView').then((module) => ({ default: module.KnowledgeGraphView }))
);

async function loadGeminiService() {
  return import('../services/geminiService');
}

interface ConversationViewProps {
  convId: string;
  onBack: () => void;
}

class ComparisonErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: any) {
    return {
      hasError: true,
      message: String(error?.message || 'Erreur de rendu dans la comparaison.'),
    };
  }

  componentDidCatch(error: any) {
    console.error('ComparisonErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-xs leading-relaxed">
          <p className="font-bold uppercase tracking-widest text-[10px] mb-1">Erreur comparaison</p>
          <p>{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

type DiffKind = 'equal' | 'removed' | 'added';
type DiffPart = { kind: DiffKind; text: string };
type MarkerDiffRow = {
  leftText: string;
  rightText: string;
  leftMissingMarkers: number[];
  rightMissingMarkers: number[];
  leftOwnMarker?: number;
  rightOwnMarker?: number;
  leftKind: DiffKind | 'empty';
  rightKind: DiffKind | 'empty';
};

function chunkLongLine(line: string, maxWords = 22): string[] {
  const words = String(line || '').split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [line];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < words.length) {
    out.push(words.slice(cursor, cursor + maxWords).join(' '));
    cursor += maxWords;
  }
  return out;
}

function normalizeDiffUnits(text: string): string[] {
  const raw = String(text || '').replace(/\r/g, '\n').trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const line of lines) {
    const sentenceLike = line
      .split(/(?<=[.!?])\s+(?=[A-Z0-9À-ÖØ-Þ])/)
      .map((s) => s.trim())
      .filter(Boolean);
    const candidates = sentenceLike.length > 1 ? sentenceLike : chunkLongLine(line);
    for (const c of candidates) {
      const cleaned = c.replace(/\s+/g, ' ').trim();
      if (!cleaned) continue;
      units.push(cleaned);
      if (units.length >= 220) return units;
    }
  }
  return units;
}

function buildSideBySideDiff(leftText: string, rightText: string): { left: DiffPart[]; right: DiffPart[] } {
  const leftUnits = normalizeDiffUnits(leftText);
  const rightUnits = normalizeDiffUnits(rightText);
  const n = leftUnits.length;
  const m = rightUnits.length;

  if (!n && !m) return { left: [], right: [] };
  if (!n) return { left: [], right: rightUnits.map((text) => ({ kind: 'added' as DiffKind, text })) };
  if (!m) return { left: leftUnits.map((text) => ({ kind: 'removed' as DiffKind, text })), right: [] };

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (leftUnits[i] === rightUnits[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (leftUnits[i] === rightUnits[j]) {
      left.push({ kind: 'equal', text: leftUnits[i] });
      right.push({ kind: 'equal', text: rightUnits[j] });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ kind: 'removed', text: leftUnits[i] });
      i += 1;
    } else {
      right.push({ kind: 'added', text: rightUnits[j] });
      j += 1;
    }
  }

  while (i < n) {
    left.push({ kind: 'removed', text: leftUnits[i] });
    i += 1;
  }
  while (j < m) {
    right.push({ kind: 'added', text: rightUnits[j] });
    j += 1;
  }

  return { left, right };
}

function buildMarkerDiffRowsFromParts(leftParts: DiffPart[], rightParts: DiffPart[]): MarkerDiffRow[] {
  const rows: MarkerDiffRow[] = [];
  let li = 0;
  let ri = 0;
  let markerId = 1;
  let pendingForLeft: number[] = [];
  let pendingForRight: number[] = [];

  while (li < leftParts.length || ri < rightParts.length) {
    const left = leftParts[li];
    const right = rightParts[ri];

    if (left?.kind === 'equal' && right?.kind === 'equal') {
      rows.push({
        leftText: left.text,
        rightText: right.text,
        leftMissingMarkers: pendingForLeft,
        rightMissingMarkers: pendingForRight,
        leftKind: 'equal',
        rightKind: 'equal',
      });
      pendingForLeft = [];
      pendingForRight = [];
      li += 1;
      ri += 1;
      continue;
    }

    if (left?.kind === 'removed') {
      const id = markerId++;
      rows.push({
        leftText: left.text,
        rightText: '',
        leftMissingMarkers: [],
        rightMissingMarkers: [],
        leftOwnMarker: id,
        leftKind: 'removed',
        rightKind: 'empty',
      });
      pendingForRight = [...pendingForRight, id];
      li += 1;
      continue;
    }

    if (right?.kind === 'added') {
      const id = markerId++;
      rows.push({
        leftText: '',
        rightText: right.text,
        leftMissingMarkers: [],
        rightMissingMarkers: [],
        rightOwnMarker: id,
        leftKind: 'empty',
        rightKind: 'added',
      });
      pendingForLeft = [...pendingForLeft, id];
      ri += 1;
      continue;
    }

    if (left?.kind === 'equal' && !right) {
      rows.push({
        leftText: left.text,
        rightText: '',
        leftMissingMarkers: pendingForLeft,
        rightMissingMarkers: pendingForRight,
        leftKind: 'equal',
        rightKind: 'empty',
      });
      pendingForLeft = [];
      pendingForRight = [];
      li += 1;
      continue;
    }
    if (right?.kind === 'equal' && !left) {
      rows.push({
        leftText: '',
        rightText: right.text,
        leftMissingMarkers: pendingForLeft,
        rightMissingMarkers: pendingForRight,
        leftKind: 'empty',
        rightKind: 'equal',
      });
      pendingForLeft = [];
      pendingForRight = [];
      ri += 1;
      continue;
    }

    if (!left && !right) break;
    if (left) li += 1;
    if (right) ri += 1;
  }

  if (pendingForLeft.length || pendingForRight.length) {
    rows.push({
      leftText: '',
      rightText: '',
      leftMissingMarkers: pendingForLeft,
      rightMissingMarkers: pendingForRight,
      leftKind: 'empty',
      rightKind: 'empty',
    });
  }

  return rows;
}

function scoreFromCountSimilarity(a: number, b: number): number {
  const max = Math.max(a, b);
  if (max === 0) return 1;
  return Math.max(0, 1 - Math.abs(a - b) / max);
}

function normalizeTokenForDiff(token: string): string {
  return String(token || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function buildTokenSetForDiff(text: string): Set<string> {
  const set = new Set<string>();
  const chunks = String(text || '').match(/\S+/g) || [];
  for (const chunk of chunks) {
    const n = normalizeTokenForDiff(chunk);
    if (!n) continue;
    set.add(n);
  }
  return set;
}

type ComparisonIndex = {
  normalizedCorpus: string;
  phraseSet: Set<string>;
  tokenSet: Set<string>;
};

type TraceComparableFields = {
  granularite: string;
  collection: string;
  similarite: string;
  provider: string;
  vecteur: string;
};

function normalizePhraseForComparison(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextIntoPhrases(value: string): string[] {
  const rows = String(value || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((r) => r.trim())
    .filter(Boolean);
  const phrases: string[] = [];
  for (const row of rows) {
    const pieces = row
      .split(/(?<=[.!?;:])\s+(?=[A-Z0-9À-ÖØ-Þ])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (pieces.length) phrases.push(...pieces);
    else phrases.push(row);
  }
  return phrases;
}

function buildComparisonIndex(corpus: string): ComparisonIndex {
  const normalizedCorpus = normalizePhraseForComparison(corpus);
  const phraseSet = new Set<string>();
  splitTextIntoPhrases(corpus).forEach((phrase) => {
    const n = normalizePhraseForComparison(phrase);
    if (n) phraseSet.add(n);
  });
  return {
    normalizedCorpus,
    phraseSet,
    tokenSet: buildTokenSetForDiff(corpus),
  };
}

function normalizeComparableValue(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTraceComparableFields(trace?: SegmentationTrace, fallbackVectorMode: 'local' | 'provider' = 'local'): TraceComparableFields {
  const collection = trace?.semanticCollectionName || 'Aucune collection';
  const vectorMode = trace?.vectorEngineMode || fallbackVectorMode;
  const similarity = Number(trace?.similarityThreshold ?? 0.35).toFixed(2);
  return {
    granularite: String(trace?.granularityName || 'n/a'),
    collection: collection,
    similarite: similarity,
    provider: String(trace?.provider || 'n/a'),
    vecteur: String(vectorMode || 'local'),
  };
}

function renderTraceValueComparison(value: string, otherValue: string) {
  const same = normalizeComparableValue(value) === normalizeComparableValue(otherValue);
  return (
    <span className={cn('rounded px-1', same ? 'bg-sky-100 text-slate-800' : 'bg-yellow-200 text-yellow-900')}>
      {value}
    </span>
  );
}

function renderTraceComparisonLine(self: TraceComparableFields, other: TraceComparableFields) {
  return (
    <>
      <span>Granularite: </span>{renderTraceValueComparison(self.granularite, other.granularite)}
      <span> | Collection: </span>{renderTraceValueComparison(self.collection, other.collection)}
      <span> | Similarite: </span>{renderTraceValueComparison(self.similarite, other.similarite)}
      <span> | Provider: </span>{renderTraceValueComparison(self.provider, other.provider)}
      <span> | Vecteur: </span>{renderTraceValueComparison(self.vecteur, other.vecteur)}
    </>
  );
}

function isPhraseCommonAcrossCorpus(phrase: string, opposite: ComparisonIndex) {
  const normalized = normalizePhraseForComparison(phrase);
  if (!normalized) return true;
  if (opposite.phraseSet.has(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 4 && opposite.normalizedCorpus.includes(normalized)) return true;
  const uniq = Array.from(new Set(words));
  if (uniq.length < 3) return false;
  const overlapCount = uniq.filter((w) => opposite.tokenSet.has(w)).length;
  const overlapRatio = overlapCount / uniq.length;
  return overlapCount >= 3 && overlapRatio >= 0.72;
}

function renderUncommonPhrasesAgainstCorpus(
  text: string,
  opposite: ComparisonIndex,
  withMarkers = false,
  markerState?: { current: number }
) {
  const phrases = splitTextIntoPhrases(text);
  if (!phrases.length) return <span>Aucun texte</span>;
  let markerCounter = markerState?.current ?? 1;
  return (
    <>
      {phrases.map((phrase, idx) => {
        const uncommon = !isPhraseCommonAcrossCorpus(phrase, opposite);
        const markerId = uncommon ? markerCounter++ : 0;
        return (
          <Fragment key={`phrase-frag-${idx}`}>
            {withMarkers && uncommon ? renderDiffMarker(markerId, `phrase-marker-${idx}`) : null}
            <span
              key={`phrase-common-${idx}`}
              className={cn(
                'rounded px-0.5',
                uncommon ? 'bg-yellow-200 text-yellow-900' : 'bg-sky-100 text-slate-800'
              )}
            >
              {phrase}
              {idx < phrases.length - 1 ? ' ' : ''}
            </span>
          </Fragment>
        );
      })}
      {(() => {
        if (markerState) markerState.current = markerCounter;
        return null;
      })()}
    </>
  );
}

function renderDiffMarker(markerId: number, key: string) {
  return (
    <span
      key={key}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-300 border border-yellow-500 text-[10px] font-black text-yellow-900 align-middle mr-1"
      title={`Marqueur ${markerId}`}
      aria-label={`Marqueur ${markerId}`}
    >
      {markerId}
    </span>
  );
}

export function ConversationView({ convId, onBack }: ConversationViewProps) {
  const [viewMode, setViewMode] = useState<'flux' | 'carte' | 'graphe'>(() => {
    const saved = localStorage.getItem(`SOCRATE_CONV_VIEW_MODE_${convId}`);
    return saved === 'carte' || saved === 'graphe' ? saved : 'flux';
  });
  const [inspectedSegment, setInspectedSegment] = useState<Segment | null>(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [isAnalyzingDeep, setIsAnalyzingDeep] = useState(false);
  const [compareConversationId, setCompareConversationId] = useState('');
  
  const conversation = useLiveQuery(() => db.conversations.get(convId), [convId]);
  const segments = useLiveQuery(() => db.segments.where('conversationId').equals(convId).sortBy('timestamp'), [convId]);
  const compareSegments = useLiveQuery(
    () => (compareConversationId ? db.segments.where('conversationId').equals(compareConversationId).sortBy('timestamp') : Promise.resolve([])),
    [compareConversationId]
  );
  const allConversations = useLiveQuery(() => db.conversations.toArray()) || [];

  const [isGraphFullscreen, setIsGraphFullscreen] = useState(false);
  const [activeSemanticDetail, setActiveSemanticDetail] = useState<{ id: string, type: 'vector' | 'interpretation' } | null>(null);
  const [semanticLoadingBySegment, setSemanticLoadingBySegment] = useState<Record<string, boolean>>({});
  const [vectorEngineMode, setVectorEngineMode] = useState<'local' | 'provider'>(
    (localStorage.getItem('VECTOR_ENGINE_MODE') as any) || 'local'
  );
  const latestConversationTrace: SegmentationTrace | undefined = conversation?.analysisTrace
    || (conversation?.segmentationTraces && conversation.segmentationTraces.length > 0
      ? conversation.segmentationTraces[conversation.segmentationTraces.length - 1]
      : undefined);
  const compareConversation = allConversations.find((c) => String(c.id) === String(compareConversationId)) || null;
  const compareTrace: SegmentationTrace | undefined = compareConversation?.analysisTrace
    || (compareConversation?.segmentationTraces && compareConversation.segmentationTraces.length > 0
      ? compareConversation.segmentationTraces[compareConversation.segmentationTraces.length - 1]
      : undefined);
  const currentInterestEntries = Array.isArray(latestConversationTrace?.interestAttributeScores)
    ? latestConversationTrace!.interestAttributeScores!
    : [];
  const compareInterestEntries = Array.isArray(compareTrace?.interestAttributeScores)
    ? compareTrace!.interestAttributeScores!
    : [];
  const interestLabels = Array.from(new Set([
    ...currentInterestEntries.map((e) => e.label),
    ...compareInterestEntries.map((e) => e.label),
  ]));
  const interestDiffRows = interestLabels
    .map((label) => {
      const left = currentInterestEntries.find((e) => e.label === label)?.score || 0;
      const right = compareInterestEntries.find((e) => e.label === label)?.score || 0;
      return { label, left, right, delta: left - right };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const currentSegmentsList = segments || [];
  const compareSegmentsList = compareSegments || [];
  const currentPositionSegments = currentSegmentsList.filter((s) => s.role === 'user');
  const currentSocraticSegments = currentSegmentsList.filter((s) => s.role === 'assistant');
  const comparePositionSegments = compareSegmentsList.filter((s) => s.role === 'user');
  const compareSocraticSegments = compareSegmentsList.filter((s) => s.role === 'assistant');
  const initialPositionScore = scoreFromCountSimilarity(currentPositionSegments.length, comparePositionSegments.length);
  const socraticAnalysisScore = scoreFromCountSimilarity(currentSocraticSegments.length, compareSocraticSegments.length);
  const canDiffInitialPositions =
    currentPositionSegments.length > 0 && currentPositionSegments.length === comparePositionSegments.length;
  const canDiffSocratic =
    currentSocraticSegments.length > 0 && currentSocraticSegments.length === compareSocraticSegments.length;
  const currentPositionCorpus = currentPositionSegments
    .map((seg) => String(seg.originalText || seg.content || ''))
    .join(' ');
  const comparePositionCorpus = comparePositionSegments
    .map((seg) => String(seg.originalText || seg.content || ''))
    .join(' ');
  const currentSocraticCorpus = currentSocraticSegments
    .map((seg) => String(seg.originalText || seg.content || ''))
    .join(' ');
  const compareSocraticCorpus = compareSocraticSegments
    .map((seg) => String(seg.originalText || seg.content || ''))
    .join(' ');
  const currentPositionIndex = useMemo(() => buildComparisonIndex(currentPositionCorpus), [currentPositionCorpus]);
  const comparePositionIndex = useMemo(() => buildComparisonIndex(comparePositionCorpus), [comparePositionCorpus]);
  const currentSocraticIndex = useMemo(() => buildComparisonIndex(currentSocraticCorpus), [currentSocraticCorpus]);
  const compareSocraticIndex = useMemo(() => buildComparisonIndex(compareSocraticCorpus), [compareSocraticCorpus]);
  const initialPositionDiffPairs = useMemo(
    () =>
      canDiffInitialPositions
        ? currentPositionSegments.map((leftSeg, idx) => ({
            index: idx + 1,
            diff: buildSideBySideDiff(
              String(leftSeg.originalText || leftSeg.content || ''),
              String(comparePositionSegments[idx]?.originalText || comparePositionSegments[idx]?.content || '')
            ),
          }))
        : [],
    [canDiffInitialPositions, currentPositionSegments, comparePositionSegments]
  );
  const socraticDiffPairs = useMemo(
    () =>
      canDiffSocratic
        ? currentSocraticSegments.map((leftSeg, idx) => ({
            index: idx + 1,
            diff: buildSideBySideDiff(
              String(leftSeg.originalText || leftSeg.content || ''),
              String(compareSocraticSegments[idx]?.originalText || compareSocraticSegments[idx]?.content || '')
            ),
          }))
        : [],
    [canDiffSocratic, currentSocraticSegments, compareSocraticSegments]
  );
  const currentTraceFields = useMemo(
    () => getTraceComparableFields(latestConversationTrace, vectorEngineMode),
    [latestConversationTrace, vectorEngineMode]
  );
  const compareTraceFields = useMemo(
    () => getTraceComparableFields(compareTrace, vectorEngineMode),
    [compareTrace, vectorEngineMode]
  );
  const formatTrace = (trace?: SegmentationTrace) => {
    if (!trace) return '';
    const collection = trace.semanticCollectionName || 'Aucune collection';
    const vectorMode = trace.vectorEngineMode || vectorEngineMode;
    const origin = trace.webDocumentUrl || trace.webSourceUrl;
    const originPart = origin ? ` | Origine: ${origin}` : '';
    return `Granularite: ${trace.granularityName} | Collection: ${collection} | Similarite: ${trace.similarityThreshold.toFixed(2)} | Provider: ${trace.provider} | Vecteur: ${vectorMode}${originPart}`;
  };
  const decodeEntities = (value: string) =>
    String(value || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

  const extractReadableFromHtml = (raw: string) => {
    const html = String(raw || '');
    if (!/<[a-zA-Z][\w:-]*[\s/>]/.test(html)) return html;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,noscript,svg').forEach((el) => el.remove());
      const text = (doc.body?.innerText || doc.body?.textContent || '').trim();
      return text || html;
    } catch {
      return html;
    }
  };

  const extractArticleFromHtml = (raw: string) => {
    const html = String(raw || '');
    if (!/<[a-zA-Z][\w:-]*[\s/>]/.test(html)) return '';
    const decodeEscaped = (value: string) => {
      const v = String(value || '');
      return v
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .replace(/\\t/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    };
    const collectStringsByKeys = (root: any, keys: Set<string>, out: string[] = [], depth = 0): string[] => {
      if (depth > 20 || root == null) return out;
      if (Array.isArray(root)) {
        root.forEach((item) => collectStringsByKeys(item, keys, out, depth + 1));
        return out;
      }
      if (typeof root === 'object') {
        Object.entries(root).forEach(([k, v]) => {
          if (typeof v === 'string' && keys.has(k.toLowerCase())) {
            out.push(v);
          } else {
            collectStringsByKeys(v, keys, out, depth + 1);
          }
        });
      }
      return out;
    };
    const extractByRegex = (source: string, regex: RegExp) => {
      const out: string[] = [];
      for (const match of source.matchAll(regex)) {
        const val = String(match[1] || '').trim();
        if (!val) continue;
        out.push(decodeEscaped(val));
      }
      return out;
    };
    const extractStructuredArticleText = (source: string) => {
      const candidates: string[] = [];
      const authors: string[] = [];
      const headlines: string[] = [];
      const wanted = new Set([
        'articlebody',
        'description',
        'headline',
        'summary',
        'body',
        'name',
      ]);

      const jsonLdMatches = [...source.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      for (const match of jsonLdMatches) {
        const rawJson = String(match[1] || '').trim();
        if (!rawJson) continue;
        try {
          const parsed = JSON.parse(rawJson);
          const values = collectStringsByKeys(parsed, wanted);
          values.forEach((v) => candidates.push(v));
        } catch {
          // ignore malformed JSON-LD blocks
        }
      }

      const nextDataMatch = source.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch?.[1]) {
        try {
          const parsed = JSON.parse(String(nextDataMatch[1]).trim());
          const values = collectStringsByKeys(parsed, wanted);
          values.forEach((v) => candidates.push(v));
        } catch {
          // ignore malformed NEXT_DATA
        }
      }

      // Yahoo-specific and generic raw-string fallbacks when JSON structures are malformed/obfuscated.
      extractByRegex(source, /"articleBody"\s*:\s*"([\s\S]*?)"/gi).forEach((v) => candidates.push(v));
      extractByRegex(source, /"headline"\s*:\s*"([\s\S]*?)"/gi).forEach((v) => headlines.push(v));
      extractByRegex(source, /"author"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+?)"[\s\S]*?\}/gi).forEach((v) => authors.push(v));
      extractByRegex(source, /"byline"\s*:\s*"([\s\S]*?)"/gi).forEach((v) => authors.push(v));

      const cleaned = candidates
        .map((t) => decodeEscaped(String(t || '')))
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter((t) => t.length >= 120);
      const body = cleaned.length ? cleaned.sort((a, b) => b.length - a.length)[0] : '';
      const headline = headlines
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter((t) => t.length >= 10)
        .sort((a, b) => b.length - a.length)[0] || '';
      const author = authors
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .filter((t) => t.length >= 3 && t.length <= 80)
        .sort((a, b) => b.length - a.length)[0] || '';

      if (!body && !headline) return '';
      return [headline, author ? `Par ${author}` : '', body].filter(Boolean).join('\n\n').trim();
    };
    const extractYahooDomArticleText = (doc: Document) => {
      const headline =
        (doc.querySelector('h1')?.textContent || '').trim();

      const selectorCandidates = [
        '[data-testid="caas-body"] p',
        '.caas-body p',
        '[class*="caas-body"] p',
        'article p',
        'main article p',
      ];
      let bestParagraphs: string[] = [];
      for (const selector of selectorCandidates) {
        const paragraphs = Array.from(doc.querySelectorAll(selector))
          .map((n) => String((n as HTMLElement).innerText || n.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 50);
        if (paragraphs.length > bestParagraphs.length) {
          bestParagraphs = paragraphs;
        }
      }
      if (!bestParagraphs.length) return '';
      const joined = bestParagraphs.join('\n\n');
      return [headline, joined].filter(Boolean).join('\n\n').trim();
    };

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const pageUrl = `${doc.location?.href || ''} ${html}`.toLowerCase();
      const isYahoo = /yahoo\.com/.test(pageUrl);
      if (isYahoo) {
        const yahooDom = extractYahooDomArticleText(doc);
        if (yahooDom && yahooDom.length >= 300) {
          return formatLongTextForReading(yahooDom);
        }
      }
      const reader = new Readability(doc, {
        charThreshold: 120,
        keepClasses: false,
        maxElemsToParse: 0,
      });
      const article = reader.parse();
      if (!article) return '';
      const articleHtml = String(article.content || article.textContent || '').trim();
      if (!articleHtml) return '';
      const plain = extractReadableFromHtml(articleHtml);
      const structured = extractStructuredArticleText(html);
      const chosen = (isYahoo && structured.length >= 200)
        ? structured
        : (plain.length >= structured.length ? plain : structured || plain);
      return formatLongTextForReading(chosen);
    } catch {
      const structured = extractStructuredArticleText(html);
      return structured ? formatLongTextForReading(structured) : '';
    }
  };

  const formatLongTextForReading = (raw: string) => {
    const normalized = decodeEntities(String(raw || ''))
      .replace(/\r/g, '\n')
      .replace(/\t+/g, ' ')
      .replace(/\s+[|]\s+/g, '\n')
      .replace(/\s+[•·]\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!normalized) return normalized;
    const hasLineBreaks = normalized.includes('\n');
    if (hasLineBreaks) {
      const lines = normalized
        .split(/\n+/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return lines.join('\n');
    }

    const sentences = normalized
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+(?=[A-Z0-9À-ÖØ-Þ])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length >= 5) {
      const blocks: string[] = [];
      let current = '';
      for (const s of sentences) {
        if (!current) {
          current = s;
          continue;
        }
        if ((current.length + 1 + s.length) > 320) {
          blocks.push(current);
          current = s;
        } else {
          current = `${current} ${s}`;
        }
      }
      if (current) blocks.push(current);
      return blocks.join('\n\n');
    }

    const words = normalized.split(/\s+/);
    const rows: string[] = [];
    let row = '';
    let count = 0;
    for (const w of words) {
      if (!row) {
        row = w;
        count = 1;
        continue;
      }
      if (count >= 18) {
        rows.push(row);
        row = w;
        count = 1;
      } else {
        row = `${row} ${w}`;
        count += 1;
      }
    }
    if (row) rows.push(row);
    return rows.join('\n');
  };

  const cleanWebChromeNoise = (raw: string, sourceUrl?: string) => {
    let text = String(raw || '');
    if (!text.trim()) return text;
    const collapse = text.replace(/\s+/g, ' ').trim();
    const source = String(sourceUrl || '').toLowerCase();
    const isLaPresse = source.includes('lapresse.ca');
    const isYahoo = source.includes('yahoo.com');

    const trailingMarkers = [
      'Nos incontournables',
      'Toutes les infolettres',
      'Les plus consultés',
      'Actualités Vidéos',
      'Nous joindre',
      'Exprimez-vous',
      'Contribuez au dialogue',
    ];
    let cutTail = collapse.length;
    for (const marker of trailingMarkers) {
      const idx = collapse.indexOf(marker);
      if (idx >= 0) cutTail = Math.min(cutTail, idx);
    }
    text = collapse.slice(0, cutTail);

    if (isLaPresse) {
      // Remove common leading site chrome visible on La Presse pages.
      text = text.replace(/^.*?(?=Justice et faits divers|Actualités|International|Affaires|Sports|Arts|Société|Gourmand|Voyage|Maison)\s*/i, '');
    }

    const menuNoisePatterns = [
      /Consulter lapresse\.ca[\s\S]*?Se déconnecter/gi,
      /Accueil Actualités[\s\S]*?Liens utiles/gi,
      /Actualités International Dialogue Contexte Affaires Sports Auto Arts[\s\S]*?Votre compte/gi,
      /Chroniques Éditoriaux Caricatures Analyses National Politique[\s\S]*?Je soutiens La Presse/gi,
      /Votre compte La Presse[\s\S]*?Se déconnecter/gi,
      /À propos de La Presse Centre d'aide La Presse/gi,
      /PHOTO FOURNIE PAR LA SÛRETÉ DU QUÉBEC/gi,
      /\b\d+\s*\/\s*\d+\b/gi,
    ];
    menuNoisePatterns.forEach((pattern) => {
      text = text.replace(pattern, ' ');
    });

    if (isYahoo) {
      text = text
        .replace(/Investment ideas Research reports Community Personal Finance[\s\S]*?Watch Now/gi, ' ')
        .replace(/Yahoo Sports AM Show all[\s\S]*?Terms Privacy/gi, ' ')
        .replace(/Best [A-Za-z0-9%'\- ]{3,80}(?=\s)/g, ' ');
    }

    // Keep a likely article-centered window when publication timestamp exists.
    const publishedIdx = text.search(/\bPublié à\b/i);
    if (publishedIdx > 0) {
      const start = Math.max(0, publishedIdx - 1200);
      text = text.slice(start);
    }

    return text.replace(/\s{2,}/g, ' ').trim();
  };

  const forceLineWrap = (raw: string, wordsPerLine = 32) => {
    const words = String(raw || '')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (!words.length) return '';
    const lines: string[] = [];
    let line: string[] = [];
    for (const w of words) {
      line.push(w);
      if (line.length >= wordsPerLine) {
        lines.push(line.join(' '));
        line = [];
      }
    }
    if (line.length) lines.push(line.join(' '));
    return lines.join('\n');
  };

  const formatSegmentDisplayText = (segment: Segment) => {
    const trace = segment.analysisTrace || latestConversationTrace;
    const granularity = String(trace?.granularityName || '').toLowerCase();
    const isMarkupWeb = granularity.includes('markup') || granularity.includes('html') || granularity.includes('xml');
    const source = String(segment.originalText || segment.content || '');
    let readable = isMarkupWeb ? extractReadableFromHtml(source) : source;

    if (isMarkupWeb && segment.role === 'assistant') {
      const technical = (segments || []).find((s) => s.role === 'system' && s.conversationId === segment.conversationId);
      if (technical) {
        const technicalSource = String(technical.originalText || technical.content || '');
        const articleReadable = extractArticleFromHtml(technicalSource);
        const technicalReadable = articleReadable || formatLongTextForReading(
          extractReadableFromHtml(technicalSource)
        );
        const currentReadable = formatLongTextForReading(readable);
        const technicalLen = technicalReadable.replace(/\s+/g, ' ').trim().length;
        const currentLen = currentReadable.replace(/\s+/g, ' ').trim().length;
        // If socratic segment is too short or likely collapsed, prefer article-like text derived from technical source.
        if (technicalLen > 400 && currentLen < Math.max(220, Math.floor(technicalLen * 0.35))) {
          readable = technicalReadable;
        }
      }
    }

    let output = formatLongTextForReading(readable);
    if (isMarkupWeb) {
      output = formatLongTextForReading(cleanWebChromeNoise(output, trace?.webDocumentUrl || trace?.webSourceUrl));
      const lines = output.split('\n').filter(Boolean);
      const hasLongLine = lines.some((l) => l.length > 260);
      if (hasLongLine || lines.length <= 2) {
        output = forceLineWrap(output, 32);
      }
    }
    return output;
  };

  const parseWebDisplayZones = (text: string) => {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { title: '', meta: [] as string[], body: '' };

    const title = raw.split(/(?<=[!?\.])\s+/)[0] || '';
    const meta: string[] = [];

    const extract = (regex: RegExp, label: string) => {
      const m = raw.match(regex);
      if (m?.[0]) {
        const v = m[0].replace(/\s+/g, ' ').trim();
        if (v) meta.push(`${label}: ${v}`);
      }
    };

    extract(/Publié à\s+[0-9h:\s]{2,20}/i, 'Publié');
    extract(/Mis à jour à\s+[0-9h:\s]{2,20}/i, 'Mis à jour');
    extract(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'Courriel');

    const accountFlags = [
      /\bSe connecter\b/i.test(raw),
      /\bMon profil\b/i.test(raw),
      /\bMes dons\b/i.test(raw),
      /\bSe déconnecter\b/i.test(raw),
    ];
    if (accountFlags.some(Boolean)) {
      meta.push('Espace compte détecté');
    }

    let body = raw
      .replace(/Publié à\s+[0-9h:\s]{2,20}/gi, ' ')
      .replace(/Mis à jour à\s+[0-9h:\s]{2,20}/gi, ' ')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
      .replace(/\bSe connecter\b|\bMon profil\b|\bMes dons\b|\bSe déconnecter\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (title && body.toLowerCase().startsWith(title.toLowerCase())) {
      body = body.slice(title.length).trim();
    }

    body = formatLongTextForReading(body);
    return { title, meta, body };
  };

  const renderSegmentContent = (segment: Segment) => {
    const trace = segment.analysisTrace || latestConversationTrace;
    const granularity = String(trace?.granularityName || '').toLowerCase();
    const isMarkupWeb = granularity.includes('markup') || granularity.includes('html') || granularity.includes('xml');
    const formatted = formatSegmentDisplayText(segment);

    if (!(isMarkupWeb && segment.role === 'assistant')) {
      return (
        <div className="text-natural-text leading-relaxed whitespace-pre-wrap text-base md:text-lg font-serif">
          {formatted}
        </div>
      );
    }

    const zones = parseWebDisplayZones(formatted);
    return (
      <div className="space-y-3">
        {!!zones.title && (
          <div className="rounded-2xl border border-natural-sand bg-white p-3">
            <p className="text-[10px] uppercase tracking-widest font-black text-natural-muted">Titre</p>
            <p className="text-base md:text-lg font-serif text-natural-heading mt-1">{zones.title}</p>
          </div>
        )}
        {zones.meta.length > 0 && (
          <div className="rounded-2xl border border-natural-sand bg-natural-bg/40 p-3">
            <p className="text-[10px] uppercase tracking-widest font-black text-natural-muted mb-2">Métadonnées détectées</p>
            <div className="flex flex-wrap gap-2">
              {zones.meta.map((m, i) => (
                <span key={`${m}-${i}`} className="text-[10px] font-bold px-2 py-1 rounded-full bg-white border border-natural-sand text-natural-stone">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-natural-sand bg-white p-3">
          <p className="text-[10px] uppercase tracking-widest font-black text-natural-muted">Corps de l’article</p>
          <p className="text-natural-text leading-relaxed whitespace-pre-wrap text-base md:text-lg font-serif mt-2">
            {zones.body || formatted}
          </p>
        </div>
      </div>
    );
  };
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.mode === 'local' || detail?.mode === 'provider') {
        setVectorEngineMode(detail.mode);
      } else {
        setVectorEngineMode(((localStorage.getItem('VECTOR_ENGINE_MODE') as any) || 'local'));
      }
    };
    window.addEventListener('vector-engine-mode-changed', handler as EventListener);
    return () => window.removeEventListener('vector-engine-mode-changed', handler as EventListener);
  }, []);
  useEffect(() => {
    localStorage.setItem(`SOCRATE_CONV_VIEW_MODE_${convId}`, viewMode);
  }, [convId, viewMode]);

  const renderDeferredPanel = (node: React.ReactNode, minHeightClass = 'min-h-[300px]') => (
    <Suspense
      fallback={
        <div className={`${minHeightClass} bg-white rounded-[32px] border border-natural-sand shadow-sm p-8 text-sm text-natural-muted flex items-center gap-3`}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement de la visualisation...
        </div>
      }
    >
      {node}
    </Suspense>
  );

  if (!conversation) return null;

  const handleDelete = async () => {
    if (confirm('Supprimer cette conversation et tous ses segments définitivement ?')) {
      console.log("Delete triggered for conv:", convId);
      await db.conversations.delete(convId);
      await db.segments.where('conversationId').equals(convId).delete();
      console.log("Deleted conv and segments");
      onBack();
    }
  };

  const handleDeepAnalysis = async () => {
    if (!conversation) return;
    setIsAnalyzingDeep(true);
    try {
      // Concatenate all segments original text for deep analysis
      const allText = segments?.map(s => s.originalText || s.content).join('\n\n') || '';
      const { deepAnalyzeConversation } = await loadGeminiService();
      const analysis = await deepAnalyzeConversation(allText);
      await db.conversations.update(convId, { deepAnalysis: analysis });
    } catch (error) {
      console.error(error);
      alert("Erreur lors de l'analyse profonde.");
    } finally {
      setIsAnalyzingDeep(false);
    }
  };

  const buildLocalVectorDescription = (text: string) => {
    const tokens = String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const freq = new Map<string, number>();
    tokens.forEach((t) => freq.set(t, (freq.get(t) || 0) + 1));
    const topTerms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term, weight]) => `${term}:${weight}`);
    if (!topTerms.length) return 'Vecteur local indisponible (segment trop court).';
    return `Vecteur lexical local (top dimensions): ${topTerms.join(' | ')}`;
  };

  const handleSegmentSemanticAction = async (
    segment: Segment,
    type: 'vector' | 'interpretation'
  ) => {
    const hasData = type === 'vector' ? !!segment.semanticVectorDescription : !!segment.semanticInterpretation;
    if (hasData) {
      setActiveSemanticDetail(
        activeSemanticDetail?.id === segment.id && activeSemanticDetail?.type === type
          ? null
          : { id: segment.id, type }
      );
      return;
    }

    if (type === 'vector' && vectorEngineMode === 'local') {
      const localVectorDescription = buildLocalVectorDescription(segment.originalText || segment.content);
      await db.segments.update(segment.id, {
        semanticVectorDescription: localVectorDescription,
      });
      setActiveSemanticDetail({ id: segment.id, type });
      return;
    }

    setSemanticLoadingBySegment((prev) => ({ ...prev, [segment.id]: true }));
    try {
      const { enrichSegmentSemantics } = await loadGeminiService();
      const enriched = await enrichSegmentSemantics(
        segment.originalText || segment.content,
        segment.role,
        conversation.semanticAnalysis?.summary || ''
      );
      await db.segments.update(segment.id, {
        semanticVectorDescription: enriched.semanticVectorDescription,
        semanticInterpretation: enriched.semanticInterpretation,
      });
      setActiveSemanticDetail({ id: segment.id, type });
    } catch (error) {
      console.error(error);
      alert("Impossible de calculer l'analyse sémantique de ce segment.");
    } finally {
      setSemanticLoadingBySegment((prev) => ({ ...prev, [segment.id]: false }));
    }
  };

  return (
    <>
      <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-6xl mx-auto w-full pb-20 grid grid-cols-1 lg:grid-cols-3 gap-10"
    >
      <div className="lg:col-span-2">
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-6">
            <button 
              onClick={onBack}
              className="p-3 hover:bg-natural-sand rounded-full transition-colors text-natural-muted shadow-sm bg-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-serif text-3xl text-natural-heading mb-1">{conversation.title}</h1>
              <div className="flex items-center gap-6 mt-1 text-[10px] text-natural-muted font-bold uppercase tracking-widest">
                <span className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDate(conversation.createdAt)}
                </span>
                <span className="flex items-center gap-2 px-3 py-1 bg-natural-sand rounded-full text-natural-accent">
                  <Tag className="w-3.5 h-3.5" />
                  {conversation.segmentsCount} segments
                </span>
                {latestConversationTrace && (
                  <span className="flex items-center gap-2 px-3 py-1 bg-white border border-natural-sand rounded-full text-natural-muted" title={formatTrace(latestConversationTrace)}>
                    <Fingerprint className="w-3.5 h-3.5" />
                    Trace active
                  </span>
                )}
                <div className="flex bg-natural-bg/50 rounded-2xl p-1.5 border border-natural-sand shadow-inner ml-4">
                  <button 
                    onClick={() => setViewMode('flux')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-1.5 rounded-xl transition-all text-[11px] font-bold uppercase tracking-wider", 
                      viewMode === 'flux' ? "bg-white text-natural-accent shadow-sm" : "text-natural-muted hover:text-natural-heading"
                    )}
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Flux</span>
                  </button>
                  <button 
                    onClick={() => setViewMode('carte')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-1.5 rounded-xl transition-all text-[11px] font-bold uppercase tracking-wider", 
                      viewMode === 'carte' ? "bg-white text-natural-accent shadow-sm" : "text-natural-muted hover:text-natural-heading"
                    )}
                  >
                    <Network className="w-3.5 h-3.5" />
                    <span>Carte</span>
                  </button>
                  <button 
                    onClick={() => setViewMode('graphe')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-1.5 rounded-xl transition-all text-[11px] font-bold uppercase tracking-wider", 
                      viewMode === 'graphe' ? "bg-white text-natural-accent shadow-sm" : "text-natural-muted hover:text-natural-heading"
                    )}
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Graphe</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button 
            onClick={handleDelete}
            className="p-3 text-natural-stone hover:text-natural-brown hover:bg-natural-peach rounded-2xl transition-all shadow-sm bg-white"
            title="Supprimer"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </header>

        <section className="mb-6 bg-white rounded-[24px] border border-natural-sand shadow-sm p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-natural-muted">Comparer deux conversations</h3>
            <Network className="w-4 h-4 text-natural-accent" />
          </div>
          <select
            value={compareConversationId}
            onChange={(e) => setCompareConversationId(e.target.value)}
            className="w-full p-3 bg-white border border-natural-sand rounded-xl text-xs text-natural-heading"
          >
            <option value="">Choisir une conversation a comparer</option>
            {allConversations
              .filter((c) => c.id !== convId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
          {compareConversationId && !compareConversation && (
            <p className="mt-3 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Conversation de comparaison introuvable. Recharge la page puis re-sélectionne la conversation.
            </p>
          )}
          {compareConversation && (
            <div className="mt-3 bg-natural-bg/50 rounded-xl border border-natural-sand p-3 space-y-1 text-[11px] text-natural-stone">
              <p>
                Comparaison active avec: <span className="font-bold text-natural-heading">{compareConversation.title}</span>
              </p>
              <p>
                Score global actuel: <span className="font-bold text-natural-heading">
                  {Number.isFinite(latestConversationTrace?.interestGlobalScore as number)
                    ? `${Math.round(Number(latestConversationTrace?.interestGlobalScore) * 100)}%`
                    : 'n/a'}
                </span>
                {' '}| compare: <span className="font-bold text-natural-heading">
                  {Number.isFinite(compareTrace?.interestGlobalScore as number)
                    ? `${Math.round(Number(compareTrace?.interestGlobalScore) * 100)}%`
                    : 'n/a'}
                </span>
              </p>
              <p>
                Positions initiales: <span className="font-bold text-natural-heading">{Math.round(initialPositionScore * 100)}%</span>
                {' '}({currentPositionSegments.length} vs {comparePositionSegments.length})
                {' '}| Analyses socratiques: <span className="font-bold text-natural-heading">{Math.round(socraticAnalysisScore * 100)}%</span>
                {' '}({currentSocraticSegments.length} vs {compareSocraticSegments.length})
              </p>
            </div>
          )}
        </section>

        {compareConversation && (
          <ComparisonErrorBoundary>
            <section className="mb-8 space-y-4">
              <div className="bg-white rounded-[24px] border border-natural-sand shadow-sm p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Comparaison - Positions initiales</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-natural-sand bg-white p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">ACTUEL</p>
                    <p className="text-[10px] text-natural-stone mb-2 leading-relaxed">{renderTraceComparisonLine(currentTraceFields, compareTraceFields)}</p>
                    <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                      {currentPositionSegments.length ? currentPositionSegments.map((seg, idx) => (
                        <div key={`cmp-pi-left-${seg.id}`} className="rounded-lg border border-natural-sand/70 bg-natural-bg/30 p-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-natural-stone mb-1">#{idx + 1}</p>
                          <p className="text-[11px] text-natural-stone leading-relaxed whitespace-pre-wrap">
                            {renderUncommonPhrasesAgainstCorpus(String(seg.originalText || seg.content || ''), comparePositionIndex)}
                          </p>
                        </div>
                      )) : <p className="text-[11px] italic text-natural-muted">Aucune position initiale</p>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-natural-sand bg-white p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">COMPARE</p>
                    <p className="text-[10px] text-natural-stone mb-2 leading-relaxed">{renderTraceComparisonLine(compareTraceFields, currentTraceFields)}</p>
                    <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                      {comparePositionSegments.length ? comparePositionSegments.map((seg, idx) => (
                        <div key={`cmp-pi-right-${seg.id}`} className="rounded-lg border border-natural-sand/70 bg-natural-bg/30 p-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-natural-stone mb-1">#{idx + 1}</p>
                          <p className="text-[11px] text-natural-stone leading-relaxed whitespace-pre-wrap">
                            {renderUncommonPhrasesAgainstCorpus(String(seg.originalText || seg.content || ''), currentPositionIndex)}
                          </p>
                        </div>
                      )) : <p className="text-[11px] italic text-natural-muted">Aucune position initiale</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[24px] border border-natural-sand shadow-sm p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Comparaison - Analyses socratiques</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-natural-sand bg-white p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">ACTUEL</p>
                    <p className="text-[10px] text-natural-stone mb-2 leading-relaxed">{renderTraceComparisonLine(currentTraceFields, compareTraceFields)}</p>
                    <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                      {currentSocraticSegments.length ? (() => {
                        const markerState = { current: 1 };
                        return currentSocraticSegments.map((seg, idx) => (
                          <div key={`cmp-sa-left-${seg.id}`} className="rounded-lg border border-natural-sand/70 bg-natural-bg/30 p-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-natural-stone mb-1">#{idx + 1}</p>
                            <p className="text-[11px] text-natural-stone leading-relaxed whitespace-pre-wrap">
                              {renderUncommonPhrasesAgainstCorpus(String(seg.originalText || seg.content || ''), compareSocraticIndex, true, markerState)}
                            </p>
                          </div>
                        ));
                      })() : <p className="text-[11px] italic text-natural-muted">Aucune analyse socratique</p>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-natural-sand bg-white p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted mb-1">COMPARE</p>
                    <p className="text-[10px] text-natural-stone mb-2 leading-relaxed">{renderTraceComparisonLine(compareTraceFields, currentTraceFields)}</p>
                    <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1">
                      {compareSocraticSegments.length ? (() => {
                        const markerState = { current: 1 };
                        return compareSocraticSegments.map((seg, idx) => (
                          <div key={`cmp-sa-right-${seg.id}`} className="rounded-lg border border-natural-sand/70 bg-natural-bg/30 p-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-natural-stone mb-1">#{idx + 1}</p>
                            <p className="text-[11px] text-natural-stone leading-relaxed whitespace-pre-wrap">
                              {renderUncommonPhrasesAgainstCorpus(String(seg.originalText || seg.content || ''), currentSocraticIndex, true, markerState)}
                            </p>
                          </div>
                        ));
                      })() : <p className="text-[11px] italic text-natural-muted">Aucune analyse socratique</p>}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </ComparisonErrorBoundary>
        )}

        <div className="space-y-8">
          {viewMode === 'flux' ? (
            segments?.map((segment, index) => (
              <div key={segment.id} className="group relative">
                <div 
                  onClick={() => setInspectedSegment(segment)}
                  className={cn(
                    "flex gap-6 p-8 rounded-[32px] border border-natural-sand shadow-sm transition-all hover:shadow-md cursor-zoom-in active:scale-[0.99]",
                    segment.role === 'assistant' ? 'bg-white' : segment.role === 'system' ? 'bg-natural-peach/20' : 'bg-natural-bg',
                    segment.metadata?.isPivot && 'border-natural-brown border-2'
                  )}
                >
                  <div className={`mt-1 w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                    segment.role === 'assistant'
                      ? 'bg-natural-accent text-white'
                      : segment.role === 'system'
                        ? 'bg-natural-brown text-white'
                        : 'bg-natural-beige text-natural-muted'
                  }`}>
                    {segment.role === 'assistant' ? <Bot className="w-6 h-6" /> : segment.role === 'system' ? <Settings className="w-6 h-6" /> : <User className="w-6 h-6" />}
                  </div>
                  
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em]">
                          {segment.role === 'assistant' ? 'Analyse Socratique' : segment.role === 'system' ? 'Segment Technique' : 'Position Initiale'}
                        </span>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-natural-sand/50 px-2 py-0.5 rounded text-[9px] font-bold text-natural-muted uppercase text-center min-w-[120px]">Cliquez : Inspecter</div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {segment.metadata?.isPivot && (
                          <span className="flex items-center gap-2 text-[10px] bg-natural-peach text-natural-brown px-3 py-1 rounded-full font-black uppercase tracking-[0.15em] mr-2">
                            <Compass className="w-3 h-3" />
                            Pivot
                          </span>
                        )}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSegmentSemanticAction(segment, 'vector');
                          }}
                          disabled={!!semanticLoadingBySegment[segment.id]}
                          className={cn(
                            "p-2 rounded-lg transition-all border",
                            activeSemanticDetail?.id === segment.id && activeSemanticDetail?.type === 'vector' 
                              ? "bg-natural-accent text-white border-natural-accent shadow-md" 
                              : "bg-white text-natural-stone border-natural-sand hover:bg-natural-bg",
                            semanticLoadingBySegment[segment.id] && "opacity-60 cursor-wait"
                          )}
                          title="Vecteur Sémantique"
                        >
                          {semanticLoadingBySegment[segment.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSegmentSemanticAction(segment, 'interpretation');
                          }}
                          disabled={!!semanticLoadingBySegment[segment.id]}
                          className={cn(
                            "p-2 rounded-lg transition-all border",
                            activeSemanticDetail?.id === segment.id && activeSemanticDetail?.type === 'interpretation' 
                              ? "bg-natural-accent text-white border-natural-accent shadow-md" 
                              : "bg-white text-natural-stone border-natural-sand hover:bg-natural-bg",
                            semanticLoadingBySegment[segment.id] && "opacity-60 cursor-wait"
                          )}
                          title="Interprétation Sémantique"
                        >
                          {semanticLoadingBySegment[segment.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpenText className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    {renderSegmentContent(segment)}
                    <div className="text-[10px] text-natural-stone uppercase tracking-wider font-semibold border-t border-dashed border-natural-sand pt-3">
                      Conversation: {conversation.title}
                    </div>
                    {(segment.analysisTrace || latestConversationTrace) && (
                      <div className="text-[10px] text-natural-muted uppercase tracking-wider font-semibold">
                        {formatTrace(segment.analysisTrace || latestConversationTrace)}
                      </div>
                    )}
                    
                    {segment.semanticSignature && (
                      <div className="text-[10px] text-natural-accent font-medium italic opacity-70 flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        {segment.semanticSignature}
                      </div>
                        )}
                    
                    {segment.tags && segment.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-4 border-t border-natural-sand">
                        {segment.tags.map(tag => (
                          <span key={tag} className="text-[10px] font-bold px-3 py-1 bg-white border border-natural-border text-natural-muted rounded-full uppercase tracking-tight">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                
                {index < (segments.length - 1) && (
                  <div className="absolute left-13 -bottom-5 w-px h-10 bg-natural-sand z-0" />
                )}
              </div>
            ))
          ) : viewMode === 'carte' ? (
            <div className="relative group/map">
              {latestConversationTrace && (
                <div className="mb-3 px-4 py-2 rounded-2xl border border-natural-sand bg-white text-[10px] font-bold uppercase tracking-wider text-natural-muted">
                  {formatTrace(latestConversationTrace)}
                </div>
              )}
              {renderDeferredPanel(
                <ConceptualMap 
                  conversation={conversation} 
                  segments={segments || []} 
                  onFullscreen={() => setIsMapFullscreen(true)}
                  onSelectSegment={setInspectedSegment}
                />,
                'min-h-[700px]'
              )}
            </div>
          ) : (
            <div className="min-h-[600px]">
              {latestConversationTrace && (
                <div className="mb-3 px-4 py-2 rounded-2xl border border-natural-sand bg-white text-[10px] font-bold uppercase tracking-wider text-natural-muted">
                  {formatTrace(latestConversationTrace)}
                </div>
              )}
              {renderDeferredPanel(
                <KnowledgeGraphView 
                  graph={conversation.knowledgeGraph || { nodes: [], edges: [] }} 
                  contextCorpus={(segments || []).map((s) => s.originalText || s.content)}
                  onFullscreen={() => setIsGraphFullscreen(true)}
                />,
                'min-h-[600px]'
              )}
            </div>
          )}
        </div>

        {/* Fullscreen Map Modal */}
        <AnimatePresence>
          {isMapFullscreen && conversation && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-natural-bg overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-natural-sand flex justify-between items-center bg-white">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-natural-accent rounded-xl flex items-center justify-center">
                    <Network className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl text-natural-heading">{conversation.title}</h2>
                    <p className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em]">Visualisation Pleine Écran</p>
                    {latestConversationTrace && (
                      <p className="text-[10px] font-semibold text-natural-stone uppercase tracking-wider mt-1">{formatTrace(latestConversationTrace)}</p>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => setIsMapFullscreen(false)}
                  className="w-12 h-12 bg-natural-sand rounded-full flex items-center justify-center text-natural-muted hover:bg-natural-peach hover:text-natural-brown transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 bg-natural-bg/30">
                {renderDeferredPanel(
                  <ConceptualMap 
                    conversation={conversation} 
                    segments={segments || []} 
                    onSelectSegment={(s) => {
                      setInspectedSegment(s);
                      setIsMapFullscreen(false);
                    }}
                  />,
                  'min-h-[500px]'
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Segment Inspection Modal */}
        <AnimatePresence>
          {inspectedSegment && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-natural-heading/20 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setInspectedSegment(null)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-white max-w-2xl w-full rounded-[40px] shadow-2xl overflow-hidden border border-natural-sand"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-10 space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg",
                        inspectedSegment.role === 'assistant'
                          ? "bg-natural-accent text-white"
                          : inspectedSegment.role === 'system'
                            ? "bg-natural-brown text-white"
                            : "bg-natural-beige text-natural-muted"
                      )}>
                        {inspectedSegment.role === 'assistant' ? <Bot className="w-8 h-8" /> : inspectedSegment.role === 'system' ? <Settings className="w-8 h-8" /> : <User className="w-8 h-8" />}
                      </div>
                      <div>
                        <h4 className="font-serif text-2xl text-natural-heading">Inspection du segment</h4>
                        <p className="text-[10px] font-bold text-natural-muted uppercase tracking-widest">
                          {inspectedSegment.role === 'assistant' ? 'Socrate' : inspectedSegment.role === 'system' ? 'Technique' : 'Explorateur'} • ID: {inspectedSegment.id.substring(0, 8)}
                        </p>
                        <p className="text-[10px] font-semibold text-natural-stone uppercase tracking-wider mt-1">
                          Conversation: {conversation.title}
                        </p>
                        {(inspectedSegment.analysisTrace || latestConversationTrace) && (
                          <p className="text-[10px] font-semibold text-natural-muted uppercase tracking-wider mt-1">
                            {formatTrace(inspectedSegment.analysisTrace || latestConversationTrace)}
                          </p>
                        )}
                      </div>
                    </div>
                    <button 
                      onClick={() => setInspectedSegment(null)}
                      className="p-2 hover:bg-natural-sand rounded-2xl transition-colors"
                    >
                      <X className="w-6 h-6 text-natural-stone" />
                    </button>
                  </div>

                  <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    <div className="relative">
                      <div className="absolute -left-4 top-0 w-1 h-full bg-natural-accent rounded-full opacity-30" />
                      <div className="text-[11px] font-black text-natural-muted uppercase tracking-widest mb-2 pl-6 flex items-center gap-2">
                        <Quote className="w-3 h-3" />
                        Texte Verbatim (Original)
                      </div>
                      <div className="text-lg leading-relaxed font-serif text-natural-text pl-6 py-2 bg-natural-bg/30 rounded-r-3xl whitespace-pre-wrap break-words">
                        {renderSegmentContent(inspectedSegment)}
                      </div>
                    </div>

                    <div className="bg-natural-sand/30 p-6 rounded-3xl space-y-2 border border-natural-sand">
                      <div className="text-[11px] font-black text-natural-stone uppercase tracking-widest flex items-center gap-2">
                        <BrainCircuit className="w-3 h-3" />
                        Essence (Analyse IA)
                      </div>
                      <p className="text-sm text-natural-muted italic leading-relaxed whitespace-pre-wrap break-words">
                        {formatLongTextForReading(String(inspectedSegment.content || ''))}
                      </p>
                    </div>

                    {inspectedSegment.metadata?.isPivot && (
                    <div className="bg-natural-peach/50 p-6 rounded-3xl border border-natural-brown/20 space-y-2">
                      <div className="flex items-center gap-2 text-natural-brown font-bold text-xs uppercase tracking-widest">
                        <Compass className="w-4 h-4" />
                        Pivot Conceptuel Détecté
                      </div>
                      <p className="text-sm text-natural-brown/80 italic">
                        {inspectedSegment.metadata?.reason || "Ce segment marque une bifurcation dans la maïeutique, redirigeant l'exploration vers de nouvelles fondations sémantiques."}
                      </p>
                    </div>
                  )}

                  {inspectedSegment.semanticVectorDescription && (
                    <div className="bg-white p-6 rounded-3xl border border-natural-sand space-y-3">
                      <div className="flex items-center gap-2 text-natural-accent font-black text-[10px] uppercase tracking-widest">
                        <Fingerprint className="w-4 h-4" />
                        Vecteur Sémantique
                      </div>
                      <p className="text-xs text-natural-muted font-mono leading-relaxed bg-natural-bg/50 p-4 rounded-xl border border-natural-sand/50">
                        {inspectedSegment.semanticVectorDescription}
                      </p>
                    </div>
                  )}

                  {inspectedSegment.semanticInterpretation && (
                    <div className="bg-natural-accent/5 p-6 rounded-3xl border border-natural-accent/10 space-y-3">
                      <div className="flex items-center gap-2 text-natural-accent font-black text-[10px] uppercase tracking-widest">
                        <Sparkles className="w-4 h-4" />
                        Interprétation Socratique
                      </div>
                      <p className="text-sm text-natural-heading italic leading-relaxed">
                        {inspectedSegment.semanticInterpretation}
                      </p>
                    </div>
                  )}

                  {inspectedSegment.knowledgeGraph && inspectedSegment.knowledgeGraph.nodes?.length > 0 && (
                    <div className="h-[300px] border border-natural-sand rounded-3xl overflow-hidden shadow-sm mt-4">
                      {renderDeferredPanel(
                        <KnowledgeGraphView
                          graph={inspectedSegment.knowledgeGraph}
                          standalone={true}
                          contextCorpus={[inspectedSegment.originalText || inspectedSegment.content]}
                        />,
                        'min-h-[300px]'
                      )}
                    </div>
                  )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-6 border-t border-natural-sand">
                    {inspectedSegment.tags?.map(tag => (
                      <span key={tag} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 bg-natural-sand text-natural-muted rounded-full uppercase tracking-tight">
                        <Tag className="w-3 h-3" />
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button 
                      onClick={() => {
                        const blob = new Blob([inspectedSegment.originalText || inspectedSegment.content], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `segment-${inspectedSegment.id}.md`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      }}
                      className="flex-1 bg-natural-accent text-white py-4 rounded-2xl font-bold text-sm hover:translate-y-[-2px] transition-all active:translate-y-0 shadow-lg shadow-natural-accent/20 flex items-center justify-center gap-2"
                    >
                       <FileText className="w-4 h-4" />
                       Exporter ce segment
                    </button>
                    <button 
                      onClick={() => setInspectedSegment(null)}
                      className="px-8 py-4 bg-natural-sand text-natural-muted rounded-2xl font-bold text-sm hover:bg-natural-peach hover:text-natural-brown transition-all"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sidebar Analysis Panel */}
      <aside className="space-y-8 pb-32">
        <section className="bg-natural-sand rounded-[32px] p-8 border border-natural-beige shadow-sm sticky top-28 max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <Brain className="w-5 h-5 text-natural-accent" />
            </div>
            <h2 className="font-serif text-2xl text-natural-heading italic">Synthèse</h2>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em]">Aperçu du contenu</h4>
              <p className="text-sm text-natural-text leading-relaxed font-medium italic opacity-80">
                "{conversation.semanticAnalysis?.summary || "Analyse en cours..."}"
              </p>
            </div>

            <div className="space-y-4 pt-6 border-t border-natural-beige">
              <h4 className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em] flex items-center justify-between">
                Sémantique Détectée
                <Tag className="w-3.5 h-3.5" />
              </h4>
              <div className="flex flex-wrap gap-2">
                {(conversation.semanticAnalysis?.suggestedTags || conversation.semanticAnalysis?.themes || []).map(tag => (
                  <button key={tag} className="px-4 py-1.5 bg-white hover:bg-natural-accent hover:text-white text-natural-muted text-[11px] font-bold rounded-full border border-natural-border transition-all shadow-sm">
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {conversation.semanticAnalysis?.deviations && conversation.semanticAnalysis.deviations.length > 0 && (
              <div className="space-y-4 pt-6 border-t border-natural-beige">
                <h4 className="text-[10px] font-bold text-natural-brown uppercase tracking-[0.2em] flex items-center justify-between">
                  Déviations & Impasses
                  <Compass className="w-3.5 h-3.5" />
                </h4>
                <ul className="space-y-3">
                  {conversation.semanticAnalysis.deviations.map((d, i) => (
                    <li key={i} className="bg-white rounded-2xl p-4 shadow-sm border-l-4 border-natural-accent">
                      <p className="text-[10px] font-bold text-natural-muted mb-1 opacity-70 uppercase tracking-wide">OBSERVATION {i+1}</p>
                      <p className="text-xs text-natural-text leading-snug font-medium">{d}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-4 pt-6 border-t border-natural-beige">
              <h4 className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em] flex items-center justify-between">
                Analyse sémantique profonde (Conversation complète)
                <Zap className="w-3.5 h-3.5 text-natural-accent" />
              </h4>
              
              <div className="space-y-4">
                <h4 className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em] flex items-center justify-between">
                  Comparaison d'analyse
                  <Network className="w-3.5 h-3.5" />
                </h4>
                <select
                  value={compareConversationId}
                  onChange={(e) => setCompareConversationId(e.target.value)}
                  className="w-full p-3 bg-white border border-natural-sand rounded-xl text-xs text-natural-heading"
                >
                  <option value="">Choisir une conversation a comparer</option>
                  {allConversations.filter((c) => c.id !== convId).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>

                {compareConversation && (
                  <ComparisonErrorBoundary>
                    <div className="space-y-3">
                      <div className="bg-white rounded-2xl border border-natural-sand p-3 text-[11px] text-natural-stone space-y-1">
                        <p>Score global actuel: <span className="font-bold text-natural-heading">{Number.isFinite(latestConversationTrace?.interestGlobalScore as number) ? `${Math.round(Number(latestConversationTrace?.interestGlobalScore) * 100)}%` : 'n/a'}</span></p>
                        <p>Score global compare: <span className="font-bold text-natural-heading">{Number.isFinite(compareTrace?.interestGlobalScore as number) ? `${Math.round(Number(compareTrace?.interestGlobalScore) * 100)}%` : 'n/a'}</span></p>
                        <p>Score positions initiales: <span className="font-bold text-natural-heading">{Math.round(initialPositionScore * 100)}%</span> ({currentPositionSegments.length} vs {comparePositionSegments.length})</p>
                        <p>Score analyses socratiques: <span className="font-bold text-natural-heading">{Math.round(socraticAnalysisScore * 100)}%</span> ({currentSocraticSegments.length} vs {compareSocraticSegments.length})</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="rounded-lg border border-natural-sand p-2 bg-white">
                          <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">ACTUEL</p>
                          <p className="text-[10px] text-natural-stone mt-1 leading-relaxed">
                            {renderTraceComparisonLine(currentTraceFields, compareTraceFields)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-natural-sand p-2 bg-white">
                          <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">COMPARE</p>
                          <p className="text-[10px] text-natural-stone mt-1 leading-relaxed">
                            {renderTraceComparisonLine(compareTraceFields, currentTraceFields)}
                          </p>
                        </div>
                      </div>

                      {interestDiffRows.length > 0 ? (
                        <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                          {interestDiffRows.slice(0, 12).map((row) => (
                            <div key={row.label} className="bg-white rounded-xl border border-natural-sand p-3">
                              <p className="text-[11px] font-bold text-natural-heading">{row.label}</p>
                              <p className="text-[10px] text-natural-muted mt-1">
                                Actuel {(row.left * 100).toFixed(1)}% vs Compare {(row.right * 100).toFixed(1)}% | Delta {row.delta >= 0 ? '+' : ''}{(row.delta * 100).toFixed(1)} pts
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-natural-muted italic">Aucun score d'interet disponible pour comparer ces deux analyses.</p>
                      )}

                      <div className="bg-white rounded-xl border border-natural-sand p-3 space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Diff - Positions initiales</p>
                        {canDiffInitialPositions ? (
                          <div className="max-h-[360px] overflow-y-auto custom-scrollbar pr-1 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sticky top-0 z-10 bg-white pb-2">
                              <div className="rounded-lg border border-natural-sand p-2 bg-white">
                                <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">ACTUEL</p>
                                <p className="text-[10px] text-natural-stone mt-1 leading-relaxed">
                                  {renderTraceComparisonLine(currentTraceFields, compareTraceFields)}
                                </p>
                              </div>
                              <div className="rounded-lg border border-natural-sand p-2 bg-white">
                                <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">COMPARE</p>
                                <p className="text-[10px] text-natural-stone mt-1 leading-relaxed">
                                  {renderTraceComparisonLine(compareTraceFields, currentTraceFields)}
                                </p>
                              </div>
                            </div>
                            {initialPositionDiffPairs.map((pair) => {
                              const rows = buildMarkerDiffRowsFromParts(pair.diff.left, pair.diff.right);
                              return (
                                <div key={`position-diff-${pair.index}`} className="rounded-xl border border-natural-sand p-3 bg-natural-bg/20">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-natural-stone mb-2">Position initiale #{pair.index}</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="rounded-lg border border-natural-sand p-2 bg-white space-y-1">
                                      {rows.length ? rows.map((row, idx) => (
                                        <p key={`pi-left-${pair.index}-${idx}`} className={cn('text-[11px] leading-relaxed whitespace-pre-wrap px-2 py-1 rounded',
                                          row.leftKind === 'equal' ? 'bg-sky-100 text-slate-800' :
                                          row.leftKind === 'removed' ? 'bg-yellow-200 text-yellow-900 border border-yellow-300' : 'text-natural-stone')}>
                                          {row.leftMissingMarkers.map((id, mkIdx) => renderDiffMarker(id, `pi-left-missing-${pair.index}-${idx}-${mkIdx}`))}
                                          {row.leftOwnMarker ? renderDiffMarker(row.leftOwnMarker, `pi-left-own-${pair.index}-${idx}`) : null}
                                          {row.leftText || (row.leftMissingMarkers.length ? '' : '\u00A0')}
                                        </p>
                                      )) : <p className="text-[11px] italic text-natural-muted">Aucun texte</p>}
                                    </div>
                                    <div className="rounded-lg border border-natural-sand p-2 bg-white space-y-1">
                                      {rows.length ? rows.map((row, idx) => (
                                        <p key={`pi-right-${pair.index}-${idx}`} className={cn('text-[11px] leading-relaxed whitespace-pre-wrap px-2 py-1 rounded',
                                          row.rightKind === 'equal' ? 'bg-sky-100 text-slate-800' :
                                          row.rightKind === 'added' ? 'bg-yellow-200 text-yellow-900 border border-yellow-300' : 'text-natural-stone')}>
                                          {row.rightMissingMarkers.map((id, mkIdx) => renderDiffMarker(id, `pi-right-missing-${pair.index}-${idx}-${mkIdx}`))}
                                          {row.rightOwnMarker ? renderDiffMarker(row.rightOwnMarker, `pi-right-own-${pair.index}-${idx}`) : null}
                                          {row.rightText || (row.rightMissingMarkers.length ? '' : '\u00A0')}
                                        </p>
                                      )) : <p className="text-[11px] italic text-natural-muted">Aucun texte</p>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-natural-muted italic">Diff indisponible: le nombre de positions initiales est different ({currentPositionSegments.length} vs {comparePositionSegments.length}).</p>
                        )}
                      </div>
                      <div className="bg-white rounded-xl border border-natural-sand p-3 space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">Diff - Analyses socratiques</p>
                        {canDiffSocratic ? (
                          <div className="max-h-[360px] overflow-y-auto custom-scrollbar pr-1 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sticky top-0 z-10 bg-white pb-2">
                              <div className="rounded-lg border border-natural-sand p-2 bg-white">
                                <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">ACTUEL</p>
                                <p className="text-[10px] text-natural-stone mt-1 leading-relaxed">
                                  {renderTraceComparisonLine(currentTraceFields, compareTraceFields)}
                                </p>
                              </div>
                              <div className="rounded-lg border border-natural-sand p-2 bg-white">
                                <p className="text-[10px] font-black uppercase tracking-widest text-natural-muted">COMPARE</p>
                                <p className="text-[10px] text-natural-stone mt-1 leading-relaxed">
                                  {renderTraceComparisonLine(compareTraceFields, currentTraceFields)}
                                </p>
                              </div>
                            </div>
                            {socraticDiffPairs.map((pair) => {
                              const rows = buildMarkerDiffRowsFromParts(pair.diff.left, pair.diff.right);
                              return (
                                <div key={`socratic-diff-${pair.index}`} className="rounded-xl border border-natural-sand p-3 bg-natural-bg/20">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-natural-stone mb-2">Analyse socratique #{pair.index}</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="rounded-lg border border-natural-sand p-2 bg-white space-y-1">
                                      {rows.length ? rows.map((row, idx) => (
                                        <p key={`sa-left-${pair.index}-${idx}`} className={cn('text-[11px] leading-relaxed whitespace-pre-wrap px-2 py-1 rounded',
                                          row.leftKind === 'equal' ? 'bg-sky-100 text-slate-800' :
                                          row.leftKind === 'removed' ? 'bg-yellow-200 text-yellow-900 border border-yellow-300' : 'text-natural-stone')}>
                                          {row.leftMissingMarkers.map((id, mkIdx) => renderDiffMarker(id, `sa-left-missing-${pair.index}-${idx}-${mkIdx}`))}
                                          {row.leftOwnMarker ? renderDiffMarker(row.leftOwnMarker, `sa-left-own-${pair.index}-${idx}`) : null}
                                          {row.leftText || (row.leftMissingMarkers.length ? '' : '\u00A0')}
                                        </p>
                                      )) : <p className="text-[11px] italic text-natural-muted">Aucun texte</p>}
                                    </div>
                                    <div className="rounded-lg border border-natural-sand p-2 bg-white space-y-1">
                                      {rows.length ? rows.map((row, idx) => (
                                        <p key={`sa-right-${pair.index}-${idx}`} className={cn('text-[11px] leading-relaxed whitespace-pre-wrap px-2 py-1 rounded',
                                          row.rightKind === 'equal' ? 'bg-sky-100 text-slate-800' :
                                          row.rightKind === 'added' ? 'bg-yellow-200 text-yellow-900 border border-yellow-300' : 'text-natural-stone')}>
                                          {row.rightMissingMarkers.map((id, mkIdx) => renderDiffMarker(id, `sa-right-missing-${pair.index}-${idx}-${mkIdx}`))}
                                          {row.rightOwnMarker ? renderDiffMarker(row.rightOwnMarker, `sa-right-own-${pair.index}-${idx}`) : null}
                                          {row.rightText || (row.rightMissingMarkers.length ? '' : '\u00A0')}
                                        </p>
                                      )) : <p className="text-[11px] italic text-natural-muted">Aucun texte</p>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-natural-muted italic">Diff indisponible: le nombre d&apos;analyses socratiques est different ({currentSocraticSegments.length} vs {compareSocraticSegments.length}).</p>
                        )}
                      </div>
                    </div>
                  </ComparisonErrorBoundary>
                )}
              </div>

              {conversation.deepAnalysis ? (
                <div className="bg-white rounded-[24px] p-6 shadow-sm border border-natural-sand prose prose-sm prose-slate max-h-[400px] overflow-y-auto custom-scrollbar">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {conversation.deepAnalysis}
                  </ReactMarkdown>
                </div>
              ) : (
                <button 
                  onClick={handleDeepAnalysis}
                  disabled={isAnalyzingDeep}
                  className="w-full py-4 bg-natural-heading text-white rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-natural-heading/90 transition-all flex items-center justify-center gap-2"
                >
                  {isAnalyzingDeep ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Lancer l'analyse profonde
                </button>
              )}
            </div>

            <div className="bg-natural-accent rounded-3xl p-6 shadow-xl shadow-natural-accent/20">
               <div className="flex items-center gap-3 text-white mb-3">
                 <HelpCircle className="w-5 h-5" />
                 <span className="text-sm font-bold tracking-tight">Questions Fertiles</span>
               </div>
               <p className="text-xs text-white/80 leading-relaxed mb-6 font-medium italic">
                 Voulez-vous que Socrate approfondisse une contradiction ou un point de pivot détecté ?
               </p>
               <button className="w-full py-3 bg-white text-natural-accent rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-natural-sand transition-all shadow-sm">
                 RÉPONDRE AUX QUESTIONS
               </button>
            </div>
          </div>
        </section>

        <div className="px-8 flex items-center gap-3 text-[9px] text-natural-muted uppercase tracking-[0.3em] font-black opacity-50 justify-center">
          <div className="w-1.5 h-1.5 bg-natural-brown rounded-full animate-pulse"></div>
          Analyseur Actif
        </div>
      </aside>
    </motion.div>
    
    <AnimatePresence>
      {activeSemanticDetail && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md"
          onClick={() => setActiveSemanticDetail(null)}
        >
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="w-full max-w-2xl bg-white rounded-[32px] shadow-2xl p-8 max-h-[85vh] flex flex-col border border-natural-sand"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-natural-accent rounded-xl flex items-center justify-center shadow-lg">
                  {activeSemanticDetail.type === 'vector' ? <Activity className="w-5 h-5 text-white" /> : <BookOpenText className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <h3 className="font-serif text-xl text-natural-heading">
                    {activeSemanticDetail.type === 'vector' ? "Analyse Technique (Vecteur)" : "Interprétation Socratique"}
                  </h3>
                  <p className="text-[10px] font-black text-natural-muted uppercase tracking-[0.2em]">Données Sémantiques du Segment</p>
                </div>
              </div>
              <button onClick={() => setActiveSemanticDetail(null)} className="p-3 hover:bg-natural-sand rounded-2xl transition-all">
                <X className="w-6 h-6 text-natural-muted" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-natural-bg/30 rounded-2xl p-6 border border-natural-sand">
              <p className="text-sm md:text-base text-natural-text leading-relaxed whitespace-pre-wrap font-mono italic">
                {activeSemanticDetail.type === 'vector' 
                  ? (segments?.find(s => s.id === activeSemanticDetail.id)?.semanticVectorDescription || "Vecteur en cours de calcul ou non disponible.") 
                  : (segments?.find(s => s.id === activeSemanticDetail.id)?.semanticInterpretation || "Interprétation non disponible pour ce segment.")
                }
              </p>
            </div>

            <div className="mt-8 pt-6 border-t border-natural-sand flex justify-end">
              <button 
                onClick={() => setActiveSemanticDetail(null)}
                className="px-6 py-3 bg-natural-heading text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-natural-heading/90 transition-all"
              >
                Fermer l'analyse
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {isGraphFullscreen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-natural-bg flex flex-col p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-natural-accent rounded-2xl text-white">
                <Share2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-serif text-3xl text-natural-heading">{conversation.title}</h2>
                <p className="text-[10px] font-black text-natural-muted uppercase tracking-[0.3em]">Graphe Sémantique Plein Écran</p>
                {latestConversationTrace && (
                  <p className="text-[10px] font-semibold text-natural-stone uppercase tracking-wider mt-1">{formatTrace(latestConversationTrace)}</p>
                )}
              </div>
            </div>
            <button 
              onClick={() => setIsGraphFullscreen(false)}
              className="p-4 bg-white rounded-2xl border border-natural-sand text-natural-muted hover:text-red-500 transition-all shadow-sm"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="flex-1 min-h-0 bg-white rounded-[40px] border border-natural-sand shadow-sm overflow-hidden p-2">
            {renderDeferredPanel(
              <KnowledgeGraphView 
                graph={conversation.knowledgeGraph || { nodes: [], edges: [] }} 
                contextCorpus={(segments || []).map((s) => s.originalText || s.content)}
                standalone={true}
              />,
              'min-h-[500px]'
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </>
);
}
