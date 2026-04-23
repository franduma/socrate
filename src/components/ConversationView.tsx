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
  Fingerprint
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDate, cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { Suspense, lazy, useEffect, useState } from 'react';
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

export function ConversationView({ convId, onBack }: ConversationViewProps) {
  const [viewMode, setViewMode] = useState<'flux' | 'carte' | 'graphe'>('flux');
  const [inspectedSegment, setInspectedSegment] = useState<Segment | null>(null);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [isAnalyzingDeep, setIsAnalyzingDeep] = useState(false);
  
  const conversation = useLiveQuery(() => db.conversations.get(convId), [convId]);
  const segments = useLiveQuery(() => db.segments.where('conversationId').equals(convId).sortBy('timestamp'), [convId]);

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
  const formatTrace = (trace?: SegmentationTrace) => {
    if (!trace) return '';
    const collection = trace.semanticCollectionName || 'Aucune collection';
    const vectorMode = trace.vectorEngineMode || vectorEngineMode;
    return `Granularite: ${trace.granularityName} | Collection: ${collection} | Similarite: ${trace.similarityThreshold.toFixed(2)} | Provider: ${trace.provider} | Vecteur: ${vectorMode}`;
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

        <div className="space-y-8">
          {viewMode === 'flux' ? (
            segments?.map((segment, index) => (
              <div key={segment.id} className="group relative">
                <div 
                  onClick={() => setInspectedSegment(segment)}
                  className={cn(
                    "flex gap-6 p-8 rounded-[32px] border border-natural-sand shadow-sm transition-all hover:shadow-md cursor-zoom-in active:scale-[0.99]",
                    segment.role === 'assistant' ? 'bg-white' : 'bg-natural-bg',
                    segment.metadata?.isPivot && 'border-natural-brown border-2'
                  )}
                >
                  <div className={`mt-1 w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                    segment.role === 'assistant' ? 'bg-natural-accent text-white' : 'bg-natural-beige text-natural-muted'
                  }`}>
                    {segment.role === 'assistant' ? <Bot className="w-6 h-6" /> : <User className="w-6 h-6" />}
                  </div>
                  
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em]">
                          {segment.role === 'assistant' ? 'Analyse Socratique' : 'Position Initiale'}
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
                    <div className="text-natural-text leading-relaxed whitespace-pre-wrap text-base md:text-lg font-serif">
                      {segment.originalText || segment.content}
                    </div>
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
                        inspectedSegment.role === 'assistant' ? "bg-natural-accent text-white" : "bg-natural-beige text-natural-muted"
                      )}>
                        {inspectedSegment.role === 'assistant' ? <Bot className="w-8 h-8" /> : <User className="w-8 h-8" />}
                      </div>
                      <div>
                        <h4 className="font-serif text-2xl text-natural-heading">Inspection du segment</h4>
                        <p className="text-[10px] font-bold text-natural-muted uppercase tracking-widest">
                          {inspectedSegment.role === 'assistant' ? 'Socrate' : 'Explorateur'} • ID: {inspectedSegment.id.substring(0, 8)}
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
                      <div className="text-lg leading-relaxed font-serif text-natural-text pl-6 py-2 bg-natural-bg/30 rounded-r-3xl prose prose-sm prose-slate">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {inspectedSegment.originalText || inspectedSegment.content}
                        </ReactMarkdown>
                      </div>
                    </div>

                    <div className="bg-natural-sand/30 p-6 rounded-3xl space-y-2 border border-natural-sand">
                      <div className="text-[11px] font-black text-natural-stone uppercase tracking-widest flex items-center gap-2">
                        <BrainCircuit className="w-3 h-3" />
                        Essence (Analyse IA)
                      </div>
                      <p className="text-sm text-natural-muted italic leading-relaxed">
                        "{inspectedSegment.content}"
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
                      {renderDeferredPanel(<KnowledgeGraphView graph={inspectedSegment.knowledgeGraph} standalone={true} />, 'min-h-[300px]')}
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
