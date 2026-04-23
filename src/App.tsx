import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Plus, 
  FileText, 
  MessageSquare, 
  Settings, 
  ChevronRight, 
  FolderOpen,
  Clipboard,
  BrainCircuit,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  CheckCircle2,
  Quote,
  Send,
  User,
  Bot,
  Download,
  Trash2,
  Key,
  Save,
  ShieldCheck,
  Upload,
  History,
  Sparkles,
  MousePointer2,
  Zap,
  MoreVertical,
  Layers,
  Square,
  X,
  Brain,
  BookOpenText,
  Hourglass,
  StopCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { CustomReaction, ChatMessage, DictionaryEntry } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const ConversationView = lazy(() =>
  import('./components/ConversationView').then((module) => ({ default: module.ConversationView }))
);

const AllSegmentsView = lazy(() =>
  import('./components/AllSegmentsView').then((module) => ({ default: module.AllSegmentsView }))
);

async function loadGeminiService() {
  return import('./services/geminiService');
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'conv' | 'files' | 'search' | 'segments' | 'settings' | 'chat'>('conv');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastCapturedId, setLastCapturedId] = useState<string | null>(null);
  const [isReactionAdminOpen, setIsReactionAdminOpen] = useState(false);
  const [isDictionaryOpen, setIsDictionaryOpen] = useState(false);
  const [dictSearch, setDictSearch] = useState('');
  const [sourceTab, setSourceTab] = useState<'conv' | 'segments'>('conv');
  const [potentialCapture, setPotentialCapture] = useState<{ 
    title: string, 
    segments: any[], 
    analysis: any 
  } | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardTitle, setWizardTitle] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('SOCRATE_CHAT_HISTORY');
    return saved ? JSON.parse(saved) : [];
  });
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  const [currentChatConvId, setCurrentChatConvId] = useState<string | null>(() => {
    return localStorage.getItem('CURRENT_CHAT_CONV_ID');
  });

  useEffect(() => {
    localStorage.setItem('SOCRATE_CHAT_HISTORY', JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    if (currentChatConvId) localStorage.setItem('CURRENT_CHAT_CONV_ID', currentChatConvId);
    else localStorage.removeItem('CURRENT_CHAT_CONV_ID');
  }, [currentChatConvId]);
  
  // Selection / Threading State
  const [selectedText, setSelectedText] = useState('');
  const [selectionMenuPos, setSelectionMenuPos] = useState<{x: number, y: number} | null>(null);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const [customQuestionInput, setCustomQuestionInput] = useState('');
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Settings State
  const [apiKeyOverride, setApiKeyOverride] = useState(localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || '');
  const [manualModel, setManualModel] = useState(localStorage.getItem('GEMINI_MANUAL_MODEL') || '');
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('OPENAI_API_KEY') || '');
  const [claudeKey, setClaudeKey] = useState(localStorage.getItem('CLAUDE_API_KEY') || '');
  const [openRouterKey, setOpenRouterKey] = useState(localStorage.getItem('OPENROUTER_API_KEY') || '');
  const [codexKey, setCodexKey] = useState(localStorage.getItem('CODEX_API_KEY') || '');
  
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'openai' | 'claude' | 'openrouter' | 'codex'>(
    (localStorage.getItem('SELECTED_MODEL') as any) || 'gemini'
  );

  const defaultReactions: CustomReaction[] = [
    { id: '1', label: 'Précise', prompt: 'Peux-tu apporter plus de précisions sur ce point spécifique ?' },
    { id: '2', label: 'Je ne comprends pas', prompt: "Je ne comprends pas bien ce passage, peux-tu l'expliquer différemment ?" },
    { id: '3', label: 'Lien question', prompt: 'Quel est le lien direct entre ce point et ma question initiale ?' },
    { id: '4', label: 'Sources', prompt: 'Quelles sont les sources ou les fondements de cette affirmation ?' },
    { id: '5', label: 'Exemple', prompt: 'Peux-tu me donner un exemple concret pour illustrer ce point ?' }
  ];

  const [reactions, setReactions] = useState<CustomReaction[]>(() => {
    const saved = localStorage.getItem('CUSTOM_REACTIONS');
    return saved ? JSON.parse(saved) : defaultReactions;
  });

  const [dictionary, setDictionary] = useState<DictionaryEntry[]>(() => {
    const saved = localStorage.getItem('SOCRATE_DICTIONARY');
    return saved ? JSON.parse(saved) : [];
  });

  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    try {
      const { testGeminiConnection } = await loadGeminiService();
      const ok = await testGeminiConnection();
      if (ok) {
        alert("✅ Connexion à l'IA réussie ! Socrate est prêt.");
      } else {
        alert("❌ Échec de la connexion. Vérifiez votre clé API ou votre modèle.");
      }
    } catch (e) {
      alert("❌ Erreur de test : " + e);
    } finally {
      setIsTestingConnection(false);
    }
  };
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  const renderDeferredView = (node: React.ReactNode) => (
    <Suspense
      fallback={
        <div className="bg-white rounded-[32px] border border-natural-sand shadow-sm p-8 text-sm text-natural-muted flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement de la vue...
        </div>
      }
    >
      {node}
    </Suspense>
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (selectionMenuPos && !target.closest('.selection-menu') && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        setSelectionMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectionMenuPos]);

  const conversations = useLiveQuery(() => db.conversations.orderBy('updatedAt').reverse().toArray()) || [];
  const files = useLiveQuery(() => db.files.toArray()) || [];
  const segments = useLiveQuery(() => db.segments.toArray()) || [];
  const facettesList = useLiveQuery(() => db.facettes.toArray()) || [];
  const facetCollections = useLiveQuery(() => db.facetCollections.toArray()) || [];

  const [dictTab, setDictTab] = useState<'semantic' | 'facets'>('semantic');
  const [newFacetteName, setNewFacetteName] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedFacetsForCollection, setSelectedFacetsForCollection] = useState<string[]>([]);

  const handleCapture = async () => {
    if (!inputText.trim()) return;

    setIsAnalyzing(true);
    try {
      const { analyzeAndSegmentConversation } = await loadGeminiService();
      const result = await analyzeAndSegmentConversation(inputText);
      setPotentialCapture(result);
      setWizardTitle(result.title);
      setIsWizardOpen(true);
    } catch (error: any) {
      console.error("Capture failed:", error);
      const msg = error?.message || "Erreur inconnue";
      alert(`Erreur lors de l'analyse : ${msg}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const finalizeCapture = async () => {
    if (!potentialCapture) return;

    try {
      if (!potentialCapture.segments || potentialCapture.segments.length === 0) {
        throw new Error("L'analyse n'a produit aucun segment de texte.");
      }

      const isSessionUpdate = activeTab === 'chat' && currentChatConvId;
      const convId = isSessionUpdate ? currentChatConvId! : uuidv4();
      const now = Date.now();

      const convData: any = {
        id: convId,
        title: wizardTitle || "Conversation sans titre",
        updatedAt: now,
        source: activeTab === 'chat' ? 'session' : 'copy-paste',
        segmentsCount: potentialCapture.segments.length,
        semanticAnalysis: {
          summary: potentialCapture.analysis?.summary || "",
          themes: potentialCapture.analysis?.themes || [],
          suggestedTags: potentialCapture.analysis?.suggestedTags || [],
          deviations: potentialCapture.analysis?.deviations || []
        },
        semanticSignature: potentialCapture.analysis?.semanticSignature || uuidv4(),
        knowledgeGraph: potentialCapture.analysis?.knowledgeGraph || { nodes: [], edges: [] }
      };

      if (!isSessionUpdate) {
        convData.createdAt = now;
        await db.conversations.add(convData);
      } else {
        await db.conversations.update(convId, convData);
      }

      // Si c'est une mise à jour, on peut éventuellement supprimer les anciens segments
      // mais l'utilisateur veut du "conservatif". On va faire un put pour écraser par ID si possible
      // ou simplement nettoyer si on re-segmente tout le fil.
      if (isSessionUpdate) {
        await db.segments.where('conversationId').equals(convId).delete();
      }

      let prevId: string | undefined = undefined;
      for (let i = 0; i < potentialCapture.segments.length; i++) {
        const seg = potentialCapture.segments[i];
        const segId = uuidv4();
        await db.segments.add({
          id: segId,
          conversationId: convId,
          content: seg.content || '',
          originalText: seg.originalText || seg.content || '',
          role: seg.role as any || 'user',
          timestamp: now + i,
          semanticSignature: seg.semanticSignature,
          semanticVectorDescription: seg.semanticVectorDescription,
          semanticInterpretation: seg.semanticInterpretation,
          tags: seg.tags || [],
          previousSegmentId: prevId,
          parentLabel: seg.metadata?.reason,
          knowledgeGraph: seg.knowledgeGraph,
          metadata: seg.metadata || {}
        });
        prevId = segId;
      }

      if (activeTab === 'chat') {
        setCurrentChatConvId(convId);
      }

      setInputText('');
      setPotentialCapture(null);
      setIsWizardOpen(false);
      setLastCapturedId(convId);
      setSelectedConvId(convId);
      setActiveTab('conv');
      setTimeout(() => setLastCapturedId(null), 3000);
    } catch (error) {
      alert("Erreur lors de la sauvegarde finale.");
    }
  };

  const handleFileImportToCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    if (file.name.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const result = await mammoth.extractRawText({ arrayBuffer });
        const content = result.value;
        setInputText(prev => prev + (prev ? "\n\n" : "") + content);
        // Sauvegarde dans la bibliothèque
        await db.files.add({
          id: uuidv4(),
          name: file.name,
          type: 'markdown',
          content: content,
          lastModified: Date.now(),
          tags: ['importé', 'docx']
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = async (event) => {
        const content = event.target?.result as string;
        setInputText(prev => prev + (prev ? "\n\n" : "") + content);
        // Sauvegarde dans la bibliothèque
        await db.files.add({
          id: uuidv4(),
          name: file.name,
          type: file.name.endsWith('.pdf') ? 'other' : 'markdown',
          content: content,
          lastModified: Date.now(),
          tags: ['importé']
        });
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleSaveApiKey = () => {
    setIsSavingKey(true);
    
    // Gemini
    if (apiKeyOverride.trim()) localStorage.setItem('GEMINI_API_KEY_OVERRIDE', apiKeyOverride.trim());
    else localStorage.removeItem('GEMINI_API_KEY_OVERRIDE');
    
    if (manualModel.trim()) localStorage.setItem('GEMINI_MANUAL_MODEL', manualModel.trim());
    else localStorage.removeItem('GEMINI_MANUAL_MODEL');
    
    // OpenAI
    if (openaiKey.trim()) localStorage.setItem('OPENAI_API_KEY', openaiKey.trim());
    else localStorage.removeItem('OPENAI_API_KEY');
    
    // Claude
    if (claudeKey.trim()) localStorage.setItem('CLAUDE_API_KEY', claudeKey.trim());
    else localStorage.removeItem('CLAUDE_API_KEY');

    // OpenRouter
    if (openRouterKey.trim()) localStorage.setItem('OPENROUTER_API_KEY', openRouterKey.trim());
    else localStorage.removeItem('OPENROUTER_API_KEY');

    // Codex
    if (codexKey.trim()) localStorage.setItem('CODEX_API_KEY', codexKey.trim());
    else localStorage.removeItem('CODEX_API_KEY');

    localStorage.setItem('SELECTED_MODEL', selectedModel);
    localStorage.setItem('CUSTOM_REACTIONS', JSON.stringify(reactions));

    setTimeout(() => {
      setIsSavingKey(false);
      alert("Configuration sauvegardée.");
    }, 500);
  };

  const handleContextMenu = (e: React.MouseEvent, targetMessageId?: string) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    
    if (text) {
      e.preventDefault();
      setSelectedText(text);
      if (targetMessageId) setActiveParentId(targetMessageId);
      setSelectionMenuPos({ 
        x: e.clientX, 
        y: e.clientY 
      });
    }
  };

  const handleTextSelection = (e: React.MouseEvent, targetMessageId?: string) => {
    // Garder la logique de clic normal pour fermer le menu si nécessaire
    if ((e.target as HTMLElement).closest('.selection-menu')) return;

    const selection = window.getSelection();
    if (!selection || !selection.toString().trim()) {
      setSelectionMenuPos(null);
      setActiveParentId(null);
    }
  };

  const loadConversationIntoChat = async (convId: string) => {
    const segments = await db.segments.where('conversationId').equals(convId).sortBy('timestamp');
    const newChatMsgs: ChatMessage[] = segments.map(s => ({
      id: s.id,
      role: s.role,
      content: s.originalText || s.content,
      parentId: s.previousSegmentId
    }));
    setChatMessages(newChatMsgs);
    setCurrentChatConvId(convId);
    setActiveTab('chat');
  };

  const applyReaction = async (reaction: CustomReaction | string) => {
    if (!selectedText) return;
    let actualLabel = typeof reaction === 'string' ? 'Question' : reaction.label;
    let actualPrompt = typeof reaction === 'string' ? reaction : reaction.prompt;
    if (typeof reaction === 'string' && reaction.trim()) {
      const alreadyExists = reactions.find(r => r.prompt === reaction);
      if (!alreadyExists) {
        const newReaction: CustomReaction = { id: uuidv4(), label: `Q: ${reaction.substring(0, 10)}...`, prompt: reaction };
        const updated = [...reactions, newReaction];
        setReactions(updated);
        localStorage.setItem('CUSTOM_REACTIONS', JSON.stringify(updated));
      }
    }
    setSelectionMenuPos(null);
    setCustomQuestionInput('');
    const contextPrompt = `Concernant ce passage : "${selectedText}"\n\n${actualPrompt}`;
    handleChat(contextPrompt, activeParentId || undefined, actualLabel);
  };

  const handleSaveMessageToDisk = (content: string, role?: string, parentContent?: string) => {
    const words = content.replace(/[^\w\sÀ-ÿ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && w.length < 15).slice(0, 4).join('_');
    const prefix = words ? words.toLowerCase() + '_' : '';
    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().getTime().toString().slice(-6);
    
    let fullContent = content;
    if (parentContent && role === 'assistant') {
      fullContent = `### QUESTION :\n${parentContent}\n\n### RÉPONSE SOCRATE :\n${content}`;
    }

    const blob = new Blob([fullContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}socrate_${dateStr}_${timeStr}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setSelectionMenuPos(null);
  };

  const handleChat = async (overrideInput?: string | React.MouseEvent | React.KeyboardEvent, parentId?: string, parentLabel?: string) => {
    const messageContent = (typeof overrideInput === 'string' ? overrideInput : '') || chatInput;
    if (!messageContent || typeof messageContent !== 'string' || !messageContent.trim() || isChatLoading) return;
    abortControllerRef.current = new AbortController();
    const actualContent = messageContent.trim();
    const userMsgId = uuidv4();
    const newUserMessage: ChatMessage = { id: userMsgId, role: 'user', content: actualContent, parentId: parentId, parentLabel: parentLabel };
    setChatMessages(prev => [...prev, newUserMessage]);
    setChatInput('');
    setIsChatLoading(true);
    try {
      const { chatWithGemini } = await loadGeminiService();
      const modelHistory = chatMessages.map(m => ({ role: m.role, content: m.content }));
      const responsePromise = chatWithGemini(actualContent, modelHistory);
      const response = await responsePromise;
      if (abortControllerRef.current?.signal.aborted) return;
      const assistantMsgId = uuidv4();
      setChatMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: response, parentId: userMsgId }]);
    } catch (error: any) {
      console.error("Chat failed:", error);
      alert("Erreur chat : " + (error.message || "Inconnue"));
    } finally {
      setIsChatLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleInterruptChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsChatLoading(false);
      setChatMessages(prev => [...prev, { id: uuidv4(), role: 'assistant', content: "*[Réponse interrompue par l'utilisateur]*" }]);
    }
  };

  const handleResumeChat = () => {
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) handleChat(lastUserMsg.content, lastUserMsg.parentId || undefined, lastUserMsg.parentLabel);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (data.conversations && data.segments) {
            for (const conv of data.conversations) await db.conversations.put(conv);
            for (const seg of data.segments) await db.segments.put(seg);
            alert(`Importation réussie : ${data.conversations.length} conversations et ${data.segments.length} segments importés.`);
          } else alert("Format de fichier invalide.");
        } catch (err) { alert("Erreur de lecture du fichier JSON."); } finally { setIsImporting(false); e.target.value = ''; }
      };
      reader.readAsText(file);
    } catch (error) { setIsImporting(false); alert("Erreur lors de l'importation."); }
  };

  const handleSegmentChat = async () => {
    if (chatMessages.length === 0) return;
    setIsAnalyzing(true);
    try {
      const fullText = chatMessages.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
      const { analyzeAndSegmentConversation } = await loadGeminiService();
      const result = await analyzeAndSegmentConversation(fullText);
      
      // Update potentialCapture
      setPotentialCapture(result);
      
      // Update or create conversation metadata
      if (currentChatConvId) {
          await db.conversations.update(currentChatConvId, {
              knowledgeGraph: result.analysis.knowledgeGraph,
              semanticSignature: result.analysis.semanticSignature,
              semanticAnalysis: {
                summary: result.analysis.summary,
                themes: result.analysis.themes,
                suggestedTags: result.analysis.suggestedTags,
                deviations: result.analysis.deviations
              }
          });
      }

      // Nouveau format de titre : [Attr1, Attr2] - Socrate Chat - YYMMDD_HHMM
      const attrs = (result.analysis.suggestedTags || []).slice(0, 2).join(', ');
      const now = new Date();
      const datePart = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
      const timePart = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0'); // HHMM
      
      const newTitle = `[${attrs}] - Socrate Chat - ${datePart}_${timePart}`;
      setWizardTitle(newTitle);
      setIsWizardOpen(true);
    } catch (error: any) {
      console.error(error);
      alert("La segmentation du chat a échoué : " + (error.message || "Erreur inconnue"));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportAndEmpty = async () => {
    setIsExporting(true);
    try {
      const allConversations = await db.conversations.toArray();
      const allSegments = await db.segments.toArray();
      const exportData = { exportedAt: new Date().toISOString(), conversations: allConversations, segments: allSegments };
      const dataStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `socrate_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 100);
      await db.conversations.clear();
      await db.segments.clear();
      alert("Données exportées et base vidée avec succès.");
      setSelectedConvId(null);
      setActiveTab('conv');
      setShowExportConfirm(false);
    } catch (error: any) { alert("Erreur lors de l'export: " + (error.message || "Erreur inconnue")); } finally { setIsExporting(false); }
  };

  return (
    <div className="flex h-screen bg-natural-bg text-natural-text font-sans selection:bg-natural-peach selection:text-natural-brown overflow-hidden uppercase-tracking">
      {/* Sidebar Navigation */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="relative bg-white/50 backdrop-blur-md border-r border-natural-border flex flex-col"
      >
        <div className="p-6 border-b border-natural-sand flex items-center justify-between">
          <div className="flex items-center gap-3 font-serif italic text-xl text-natural-heading">
            <div className="w-8 h-8 bg-natural-accent rounded-lg flex items-center justify-center shrink-0">
              <BrainCircuit className="w-5 h-5 text-white" />
            </div>
            <span>Socrate</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="p-1 hover:bg-natural-sand rounded text-natural-muted transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <div className="px-4 mb-6">
            <div className="flex items-center gap-2 p-3 bg-natural-sand rounded-2xl group focus-within:ring-2 focus-within:ring-natural-accent/10 transition-all border border-transparent focus-within:border-natural-beige">
              <Search className="w-4 h-4 text-natural-muted font-bold" />
              <input 
                placeholder="Rechercher..." 
                className="bg-transparent border-none text-sm outline-none w-full placeholder:text-natural-stone"
              />
            </div>
          </div>

          <nav className="px-3 space-y-1.5">
            <NavItem icon={<MessageSquare className="w-4 h-4" />} label="Conversations" active={activeTab === 'conv'} onClick={() => { setActiveTab('conv'); setSelectedConvId(null); }} count={conversations.length} />
            <NavItem icon={<Quote className="w-4 h-4" />} label="Segments" active={activeTab === 'segments'} onClick={() => { setActiveTab('segments'); setSelectedConvId(null); }} />
            <NavItem icon={<FileText className="w-4 h-4" />} label="Fichiers" active={activeTab === 'files'} onClick={() => { setActiveTab('files'); setSelectedConvId(null); }} count={files.length} />
            <NavItem icon={<Settings className="w-4 h-4" />} label="Paramètres" active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); setSelectedConvId(null); }} />
            <NavItem icon={<MessageSquare className="w-4 h-4" />} label="Chat Socrate" active={activeTab === 'chat'} onClick={() => { setActiveTab('chat'); setSelectedConvId(null); }} />
          </nav>

          <div className="mt-10 px-6 border-t border-natural-sand pt-8">
            <p className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em] mb-4">ARCHIVES & SEGMENTS</p>
            <ul className="space-y-4">
              {conversations.length === 0 && <li className="text-xs text-natural-muted italic px-2">Aucune archive</li>}
              {conversations.slice(0, 5).map(c => {
                const convSegments = segments.filter(s => s.conversationId === c.id).slice(0, 2);
                return (
                  <li key={c.id} className="space-y-2">
                    <div 
                      onClick={() => { setSelectedConvId(c.id); setActiveTab('conv'); }}
                      onDoubleClick={() => loadConversationIntoChat(c.id)}
                      className={cn("group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-sm truncate transition-all", selectedConvId === c.id ? "bg-natural-sand text-natural-heading font-medium" : "hover:bg-natural-sand/50 text-natural-muted")}
                    >
                      <ChevronRight className={cn("w-3 h-3 transition-opacity", selectedConvId === c.id ? "opacity-100 text-natural-accent" : "opacity-0 group-hover:opacity-100 text-natural-stone")} />
                      <span className="truncate">{c.title}</span>
                    </div>
                    {convSegments.length > 0 && (
                      <div className="ml-6 space-y-1.5 border-l-2 border-natural-sand pl-3">
                        {convSegments.map(s => (
                          <div key={s.id} onClick={() => { setSelectedConvId(c.id); setActiveTab('conv'); }} className="text-[10px] text-natural-stone hover:text-natural-accent cursor-pointer truncate max-w-full italic font-serif leading-tight">
                            "{s.content.substring(0, 45)}..."
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="p-6 border-t border-natural-sand">
          <button onClick={() => setActiveTab('settings')} className={cn("flex items-center gap-3 text-sm transition-colors w-full font-medium p-3 rounded-xl", activeTab === 'settings' ? "bg-natural-sand text-natural-accent" : "text-natural-muted hover:text-natural-heading hover:bg-natural-sand/30")}>
            <Settings className="w-4 h-4" />
            <span>Configuration</span>
          </button>
        </div>
      </motion.aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-natural-bg">
        <header className="h-20 border-b border-natural-border flex items-center justify-between px-10 bg-white/30 backdrop-blur-sm sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="hover:bg-natural-sand p-2 rounded-xl transition-all text-natural-muted"
              >
                <PanelLeftOpen className="w-5 h-5" />
              </button>
            )}
            <h2 className="font-serif text-2xl text-natural-heading">Espace de travail</h2>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex gap-2 text-[10px] font-bold uppercase tracking-widest hidden md:flex">
               <span className="px-3 py-1 bg-natural-sand rounded-full text-natural-accent">Socrate AI</span>
             </div>
             <button 
              onClick={() => {
                setSelectedConvId(null);
                setActiveTab('conv');
              }}
              className="bg-natural-accent hover:bg-natural-accent/90 text-white px-6 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-natural-accent/10 group"
             >
              <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
              Nouveau segment
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 px-6 md:px-10 scroll-smooth shadow-inner bg-natural-bg">
           <AnimatePresence mode="wait">
            {activeTab === 'settings' ? (
                <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl mx-auto space-y-8">
                  <header className="bg-white p-10 rounded-[32px] border border-natural-sand shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-natural-accent rounded-2xl flex items-center justify-center"><Settings className="w-6 h-6 text-white" /></div>
                      <div>
                        <h1 className="font-serif text-3xl text-natural-heading">Paramètres & Maintenance</h1>
                        <p className="text-natural-muted text-xs uppercase tracking-widest font-bold">Gestion des données et du système</p>
                      </div>
                    </div>
                  </header>

                  <div className="grid grid-cols-1 gap-8">
                    {/* Model Selection */}
                    <div className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm space-y-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-natural-sand rounded-xl text-natural-accent"><Layers className="w-5 h-5" /></div>
                        <h3 className="font-serif text-xl text-natural-heading">Sélecteur de puissance cognitive</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {(['gemini', 'openai', 'claude', 'openrouter', 'codex'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setSelectedModel(m)}
                            className={cn(
                              "flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all group",
                              selectedModel === m 
                                ? "border-natural-accent bg-natural-sand/30" 
                                : "border-natural-sand hover:border-natural-beige"
                            )}
                          >
                            <div className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                              selectedModel === m ? "bg-natural-accent text-white" : "bg-natural-sand text-natural-muted group-hover:bg-natural-beige"
                            )}>
                              {m === 'gemini' ? <BrainCircuit className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest">{m}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm space-y-6">
                        <div className="flex items-center gap-3"><div className="p-2 bg-natural-sand rounded-xl text-natural-accent"><Key className="w-5 h-5" /></div><h3 className="font-serif text-xl text-natural-heading">Connexion API</h3></div>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-natural-muted uppercase tracking-widest pl-2">Google Gemini</label>
                            <div className="flex gap-2">
                              <input type="password" value={apiKeyOverride} onChange={(e) => setApiKeyOverride(e.target.value)} placeholder="Clé API Gemini..." className="flex-1 p-4 bg-natural-bg rounded-2xl border border-natural-sand focus:border-natural-accent/30 outline-none transition-all text-sm" />
                              <select 
                                value={manualModel} 
                                onChange={(e) => setManualModel(e.target.value)}
                                className="w-1/3 p-4 bg-natural-bg rounded-2xl border border-natural-sand focus:border-natural-accent/30 outline-none transition-all text-[10px] font-bold uppercase"
                              >
                                <option value="">Auto-Rotate</option>
                                <option value="gemini-1.5-flash">1.5 Flash</option>
                                <option value="gemini-1.5-pro">1.5 Pro</option>
                                <option value="gemini-2.0-flash-exp">2.0 Flash (Exp)</option>
                                <option value="gemini-pro">Pro (v1)</option>
                              </select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-natural-muted uppercase tracking-widest pl-2">Anthropic (Claude)</label>
                            <input type="password" value={claudeKey} onChange={(e) => setClaudeKey(e.target.value)} placeholder="Clé API Claude..." className="w-full p-4 bg-natural-bg rounded-2xl border border-natural-sand focus:border-natural-accent/30 outline-none transition-all text-sm" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-natural-muted uppercase tracking-widest pl-2">OpenRouter</label>
                            <input type="password" value={openRouterKey} onChange={(e) => setOpenRouterKey(e.target.value)} placeholder="Clé API OpenRouter..." className="w-full p-4 bg-natural-bg rounded-2xl border border-natural-sand focus:border-natural-accent/30 outline-none transition-all text-sm" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-natural-muted uppercase tracking-widest pl-2">Codex / Custom</label>
                            <input type="password" value={codexKey} onChange={(e) => setCodexKey(e.target.value)} placeholder="Clé API Codex..." className="w-full p-4 bg-natural-bg rounded-2xl border border-natural-sand focus:border-natural-accent/30 outline-none transition-all text-sm" />
                          </div>
                          <div className="flex flex-col md:flex-row gap-2">
                             <button onClick={handleSaveApiKey} className="flex-1 py-4 bg-natural-accent text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-natural-accent/90 transition-all shadow-lg shadow-natural-accent/10">{isSavingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Enregistrer</button>
                             <button onClick={handleTestConnection} className="flex-1 py-4 bg-natural-beige text-natural-accent rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-natural-beige/80 transition-all border border-natural-accent/20">{isTestingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}Tester la connexion</button>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm space-y-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-natural-sand rounded-xl text-natural-accent">
                            <MousePointer2 className="w-5 h-5" />
                          </div>
                          <h3 className="font-serif text-xl text-natural-heading">Maïeutique Contextuelle</h3>
                        </div>
                        <p className="text-sm text-natural-muted leading-relaxed italic">
                          Définissez vos questions socratiques pré-enregistrées pour le menu contextuel.
                        </p>
                        <button 
                          onClick={() => setIsReactionAdminOpen(true)}
                          className="w-full py-4 bg-natural-heading text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-natural-heading/90 transition-all flex items-center justify-center gap-2"
                        >
                          <Settings className="w-4 h-4" />
                          Gérer les questions types
                        </button>
                      </div>

                      {/* Dictionary Config */}
                      <div className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm space-y-6 border-l-4 border-l-natural-accent">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-natural-sand rounded-xl text-natural-accent">
                            <BookOpenText className="w-5 h-5" />
                          </div>
                          <h3 className="font-serif text-xl text-natural-heading">Dictionnaire d'Attributs</h3>
                        </div>
                        <p className="text-sm text-natural-muted leading-relaxed italic">
                          Glossaire des concepts et de leurs attributs pour l'analyse structurelle automatique.
                        </p>
                        <button 
                          onClick={() => setIsDictionaryOpen(true)}
                          className="w-full py-4 bg-natural-accent text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-natural-accent/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-natural-accent/10"
                        >
                          <BookOpenText className="w-4 h-4" />
                          Accéder au Dictionnaire
                        </button>
                      </div>

                      {/* Maintenance Config */}
                      <div className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm space-y-6 md:col-span-2">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-natural-peach/30 rounded-xl text-natural-brown"><Download className="w-5 h-5" /></div>
                          <h3 className="font-serif text-xl text-natural-heading">Nettoyage & Maintenance</h3>
                        </div>
                        <p className="text-sm text-natural-muted italic">Sauvegardez vos données localement avant de vider la base.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="w-full py-4 bg-natural-sand text-natural-heading rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-natural-beige transition-all cursor-pointer border border-natural-sand group">
                            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-natural-accent" />}
                            Importer une archive (.json)
                            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                          </label>
                          <button onClick={() => setShowExportConfirm(true)} className="w-full py-4 bg-natural-heading text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-natural-heading/90 transition-all shadow-md shadow-natural-heading/10">
                            <Download className="w-4 h-4" />
                            Exporter & Vider la mémoire
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : activeTab === 'chat' ? (
                <motion.div key="chat" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl mx-auto flex flex-col h-[75vh]">
                  <div className="bg-white p-4 rounded-t-[32px] border-x border-t border-natural-sand shadow-sm flex items-center justify-between px-8">
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-4 h-4 text-natural-accent" />
                      <h2 className="font-serif text-lg text-natural-heading">Dialogue Actif</h2>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          setChatMessages([]);
                          setChatInput('');
                          localStorage.removeItem('SOCRATE_CHAT_HISTORY');
                        }}
                        className="p-2 hover:bg-red-50 text-natural-muted hover:text-red-500 rounded-xl transition-all"
                        title="Effacer le dialogue"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={handleSegmentChat}
                        disabled={isAnalyzing || chatMessages.length === 0}
                        className="px-4 py-2 bg-natural-sand hover:bg-natural-peach rounded-xl text-[10px] font-black uppercase tracking-widest text-natural-accent transition-all flex items-center gap-2 border border-natural-border shadow-sm disabled:opacity-30"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        Segmenter ce dialogue
                      </button>
                    </div>
                  </div>
                  <div ref={chatContainerRef} onMouseUp={handleTextSelection} onContextMenu={(e) => handleContextMenu(e)} className="flex-1 bg-white border-x border-natural-sand overflow-y-auto p-8 space-y-6 relative">
                    {selectionMenuPos && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => e.stopPropagation()}
                        className="fixed z-[100] bg-natural-heading text-white p-1 rounded-xl shadow-2xl flex flex-col gap-0.5 min-w-[200px] border border-white/10 selection-menu"
                        style={{ left: selectionMenuPos.x, top: selectionMenuPos.y, transform: 'translateX(-50%) translateY(-100%)' }}
                      >
                        <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between">
                          <span className="text-[8px] font-black uppercase tracking-widest opacity-40">Maïeutique Contextuelle</span>
                          <MoreVertical className="w-2.5 h-2.5 opacity-40" />
                        </div>
                        <div className="max-h-[250px] overflow-y-auto custom-scrollbar">
                           <button 
                            onClick={() => handleSaveMessageToDisk(selectedText)}
                            className="w-full px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-natural-accent hover:bg-white/10 transition-colors flex items-center justify-between group border-b border-white/10"
                          >
                            <span>Sauver la sélection</span>
                            <Download className="w-3 h-3" />
                          </button>
                          {reactions.map((r) => (
                            <button 
                              key={r.id}
                              onClick={() => applyReaction(r)}
                              className="w-full px-3 py-2 text-left text-[10px] font-bold hover:bg-white/10 transition-colors flex items-center justify-between group"
                            >
                              <span>{r.label}</span>
                              <Zap className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-natural-accent" />
                            </button>
                          ))}
                        </div>
                        <div className="p-2 border-t border-white/10 bg-white/5 space-y-2">
                           <input 
                             value={customQuestionInput}
                             onChange={(e) => setCustomQuestionInput(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && customQuestionInput.trim() && applyReaction(customQuestionInput)}
                             placeholder="Question personnalisée..."
                             className="w-full bg-natural-heading border border-white/20 rounded-lg p-2 text-[10px] outline-none focus:border-natural-accent transition-all placeholder:opacity-50"
                           />
                           <button 
                             onClick={() => customQuestionInput.trim() && applyReaction(customQuestionInput)}
                             disabled={!customQuestionInput.trim()}
                             className="w-full py-1.5 bg-natural-accent rounded-lg text-[8px] font-black uppercase tracking-widest disabled:opacity-30"
                           >
                             Poser la question
                           </button>
                        </div>
                      </motion.div>
                    )}
                    {chatMessages.length === 0 && <div className="h-full flex flex-col items-center justify-center opacity-30 text-natural-muted"><p className="font-serif italic text-xl text-center">Débutez votre exploration cognitive...</p></div>}
                    {chatMessages.map((m, i) => {
                      const parentMsg = m.parentId ? chatMessages.find(pm => pm.id === m.parentId) : null;
                      return (
                        <div key={i} className={cn(
                          "flex flex-col gap-8 group/msg mb-16 transition-all",
                          m.role === 'user' ? "ml-auto max-w-[85%] items-end" : "mr-auto max-w-[85%] pl-8 md:pl-16 relative"
                        )}>
                          {m.role === 'assistant' && (
                            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-natural-accent/15 rounded-full" />
                          )}
                          <div className={cn("flex gap-8", m.role === 'user' ? "flex-row-reverse" : "")}>
                            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg transition-transform hover:scale-110", m.role === 'user' ? "bg-natural-sand text-natural-stone" : "bg-natural-accent text-white")}>
                              {m.role === 'user' ? <User className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
                            </div>
                            <div className="flex flex-col gap-3 max-w-full">
                              <div 
                                onContextMenu={(e) => handleContextMenu(e, m.id)}
                                className={cn(
                                  "p-8 rounded-[40px] text-lg leading-relaxed relative shadow-sm border border-natural-sand transition-all hover:shadow-md", 
                                  m.role === 'user' 
                                    ? "bg-natural-sand/20 text-natural-heading rounded-tr-none px-10 py-8 leading-relaxed shadow-sm min-w-[200px]" 
                                    : "bg-white text-natural-text rounded-tl-none font-serif prose prose-lg prose-slate max-w-none prose-p:my-10 prose-headings:mb-14 prose-li:my-6 prose-p:leading-[2.2] prose-p:text-justify prose-p:indent-12 px-12 py-10"
                                )}
                              >
                                {m.role === 'assistant' ? (
                                  <div className="space-y-4">
                                     <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                  </div>
                                ) : (
                                  <div className="whitespace-pre-wrap">{m.content}</div>
                                )}
                              </div>
                              {m.role === 'assistant' && (
                                <div className="flex px-6 justify-end">
                                  <button 
                                    onClick={() => handleSaveMessageToDisk(m.content, m.role, parentMsg?.content)}
                                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] text-natural-stone hover:text-natural-accent transition-colors py-2.5 bg-white px-4 rounded-full border border-natural-sand shadow-sm hover:translate-y-[-2px]"
                                    title="Sauvegarder la réponse et sa question"
                                  >
                                    <Download className="w-4 h-4" />
                                    <span className="opacity-0 group-hover/msg:opacity-100 transition-all duration-300">Sauver Q&A</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {isChatLoading && (
                      <div className="flex flex-col gap-4 mr-auto max-w-[90%] group/loading">
                        <div className="flex gap-4 items-center animate-pulse">
                          <div className="w-8 h-8 rounded-lg bg-natural-accent/20 flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4 text-natural-accent opacity-50" />
                          </div>
                          <div className="flex items-center gap-2 bg-natural-bg border border-natural-sand p-4 rounded-3xl rounded-tl-none text-natural-stone italic text-xs shadow-sm">
                            <Hourglass className="w-3.5 h-3.5 animate-spin text-natural-accent" />
                            <span>Socrate réfléchit...</span>
                          </div>
                        </div>
                        <button 
                          onClick={handleInterruptChat}
                          className="ml-12 px-4 py-2 bg-red-50 text-red-500 border border-red-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center gap-2 w-fit"
                        >
                          <Square className="w-3 h-3 fill-current" />
                          Interrompre
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="bg-white p-6 rounded-b-[32px] border-x border-b border-natural-sand shadow-sm">
                    <div className="flex items-center gap-4 bg-natural-bg p-2 pl-6 rounded-2xl border border-natural-sand focus-within:ring-2 focus-within:ring-natural-accent/10 transition-all">
                      <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleChat()} placeholder="Interrogez Socrate..." className="bg-transparent border-none outline-none flex-1 text-sm placeholder:text-natural-stone py-3" />
                      <button onClick={handleChat} disabled={!chatInput.trim() || isChatLoading} className="bg-natural-accent text-white p-3 rounded-xl disabled:opacity-30 transition-all"><Send className="w-4 h-4" /></button>
                    </div>
                  </div>
                </motion.div>
            ) : activeTab === 'files' ? (
                <motion.div key="files" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} className="max-w-6xl mx-auto space-y-10">
                  <header className="bg-white p-12 rounded-[40px] border border-natural-sand shadow-sm">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-natural-accent rounded-[24px] flex items-center justify-center shadow-xl shadow-natural-accent/20"><FileText className="w-8 h-8 text-white" /></div>
                      <div>
                        <h1 className="font-serif text-4xl text-natural-heading mb-2">Bibliothèque de Fichiers</h1>
                        <p className="text-natural-muted text-xs uppercase tracking-[0.3em] font-black opacity-60">Matériau brut & Transcriptions</p>
                      </div>
                    </div>
                    <button 
                      onClick={async () => {
                        if (confirm("Vider définitivement TOUTE la bibliothèque (Fichiers, Conversations & Segments) ?")) {
                          await db.conversations.clear();
                          await db.segments.clear();
                          await db.files.clear();
                          alert("Bibliothèque vidée.");
                          setSelectedConvId(null);
                          setActiveTab('conv');
                        }
                      }}
                      className="px-6 py-3 bg-red-50 text-red-500 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all border border-red-100 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Vider la bibliothèque
                    </button>
                  </header>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {files.map(f => (
                      <div key={f.id} className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm hover:shadow-xl hover:translate-y-[-4px] transition-all cursor-pointer group relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="w-10 h-10 bg-natural-sand/50 rounded-full flex items-center justify-center text-natural-accent">
                            <ChevronRight className="w-5 h-5" />
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 bg-natural-bg rounded-2xl flex items-center justify-center text-natural-muted group-hover:bg-natural-accent/10 group-hover:text-natural-accent transition-colors"><FileText className="w-6 h-6" /></div>
                          <h4 className="font-serif text-xl text-natural-heading truncate flex-1 leading-tight">{f.name}</h4>
                        </div>
                        <div className="space-y-6">
                          <p className="text-sm text-natural-muted line-clamp-4 italic leading-relaxed opacity-80">
                            {f.content.substring(0, 200)}...
                          </p>
                          <div className="flex flex-wrap gap-2 pt-4 border-t border-natural-sand/50">
                            {f.tags.map(t => <span key={t} className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-natural-sand/50 rounded-full text-natural-muted">{t}</span>)}
                          </div>
                        </div>
                      </div>
                    ))}
                    {files.length === 0 && (
                      <div className="md:col-span-3 py-32 text-center bg-white/40 rounded-[48px] border-2 border-dashed border-natural-sand">
                        <div className="w-20 h-20 bg-natural-sand/50 rounded-full flex items-center justify-center mx-auto mb-6 text-natural-muted">
                          <FileText className="w-10 h-10" />
                        </div>
                        <p className="font-serif italic text-2xl text-natural-muted">Votre bibliothèque est vide.</p>
                        <p className="text-xs uppercase tracking-widest font-black text-natural-stone mt-2">Importez des documents depuis la capture rapide</p>
                      </div>
                    )}
                  </div>
                </motion.div>
            ) : activeTab === 'segments' && !selectedConvId ? (
              <motion.div key="segments-view" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} className="max-w-4xl mx-auto w-full">
                {renderDeferredView(<AllSegmentsView onSelectConversation={(convId) => { setSelectedConvId(convId); setSourceTab('segments'); }} />)}
              </motion.div>
            ) : !selectedConvId ? (
              <motion.div key="workspace-home" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} className="max-w-4xl mx-auto w-full">
                <section className="bg-white p-10 rounded-[32px] border border-natural-sand shadow-sm flex flex-col transition-all hover:shadow-md">
                    <h1 className="font-serif text-3xl text-natural-heading mb-6">Capture rapide</h1>
                    <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Collez votre échange ou importez un fichier..." className="w-full min-h-[350px] p-6 bg-natural-bg rounded-[24px] border border-natural-sand focus:border-natural-accent/30 focus:bg-white outline-none transition-all text-natural-text text-base leading-relaxed placeholder:text-natural-stone resize-none font-sans" />
                    <div className="mt-8 flex justify-between items-center">
                      <div className="flex gap-4">
                        <label className="px-6 py-4 bg-white border border-natural-sand text-natural-muted rounded-2xl font-bold text-sm hover:private-bg shadow-sm transition-all flex items-center gap-2 cursor-pointer active:scale-[0.98]">
                          <FolderOpen className="w-5 h-5 text-natural-accent" />
                          Inclure un fichier
                          <input type="file" accept=".txt,.md,.doc,.docx,.pdf,.odt" onChange={handleFileImportToCapture} className="hidden" />
                        </label>
                      </div>
                      <div className="flex flex-col items-center gap-4">
                        <button onClick={handleCapture} disabled={isAnalyzing || !inputText.trim()} className={cn("px-8 py-4 bg-natural-accent text-white rounded-2xl font-bold tracking-wide hover:bg-natural-accent/90 transition-all shadow-lg flex items-center gap-3", isAnalyzing || !inputText.trim() ? "bg-natural-sand text-natural-stone cursor-not-allowed shadow-none" : "shadow-natural-accent/20")}>
                          {isAnalyzing ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Analyse sémantique en cours...
                            </>
                          ) : "Analyser & Segmenter"}
                        </button>
                        {isAnalyzing && (
                          <p className="text-[10px] font-bold text-natural-muted uppercase tracking-[0.2em] animate-pulse">
                            Socrate déconstruit la pensée (180s max)...
                          </p>
                        )}
                      </div>
                    </div>
                </section>
              </motion.div>
            ) : (
              renderDeferredView(<ConversationView convId={selectedConvId} onBack={() => { setSelectedConvId(null); setActiveTab(sourceTab); }} />)
            )}
           </AnimatePresence>
        </div>

        <AnimatePresence>
          {isWizardOpen && potentialCapture && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[250] bg-natural-heading/60 backdrop-blur-md flex items-center justify-center p-8">
              <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} className="bg-white max-w-2xl w-full rounded-[48px] shadow-2xl p-12 border border-white/20">
                <h2 className="font-serif text-4xl text-natural-heading mb-10">Validation Socratique</h2>
                <div className="space-y-8">
                  <input value={wizardTitle} onChange={(e) => setWizardTitle(e.target.value)} className="w-full p-6 bg-natural-bg rounded-2xl border-2 border-natural-sand focus:border-natural-accent/50 outline-none transition-all font-serif text-2xl text-natural-heading" />
                  <div className="flex gap-4 pt-4"><button onClick={finalizeCapture} className="flex-1 py-5 bg-natural-accent text-white rounded-2xl font-bold text-sm shadow-xl shadow-natural-accent/20 hover:bg-natural-accent/90 transition-all flex items-center justify-center gap-3"><Save className="w-5 h-5" />Confirmer</button><button onClick={() => setIsWizardOpen(false)} className="px-8 py-5 bg-natural-sand text-natural-muted rounded-2xl font-bold text-sm hover:bg-natural-peach transition-all">Annuler</button></div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {showExportConfirm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[250] bg-natural-heading/60 backdrop-blur-md flex items-center justify-center p-8">
              <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} className="bg-white max-w-sm w-full rounded-[32px] shadow-2xl p-10 border border-white/20 text-center">
                <div className="w-16 h-16 bg-natural-peach rounded-full flex items-center justify-center mx-auto mb-6 text-natural-brown">
                  <Download className="w-8 h-8" />
                </div>
                <h2 className="font-serif text-2xl text-natural-heading mb-4">Exporter & Vider ?</h2>
                <p className="text-natural-muted text-sm mb-8 leading-relaxed">Cette action va exporter toutes vos conversations en JSON et vider la base de données locale.</p>
                <div className="flex flex-col gap-3">
                  <button onClick={exportAndEmpty} disabled={isExporting} className="w-full py-4 bg-natural-accent text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2">
                    {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Confirmer l'exportation
                  </button>
                  <button onClick={() => setShowExportConfirm(false)} className="w-full py-4 bg-natural-sand text-natural-heading rounded-2xl font-bold text-sm">Annuler</button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {isReactionAdminOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[250] bg-natural-heading/60 backdrop-blur-md flex items-center justify-center p-8">
              <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} className="bg-white max-w-3xl w-full max-h-[80vh] rounded-[32px] shadow-2xl flex flex-col border border-white/20 overflow-hidden">
                <div className="p-8 border-b border-natural-sand flex items-center justify-between">
                  <h2 className="font-serif text-2xl text-natural-heading">Gestion des Réactions</h2>
                  <button onClick={() => setIsReactionAdminOpen(false)} className="p-2 hover:bg-natural-sand rounded-xl transition-all"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-8 space-y-4">
                  {reactions.map((r, i) => (
                    <div key={r.id} className="p-6 bg-natural-bg rounded-2xl border border-natural-sand flex gap-4 items-start group">
                      <div className="flex-1 space-y-4">
                        <div className="space-y-1">
                          <label className="text-[8px] font-black uppercase text-natural-muted tracking-widest">Libellé</label>
                          <input 
                            value={r.label} 
                            onChange={(e) => {
                              const updated = [...reactions];
                              updated[i].label = e.target.value;
                              setReactions(updated);
                            }}
                            className="w-full bg-white p-3 rounded-xl border border-natural-sand text-sm font-bold outline-none focus:border-natural-accent"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black uppercase text-natural-muted tracking-widest">Prompt Maïeutique</label>
                          <textarea 
                            value={r.prompt} 
                            onChange={(e) => {
                              const updated = [...reactions];
                              updated[i].prompt = e.target.value;
                              setReactions(updated);
                            }}
                            className="w-full bg-white p-3 rounded-xl border border-natural-sand text-xs leading-relaxed outline-none focus:border-natural-accent min-h-[80px]"
                          />
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          const updated = reactions.filter(re => re.id !== r.id);
                          setReactions(updated);
                        }}
                        className="p-2 text-natural-stone hover:text-red-500 transition-colors pt-8"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => {
                      const newR: CustomReaction = { id: uuidv4(), label: 'Nouvelle Question', prompt: 'Saisissez votre prompt ici...' };
                      setReactions([...reactions, newR]);
                    }}
                    className="w-full py-4 border-2 border-dashed border-natural-sand rounded-2xl text-natural-muted hover:border-natural-accent hover:text-natural-accent transition-all flex items-center justify-center gap-2 font-bold text-sm"
                  >
                    <Plus className="w-4 h-4" /> Ajouter une réaction
                  </button>
                </div>
                <div className="p-8 border-t border-natural-sand bg-natural-bg/30">
                  <button 
                    onClick={() => {
                      localStorage.setItem('CUSTOM_REACTIONS', JSON.stringify(reactions));
                      setIsReactionAdminOpen(false);
                      alert("Réactions sauvegardées.");
                    }} 
                    className="w-full py-4 bg-natural-accent text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-natural-accent/20"
                  >
                    <Save className="w-4 h-4" /> Sauvegarder la configuration
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {isDictionaryOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[250] bg-natural-heading/60 backdrop-blur-md flex items-center justify-center p-8">
              <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} className="bg-white max-w-4xl w-full max-h-[85vh] rounded-[32px] shadow-2xl flex flex-col border border-white/20 overflow-hidden">
                <div className="p-8 border-b border-natural-sand flex items-center justify-between bg-natural-bg/30">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-natural-accent rounded-2xl flex items-center justify-center shadow-lg"><BookOpenText className="w-6 h-6 text-white" /></div>
                    <div>
                      <h2 className="font-serif text-2xl text-natural-heading">Référentiel Cognitif</h2>
                      <div className="flex gap-4 mt-2">
                        <button 
                          onClick={() => setDictTab('semantic')}
                          className={cn(
                            "text-[10px] font-black uppercase tracking-widest transition-all pb-1 border-b-2",
                            dictTab === 'semantic' ? "border-natural-accent text-natural-accent" : "border-transparent text-natural-muted hover:text-natural-heading"
                          )}
                        >
                          Dictionnaire Sémantique
                        </button>
                        <button 
                          onClick={() => setDictTab('facets')}
                          className={cn(
                            "text-[10px] font-black uppercase tracking-widest transition-all pb-1 border-b-2",
                            dictTab === 'facets' ? "border-natural-accent text-natural-accent" : "border-transparent text-natural-muted hover:text-natural-heading"
                          )}
                        >
                          Référentiel des Facettes
                        </button>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setIsDictionaryOpen(false)} className="p-2 hover:bg-natural-sand rounded-xl transition-all"><X className="w-5 h-5 text-natural-stone" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-10 space-y-6">
                  {dictTab === 'semantic' ? (
                    <>
                      <div className="bg-natural-sand/50 p-6 rounded-2xl border border-natural-sand mb-6">
                        <div className="flex items-center gap-4">
                          <Search className="w-5 h-5 text-natural-muted" />
                          <input 
                            placeholder="Rechercher un concept ou une traduction (recherche bidirectionnelle)..."
                            className="bg-transparent border-none outline-none w-full text-sm font-medium"
                            onChange={(e) => setDictSearch(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-8 mb-4 px-4 text-[10px] font-black text-natural-muted uppercase tracking-[0.2em]">
                        <span>Original (Concept)</span>
                        <span>Traduction (Attribut)</span>
                      </div>
                      <div className="space-y-4">
                        {dictionary
                          .filter(entry => 
                            entry.original.toLowerCase().includes(dictSearch.toLowerCase()) || 
                            entry.translation.toLowerCase().includes(dictSearch.toLowerCase())
                          )
                          .map((entry, i) => (
                          <div key={entry.id} className="grid grid-cols-2 gap-6 p-6 bg-natural-bg rounded-2xl border border-natural-sand group relative hover:border-natural-accent/30 transition-all items-center">
                            <input 
                              value={entry.original} 
                              placeholder="Ex: Cogito"
                              onChange={(e) => {
                                const updated = [...dictionary];
                                updated[i].original = e.target.value;
                                setDictionary(updated);
                              }}
                              className="bg-white p-4 rounded-xl border border-natural-sand text-sm font-bold outline-none focus:border-natural-accent shadow-sm w-full"
                            />
                            <div className="flex gap-4 items-center">
                              <input 
                                value={entry.translation} 
                                placeholder="Ex: Pensée réflexive"
                                onChange={(e) => {
                                  const updated = [...dictionary];
                                  updated[i].translation = e.target.value;
                                  setDictionary(updated);
                                }}
                                className="flex-1 bg-white p-4 rounded-xl border border-natural-sand text-sm font-bold outline-none focus:border-natural-accent shadow-sm w-full"
                              />
                              <button 
                                onClick={() => {
                                  const updated = dictionary.filter(d => d.id !== entry.id);
                                  setDictionary(updated);
                                }}
                                className="p-3 text-natural-stone hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button 
                        onClick={() => {
                          const newEntry: DictionaryEntry = { id: uuidv4(), original: '', translation: '' };
                          setDictionary([...dictionary, newEntry]);
                        }}
                        className="w-full py-6 border-2 border-dashed border-natural-sand rounded-2xl text-natural-muted hover:border-natural-accent hover:text-natural-accent transition-all flex items-center justify-center gap-3 font-bold text-sm bg-natural-bg/20"
                      >
                        <Plus className="w-5 h-5" /> Ajouter une entrée au dictionnaire
                      </button>
                    </>
                  ) : (
                    <div className="space-y-12">
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                         {/* Création Facette */}
                         <div className="bg-natural-bg p-8 rounded-[32px] border border-natural-sand space-y-6">
                           <div className="flex items-center gap-4">
                             <div className="w-10 h-10 bg-natural-brown rounded-xl flex items-center justify-center text-white">
                               <Layers className="w-5 h-5" />
                             </div>
                             <div>
                               <h4 className="font-serif text-xl">Nouvelle Facette</h4>
                               <p className="text-[9px] font-bold text-natural-muted uppercase tracking-widest">Atome d'analyse</p>
                             </div>
                           </div>
                           <div className="flex gap-2">
                             <input 
                               value={newFacetteName}
                               onChange={(e) => setNewFacetteName(e.target.value)}
                               placeholder="Nom (ex: Pourquoi)"
                               className="flex-1 bg-white p-4 rounded-2xl border border-natural-sand text-sm font-bold shadow-sm outline-none focus:border-natural-accent"
                             />
                             <button 
                               onClick={async () => {
                                 if(!newFacetteName.trim()) return;
                                 await db.facettes.add({ id: uuidv4(), name: newFacetteName, createdAt: Date.now() });
                                 setNewFacetteName('');
                               }}
                               className="p-4 bg-natural-brown text-white rounded-2xl font-bold shadow-lg shadow-natural-brown/20 flex items-center justify-center"
                             >
                               <Plus className="w-5 h-5" />
                             </button>
                           </div>
                         </div>

                         {/* Création Collection */}
                         <div className="bg-natural-bg p-8 rounded-[32px] border border-natural-sand space-y-6">
                           <div className="flex items-center gap-4">
                             <div className="w-10 h-10 bg-natural-accent rounded-xl flex items-center justify-center text-white">
                               <Layers className="w-5 h-5" />
                             </div>
                             <div>
                               <h4 className="font-serif text-xl">Nouvelle Collection</h4>
                               <p className="text-[9px] font-bold text-natural-muted uppercase tracking-widest">Ensemble de facettes</p>
                             </div>
                           </div>
                           <div className="space-y-4">
                             <input 
                               value={newCollectionName}
                               onChange={(e) => setNewCollectionName(e.target.value)}
                               placeholder="Nom (ex: 5W)"
                               className="w-full bg-white p-4 rounded-2xl border border-natural-sand text-sm font-bold shadow-sm outline-none focus:border-natural-accent"
                             />
                             <div className="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto p-2 border border-natural-sand rounded-xl bg-white/50">
                               {(facettesList || []).map(f => (
                                 <button 
                                   key={f.id}
                                   onClick={() => {
                                     setSelectedFacetsForCollection(prev => 
                                       prev.includes(f.id) ? prev.filter(id => id !== f.id) : [...prev, f.id]
                                     );
                                   }}
                                   className={cn(
                                     "px-3 py-1 rounded-full text-[9px] font-bold uppercase transition-all",
                                     selectedFacetsForCollection.includes(f.id) ? "bg-natural-accent text-white" : "bg-natural-sand text-natural-muted"
                                   )}
                                 >
                                   {f.name}
                                 </button>
                               ))}
                             </div>
                             <button 
                               onClick={async () => {
                                 if(!newCollectionName.trim() || selectedFacetsForCollection.length === 0) return;
                                 await db.facetCollections.add({ 
                                   id: uuidv4(), 
                                   name: newCollectionName, 
                                   facetIds: selectedFacetsForCollection, 
                                   createdAt: Date.now() 
                                 });
                                 setNewCollectionName('');
                                 setSelectedFacetsForCollection([]);
                               }}
                               className="w-full py-3 bg-natural-accent text-white rounded-2xl font-bold text-sm shadow-lg shadow-natural-accent/20"
                             >
                               Créer la collection
                             </button>
                           </div>
                         </div>
                       </div>

                       {/* Affichage des Collections */}
                       <div className="space-y-6">
                         <h3 className="text-[10px] font-black text-natural-muted uppercase tracking-[0.3em] mb-4">Collections Thématiques</h3>
                         <div className="grid grid-cols-1 gap-6">
                           {(facetCollections || []).map(col => (
                             <div key={col.id} className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm hover:border-natural-accent/30 transition-all group relative">
                               <div className="flex items-center justify-between mb-6">
                                 <h4 className="font-serif text-2xl text-natural-heading">{col.name}</h4>
                                 <button onClick={() => db.facetCollections.delete(col.id)} className="p-2 text-natural-stone hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                   <Trash2 className="w-4 h-4" />
                                 </button>
                               </div>
                               <div className="flex flex-wrap gap-2 p-4 bg-natural-bg/50 rounded-2xl border border-natural-sand border-dashed">
                                 {(col.facetIds || []).map(fid => {
                                   const facet = (facettesList || []).find(f => f.id === fid);
                                   return (
                                     <span key={fid} className="px-4 py-2 bg-white rounded-xl text-xs font-bold text-natural-heading shadow-sm border border-natural-sand">
                                       {facet?.name || fid}
                                     </span>
                                   );
                                 })}
                               </div>
                             </div>
                           ))}
                         </div>
                       </div>

                       {/* Affichage des Facettes Orphelines */}
                       <div className="space-y-6">
                         <h3 className="text-[10px] font-black text-natural-muted uppercase tracking-[0.3em] mb-4">Facettes Indépendantes</h3>
                         <div className="flex flex-wrap gap-3">
                           {(facettesList || []).filter(f => !(facetCollections || []).some(col => (col.facetIds || []).includes(f.id))).map(f => (
                             <div key={f.id} className="bg-white py-3 px-6 rounded-full border border-natural-sand shadow-sm flex items-center gap-3 group hover:border-natural-accent/30 transition-all">
                               <span className="text-[10px] font-bold uppercase tracking-widest text-natural-heading">{f.name}</span>
                               <button 
                                 onClick={() => db.facettes.delete(f.id)}
                                 className="opacity-0 group-hover:opacity-100 text-natural-stone hover:text-red-500 transition-all"
                               >
                                 <Trash2 className="w-3.5 h-3.5" />
                               </button>
                             </div>
                           ))}
                         </div>
                       </div>
                    </div>
                  )}
                </div>
                <div className="p-8 border-t border-natural-sand bg-natural-bg/50">
                  <button 
                    onClick={() => {
                      localStorage.setItem('SOCRATE_DICTIONARY', JSON.stringify(dictionary));
                      setIsDictionaryOpen(false);
                      alert("Dictionnaire mis à jour.");
                    }} 
                    className="w-full py-5 bg-natural-accent text-white rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-natural-accent/20 hover:scale-[1.01] transition-transform"
                  >
                    <Save className="w-5 h-5" /> Valider et synchroniser le lexique
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="h-12 border-t border-natural-border px-10 flex items-center justify-between text-[10px] text-natural-muted uppercase tracking-[0.2em] font-bold bg-white/20 backdrop-blur-sm">
          <div>SYSTÈME SÉCURISÉ — CHIP-A01</div>
        </footer>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode, label: string, active: boolean, onClick?: () => void, count?: number }) {
  return (
    <button onClick={onClick} className={cn("flex items-center justify-between w-full p-3 rounded-xl text-sm font-semibold transition-all group", active ? "bg-natural-sand text-natural-accent shadow-sm" : "text-natural-muted hover:bg-natural-sand/30 hover:text-natural-heading")}>
      <div className="flex items-center gap-3"><span className={cn("transition-transform group-hover:scale-110", active ? "text-natural-accent" : "text-natural-muted")}>{icon}</span><span>{label}</span></div>
      {count !== undefined && <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-black tracking-tighter", active ? "bg-natural-accent text-white" : "bg-natural-sand text-natural-stone")}>{count}</span>}
    </button>
  );
}
