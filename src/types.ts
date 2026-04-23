/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Segment {
  id: string;
  conversationId: string;
  content: string; 
  originalText: string; 
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  embedding?: number[];
  semanticSignature?: string; 
  semanticVectorDescription?: string; // Content of the semantic vector/features
  semanticInterpretation?: string; // Natural language interpretation of semantic concepts
  knowledgeGraph?: KnowledgeGraph; // New: Local knowledge graph for this segment
  tags: string[];
  previousSegmentId?: string;
  nextSegmentId?: string;
  parentId?: string; 
  parentLabel?: string; 
  metadata: {
    isPivot?: boolean;
    isDeviation?: boolean;
    reason?: string;
  };
}

export interface KnowledgeNode {
  id: string;
  label: string;
  type: string;
  properties?: Record<string, any>;
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: 'copy-paste' | 'file' | 'session';
  segmentsCount: number;
  semanticSignature?: string; // New: Global semantic footprint
  knowledgeGraph?: KnowledgeGraph; // New: Extracted graph data
  semanticAnalysis?: {
    summary: string;
    themes: string[];
    deviations: string[];
    suggestedTags: string[];
  };
  deepAnalysis?: string;
  selectedModel?: string;
}

export interface DictionaryEntry {
  id: string;
  original: string;
  translation: string;
}

export interface Facette {
  id: string;
  name: string;
  category?: string;
  description?: string;
  createdAt: number;
}

export interface FacetCollection {
  id: string;
  name: string;
  facetIds: string[];
  createdAt: number;
}

export interface CustomReaction {
  id: string;
  label: string;
  prompt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parentId?: string;
  parentLabel?: string;
}

export interface FileEntry {
  id: string;
  name: string;
  type: 'markdown' | 'pdf' | 'code' | 'other';
  content: string;
  path?: string;
  lastModified: number;
  tags: string[];
}
