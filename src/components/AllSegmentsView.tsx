import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { motion } from 'motion/react';
import { Tag, Quote, MessageSquare, Search, ChevronRight, Maximize2, Fingerprint } from 'lucide-react';
import { cn } from '../lib/utils';

interface AllSegmentsViewProps {
  onSelectConversation: (convId: string) => void;
}

export function AllSegmentsView({ onSelectConversation }: AllSegmentsViewProps) {
  const segments = useLiveQuery(() => db.segments.orderBy('timestamp').reverse().toArray());
  const conversations = useLiveQuery(() => db.conversations.toArray()) || [];
  const [searchTerm, setSearchTerm] = React.useState('');
  const conversationById = React.useMemo(() => {
    return new Map(conversations.map((conv) => [conv.id, conv]));
  }, [conversations]);

  const filteredSegments = segments?.filter(s => 
    s.content.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.tags?.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-8">
      <header className="bg-white p-10 rounded-[32px] border border-natural-sand shadow-sm">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 bg-natural-accent rounded-2xl flex items-center justify-center">
            <Quote className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-serif text-3xl text-natural-heading">Bibliothèque de segments</h1>
            <p className="text-natural-muted text-sm tracking-wide uppercase font-semibold">Toute votre pensée atomisée et consultable</p>
          </div>
        </div>

        <div className="relative">
          <div className="flex items-center gap-3 p-4 bg-natural-bg rounded-2xl border border-natural-sand focus-within:ring-2 focus-within:ring-natural-accent/10 transition-all">
            <Search className="w-5 h-5 text-natural-muted font-bold" />
            <input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par contenu, concept ou tag..."
              className="bg-transparent border-none outline-none w-full text-base placeholder:text-natural-muted"
            />
          </div>
        </div>
      </header>

      <div className="space-y-4">
        {filteredSegments?.map((segment) => (
          (() => {
            const parentConv = conversationById.get(segment.conversationId);
            return (
          <div 
            key={segment.id} 
            onClick={() => onSelectConversation(segment.conversationId)}
            className="bg-white p-8 rounded-[32px] border border-natural-sand shadow-sm hover:border-natural-accent/30 hover:shadow-xl transition-all cursor-pointer group active:scale-[0.99]"
          >
            <div className="flex items-start gap-6">
              <div className="w-10 h-10 rounded-xl bg-natural-sand flex items-center justify-center shrink-0 group-hover:bg-natural-peach transition-colors">
                <MessageSquare className="w-5 h-5 text-natural-accent" />
              </div>
              <div className="flex-1 space-y-4">
                <p className="text-natural-text leading-relaxed font-medium text-lg">
                  "{segment.content}"
                </p>
                <div className="flex flex-wrap gap-2 pt-4 border-t border-natural-sand">
                  {segment.tags?.map(tag => (
                    <span key={tag} className="text-[10px] font-bold px-3 py-1 bg-natural-bg border border-natural-sand text-natural-muted rounded-full uppercase tracking-tight group-hover:border-natural-accent group-hover:text-natural-accent transition-colors">
                      #{tag}
                    </span>
                  ))}
                  <div className="ml-auto flex items-center gap-2 text-[9px] font-bold text-natural-stone uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="bg-natural-accent text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                      <Maximize2 className="w-3 h-3 text-white" />
                      Inspecter
                    </span>
                    <span>Voir la conversation</span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </div>
                <div className="pt-3 mt-2 border-t border-dashed border-natural-sand text-[10px] text-natural-stone uppercase tracking-wider font-semibold">
                  {parentConv ? `Conversation: ${parentConv.title}` : `Conversation: ${segment.conversationId.slice(0, 8)}`}
                </div>
                {(segment.analysisTrace || parentConv?.analysisTrace) && (
                  <div className="text-[10px] text-natural-muted uppercase tracking-wider font-semibold flex items-center gap-2">
                    <Fingerprint className="w-3 h-3" />
                    {`${(() => {
                      const trace = (segment.analysisTrace || parentConv?.analysisTrace);
                      const origin = trace?.webDocumentUrl || trace?.webSourceUrl;
                      const originPart = origin ? ` | Origine: ${origin}` : '';
                      const interestPart = Number.isFinite(trace?.interestGlobalScore as number)
                        ? ` | Interet: ${(Number(trace?.interestGlobalScore) * 100).toFixed(1)}%`
                        : '';
                      return `Granularite: ${trace?.granularityName || 'n/a'} | Collection: ${trace?.semanticCollectionName || 'Aucune'} | Similarite: ${(trace?.similarityThreshold ?? 0.35).toFixed(2)} | Vecteur: ${trace?.vectorEngineMode || 'local'}${interestPart}${originPart}`;
                    })()}`}
                  </div>
                )}
              </div>
            </div>
          </div>
            );
          })()
        ))}
        {filteredSegments?.length === 0 && (
          <div className="text-center py-24 bg-white rounded-[40px] border border-dashed border-natural-border">
            <Quote className="w-12 h-12 text-natural-sand mx-auto mb-4" />
            <p className="text-natural-muted italic font-serif text-xl">Le silence est parfois la meilleure réponse...</p>
            <p className="text-natural-stone text-xs uppercase tracking-widest mt-2">Aucun segment ne correspond à votre recherche</p>
          </div>
        )}
      </div>
    </div>
  );
}
