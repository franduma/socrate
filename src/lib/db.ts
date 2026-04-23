import Dexie, { type Table } from 'dexie';
import { Conversation, Segment, FileEntry, Facette, FacetCollection, SemanticAttribute, SemanticAttributeCollection } from '../types';

export class SocrateDatabase extends Dexie {
  conversations!: Table<Conversation>;
  segments!: Table<Segment>;
  files!: Table<FileEntry>;
  facettes!: Table<Facette>;
  facetCollections!: Table<FacetCollection>;
  semanticAttributes!: Table<SemanticAttribute>;
  semanticAttributeCollections!: Table<SemanticAttributeCollection>;

  constructor() {
    super('SocrateDB');
    this.version(3).stores({
      conversations: 'id, title, createdAt, updatedAt',
      segments: 'id, conversationId, timestamp, previousSegmentId, nextSegmentId, *tags',
      files: 'id, name, type, lastModified, *tags',
      facettes: 'id, name, createdAt',
      facetCollections: 'id, name, createdAt'
    });
    this.version(4).stores({
      conversations: 'id, title, createdAt, updatedAt',
      segments: 'id, conversationId, timestamp, previousSegmentId, nextSegmentId, *tags',
      files: 'id, name, type, lastModified, *tags',
      facettes: 'id, name, createdAt',
      facetCollections: 'id, name, createdAt',
      semanticAttributes: 'id, label, kind, semanticPosition, usageCount, updatedAt, createdAt'
    });
    this.version(5).stores({
      conversations: 'id, title, createdAt, updatedAt',
      segments: 'id, conversationId, timestamp, previousSegmentId, nextSegmentId, *tags',
      files: 'id, name, type, lastModified, *tags',
      facettes: 'id, name, createdAt',
      facetCollections: 'id, name, createdAt',
      semanticAttributes: 'id, label, kind, semanticPosition, usageCount, updatedAt, createdAt',
      semanticAttributeCollections: 'id, name, updatedAt, createdAt'
    });
  }
}

export const db = new SocrateDatabase();
