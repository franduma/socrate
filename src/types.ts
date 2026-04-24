/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SegmentationTrace {
  runId: string;
  timestamp: number;
  provider: string;
  vectorEngineMode?: 'local' | 'provider';
  granularityId: string;
  granularityName: string;
  granularityInstruction?: string;
  semanticCollectionId?: string;
  semanticCollectionName?: string;
  semanticAttributeLabels: string[];
  similarityThreshold: number;
  webSourceName?: string;
  webSourceUrl?: string;
  webDocumentTitle?: string;
  webDocumentUrl?: string;
}

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
  analysisTrace?: SegmentationTrace;
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
  analysisTrace?: SegmentationTrace;
  segmentationTraces?: SegmentationTrace[];
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

export interface SemanticAttribute {
  id: string;
  label: string;
  kind: 'position' | 'node_type' | 'node_label' | 'edge_label' | 'tag' | 'abstraction_level';
  semanticPosition: string;
  color?: string;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SemanticAttributeCollection {
  id: string;
  name: string;
  attributeIds: string[];
  createdAt: number;
  updatedAt: number;
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
