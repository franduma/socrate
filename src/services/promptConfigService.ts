export type PromptTemplateKey =
  | 'analyze_and_segment'
  | 'deep_analysis'
  | 'enrich_segment_semantics';

export type PromptTemplateDefinition = {
  key: PromptTemplateKey;
  label: string;
  description: string;
  defaultContent: string;
};

export type PromptCollectionConfig = {
  id: string;
  name: string;
  description: string;
  prompts: Record<PromptTemplateKey, string>;
  readOnly?: boolean;
  createdAt: number;
  updatedAt: number;
};

const PROMPT_COLLECTIONS_STORAGE_KEY = 'SOCRATE_CUSTOM_PROMPT_COLLECTIONS';
const ACTIVE_PROMPT_COLLECTION_ID_STORAGE_KEY = 'SOCRATE_ACTIVE_PROMPT_COLLECTION_ID';
const DEFAULT_PROMPT_COLLECTION_ID = 'default-core-prompts';

export const PROMPT_TEMPLATE_DEFS: PromptTemplateDefinition[] = [
  {
    key: 'analyze_and_segment',
    label: 'Analyse et segmentation',
    description:
      'Prompt principal pour deconstruire un texte, produire le JSON de segmentation et le graphe.',
    defaultContent: `
Tu es Socrate, expert en maieutique. Deconstruis cet echange.
{{segmentationInstruction}}
{{semanticComparisonInstruction}}
Regle de role: si le segment est une question/probleme initial -> role="user"; si c'est une explication/raisonnement/reponse -> role="assistant".
Produis un graphe riche et varie: noeuds de types differents (Conversation, Question, SocraticAnalysis, Concept, Theme, Evidence, Actor, Deviation).
Chaque noeud doit inclure properties.semanticPosition parmi: position_initiale, analyse_socratique, concept, preuve, acteur, deviation, meta.
Chaque noeud doit inclure properties.abstractionLevel parmi: concret, intermediaire, conceptuel, meta.
Chaque noeud doit inclure properties.abstractionScore (0..1) coherent avec abstractionLevel.
Utilise des labels de relations explicites (ex: soutient, oppose, clarifie, illustre, derive_de, contextualise).

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

TEXTE: {{textJson}}
`.trim(),
  },
  {
    key: 'deep_analysis',
    label: 'Analyse semantique profonde',
    description: 'Prompt utilise pour l analyse profonde de conversation complete.',
    defaultContent: `
Tu es un expert en analyse semantique profonde.
ANALYSE CE TEXTE:
{{textQuoted}}
FORMAT: Markdown structure.
`.trim(),
  },
  {
    key: 'enrich_segment_semantics',
    label: 'Enrichissement semantique segment',
    description:
      'Prompt utilise pour enrichir un segment avec vectorisation textuelle et interpretation socratique.',
    defaultContent: `
Tu dois produire une sortie JSON stricte:
{
  "semanticVectorDescription": "description vectorielle concise",
  "semanticInterpretation": "interpretation socratique concise"
}

Contexte conversation: {{conversationSummaryJson}}
Role du segment: {{role}}
Texte du segment: {{segmentTextJson}}
`.trim(),
  },
];

function getDefaultPromptMap(): Record<PromptTemplateKey, string> {
  return PROMPT_TEMPLATE_DEFS.reduce((acc, def) => {
    acc[def.key] = def.defaultContent;
    return acc;
  }, {} as Record<PromptTemplateKey, string>);
}

export function getDefaultPromptCollection(): PromptCollectionConfig {
  const now = Date.now();
  return {
    id: DEFAULT_PROMPT_COLLECTION_ID,
    name: 'Prompts coeur (par defaut)',
    description: 'Collection systeme en lecture seule. Base de reference.',
    prompts: getDefaultPromptMap(),
    readOnly: true,
    createdAt: now,
    updatedAt: now,
  };
}

function readCustomCollections(): PromptCollectionConfig[] {
  try {
    const raw = localStorage.getItem(PROMPT_COLLECTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const defaults = getDefaultPromptMap();
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => {
        const prompts = { ...defaults, ...(entry.prompts || {}) } as Record<PromptTemplateKey, string>;
        return {
          id: String(entry.id),
          name: String(entry.name || 'Collection de prompts'),
          description: String(entry.description || ''),
          prompts,
          readOnly: false,
          createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
          updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : Date.now(),
        } as PromptCollectionConfig;
      });
  } catch {
    return [];
  }
}

export function saveCustomPromptCollections(collections: PromptCollectionConfig[]) {
  const payload = (collections || [])
    .filter((entry) => !entry.readOnly)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      prompts: entry.prompts,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  localStorage.setItem(PROMPT_COLLECTIONS_STORAGE_KEY, JSON.stringify(payload));
}

export function getPromptCollections(): PromptCollectionConfig[] {
  return [getDefaultPromptCollection(), ...readCustomCollections()];
}

export function getActivePromptCollectionId(): string {
  const saved = localStorage.getItem(ACTIVE_PROMPT_COLLECTION_ID_STORAGE_KEY);
  const collections = getPromptCollections();
  if (saved && collections.some((c) => c.id === saved)) return saved;
  return DEFAULT_PROMPT_COLLECTION_ID;
}

export function setActivePromptCollectionId(id: string) {
  const collections = getPromptCollections();
  const next = collections.some((c) => c.id === id) ? id : DEFAULT_PROMPT_COLLECTION_ID;
  localStorage.setItem(ACTIVE_PROMPT_COLLECTION_ID_STORAGE_KEY, next);
}

export function resolvePromptTemplate(key: PromptTemplateKey): string {
  const collections = getPromptCollections();
  const activeId = getActivePromptCollectionId();
  const active = collections.find((c) => c.id === activeId) || getDefaultPromptCollection();
  const fallback = getDefaultPromptCollection();
  return String(active.prompts?.[key] || fallback.prompts[key] || '').trim();
}

export function renderPromptTemplate(
  key: PromptTemplateKey,
  vars: Record<string, string | number | boolean | null | undefined>
): string {
  const template = resolvePromptTemplate(key);
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, varName) => {
    const value = vars[varName];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}
