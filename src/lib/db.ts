import Dexie, { type Table } from 'dexie';
import { Conversation, Segment, FileEntry, Facette, FacetCollection } from '../types';

export class SocrateDatabase extends Dexie {
  conversations!: Table<Conversation>;
  segments!: Table<Segment>;
  files!: Table<FileEntry>;
  facettes!: Table<Facette>;
  facetCollections!: Table<FacetCollection>;

  constructor() {
    super('SocrateDB');
    this.version(3).stores({
      conversations: 'id, title, createdAt, updatedAt',
      segments: 'id, conversationId, timestamp, previousSegmentId, nextSegmentId, *tags',
      files: 'id, name, type, lastModified, *tags',
      facettes: 'id, name, createdAt',
      facetCollections: 'id, name, createdAt'
    });
  }
}

export const db = new SocrateDatabase();
