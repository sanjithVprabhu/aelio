export interface KbCollection {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  chunkSize: number;
  overlap: number;
  embeddingModel: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KbSource {
  id: string;
  collectionId: string;
  tenantId: string;
  type: 'file' | 'url' | 'text';
  name: string;
  url?: string;
  status: 'pending' | 'indexing' | 'indexed' | 'error';
  chunkCount: number;
  indexedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
}

export interface KbChunk {
  id: string;
  tenantId: string;
  collectionId: string;
  sourceId: string;
  sourceTitle: string;
  content: string;
  embedding: number[];
  tokenCount: number;
  createdAt: Date;
}

export interface RetrievedChunk {
  chunkId: string;
  sourceTitle: string;
  content: string;
  score: number;
}
