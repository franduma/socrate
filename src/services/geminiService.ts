import { GoogleGenerativeAI } from "@google/generative-ai";
import { Segment } from "../types";
import { v4 as uuidv4 } from 'uuid';

const MODELS_TO_TRY = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro-latest",
  "gemini-1.5-flash-8b",
  "gemini-pro"
];

function getApiKey() {
  return localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || (import.meta.env.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string);
}

function getSelectedModel() {
  return localStorage.getItem('GEMINI_MANUAL_MODEL') || null;
}

function getAI(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

export async function analyzeAndSegmentConversation(text: string): Promise<{ 
  title: string, 
  segments: (Partial<Segment> & { metadata: { isPivot?: boolean, reason?: string } })[],
  analysis: { 
    summary: string, 
    themes: string[], 
    suggestedTags: string[], 
    deviations: string[],
    semanticSignature: string,
    knowledgeGraph: {
      nodes: { id: string, label: string, type: string, properties?: Record<string, any> }[],
      edges: { id: string, source: string, target: string, label: string }[]
    }
  }
}> {
  const apiKey = getApiKey();
  const manualModel = getSelectedModel();

  if (!apiKey) {
    throw new Error("Clé API Gemini manquante. Veuillez la configurer dans les Paramètres.");
  }

  const genAI = getAI(apiKey);
  const MAX_RETRIES = 2;
  let lastError: any;

  const modelsToUse = manualModel ? [manualModel] : MODELS_TO_TRY;

  for (let modelIdx = 0; modelIdx < modelsToUse.length; modelIdx++) {
    const currentModelName = modelsToUse[modelIdx];
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const waitTime = (lastError?.message?.includes('quota') ? 10000 : 2000) * attempt;
          console.log(`Re-tentative ${attempt} avec ${currentModelName} après ${waitTime}ms...`);
          await new Promise(r => setTimeout(r, waitTime));
        }

        const model = genAI.getGenerativeModel({ 
          model: currentModelName,
          generationConfig: {
            responseMimeType: currentModelName.includes('pro') || currentModelName.includes('flash') ? "application/json" : undefined,
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        });

        console.log(`[GeminiService] Essai du modèle: ${currentModelName}`);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout (${currentModelName})`)), 180000)
        );

        const apiPromise = model.generateContent({
          contents: [{
            role: 'user',
            parts: [{
              text: `
                Tu es Socrate, expert en maïeutique. Déconstruis cet échange.
                
                STRUCTURE (JSON STRICT) :
                {
                  "title": "Titre",
                  "analysis": { "summary": "Résumé", "themes": [], "suggestedTags": [], "deviations": [], "semanticSignature": "S1", "knowledgeGraph": { "nodes": [], "edges": [] } },
                  "segments": [{ "content": "R", "originalText": "T", "role": "user", "semanticSignature": "H1", "tags": [], "knowledgeGraph": { "nodes": [], "edges": [] } }]
                }

                TEXTE : ${JSON.stringify(text)}
              `
            }]
          }]
        });

        const response = await Promise.race([apiPromise, timeoutPromise]) as any;
        const rawText = response.response.text();
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
        
        let parsed = JSON.parse(jsonStr);
        
        // Fallbacks segments
        if (!parsed.segments || parsed.segments.length === 0) {
          console.warn("L'IA n'a produit aucun segment. Création d'un segment unique par défaut.");
          parsed.segments = [{
            content: text.length > 1000 ? text.substring(0, 1000) + "..." : text,
            originalText: text,
            role: "user",
            semanticSignature: "fallback-" + uuidv4().substring(0, 8),
            tags: ["archive-brute"],
            knowledgeGraph: { nodes: [], edges: [] }
          }];
        }

        // Fallbacks analysis
        if (!parsed.analysis) {
          parsed.analysis = {
            summary: "Analyse sommaire indisponible",
            themes: [],
            suggestedTags: [],
            deviations: [],
            semanticSignature: uuidv4(),
            knowledgeGraph: { nodes: [], edges: [] }
          };
        }

        // Post-processing Graphe Global
        const globalKg = parsed.analysis.knowledgeGraph || { nodes: [], edges: [] };
        globalKg.nodes = (globalKg.nodes || []).map((n: any) => ({
          id: n.id || uuidv4(),
          label: n.label || n.id || 'Unit',
          type: n.type || 'Concept',
          properties: n.properties || {}
        }));
        globalKg.edges = (globalKg.edges || []).map((e: any) => ({
          id: e.id || uuidv4(),
          source: e.source,
          target: e.target,
          label: e.label || 'related'
        }));
        parsed.analysis.knowledgeGraph = globalKg;

        // Post-processing Segments
        parsed.segments = parsed.segments.map((seg: any) => {
          const localKg = seg.knowledgeGraph || { nodes: [], edges: [] };
          localKg.nodes = (localKg.nodes || []).map((n: any) => ({
            id: n.id || uuidv4(),
            label: n.label || n.id || 'Unit',
            type: n.type || 'Concept',
            properties: n.properties || {}
          }));
          localKg.edges = (localKg.edges || []).map((e: any) => ({
            id: e.id || uuidv4(),
            source: e.source,
            target: e.target,
            label: e.label || 'related'
          }));
          
          return {
            ...seg,
            content: seg.content || "N/A",
            originalText: seg.originalText || seg.content || "N/A",
            knowledgeGraph: localKg,
            metadata: seg.metadata || {}
          };
        });

        return parsed;
      } catch (err: any) {
        lastError = err;
        console.warn(`Échec avec ${currentModelName} (Tentative ${attempt}):`, err.message);
        
        if (err.message?.includes('404') || err.message?.includes('not found')) {
          break; 
        }
      }
    }
  }

  throw new Error(`Échec de connexion aux services d'IA (Gemini). Tous les modèles testés ont échoué. Cause probable : Clé API incorrecte ou restreinte. Erreur finale : ${lastError?.message}`);
}

export async function deepAnalyzeConversation(text: string): Promise<string> {
  const apiKey = localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Clé API manquante.");

  const genAI = getAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODELS_TO_TRY[0] });

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: `
            Tu es un expert en analyse sémantique profonde.
            ANALYSE CE TEXTE : "${text.replace(/"/g, '\\"')}"
            FORMAT : Markdown structuré.
          `
        }]
      }]
    });
    return result.response.text() || "Analyse indisponible.";
  } catch (error) {
    console.error("Deep Analysis Error:", error);
    throw error;
  }
}

export async function testGeminiConnection(): Promise<boolean> {
  const apiKey = localStorage.getItem('GEMINI_API_KEY_OVERRIDE') || (import.meta.env.VITE_GEMINI_API_KEY as string) || (process.env.GEMINI_API_KEY as string);
  if (!apiKey) return false;
  
  try {
    const genAI = getAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODELS_TO_TRY[0] });
    const result = await model.generateContent("test");
    return !!result.response.text();
  } catch (err) {
    console.error("Test Connection failed:", err);
    return false;
  }
}

export async function chatWithGemini(prompt: string, history: {role: 'user' | 'assistant' | 'system', content: string}[]): Promise<string> {
  const selectedModel = localStorage.getItem('SELECTED_MODEL') || 'gemini';
  
  if (selectedModel === 'openrouter') {
    const orKey = localStorage.getItem('OPENROUTER_API_KEY');
    if (!orKey) throw new Error("Clé API OpenRouter manquante.");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${orKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          ...history.map(m => ({
            role: (m.role === 'system') ? 'system' : (m.role === 'user' ? 'user' : 'assistant'),
            content: m.content
          })),
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Erreur OpenRouter";
  }

  const apiKey = getApiKey();
  const manualModel = getSelectedModel();

  if (!apiKey) throw new Error("Clé API Gemini manquante.");

  const genAI = getAI(apiKey);
  const systemMessage = history.find(m => m.role === 'system');
  const chatHistory = history.filter(m => m.role !== 'system');
  let lastError: any;

  const modelsToUse = manualModel ? [manualModel] : MODELS_TO_TRY;

  for (let modelIdx = 0; modelIdx < modelsToUse.length; modelIdx++) {
    const currentModelName = modelsToUse[modelIdx];
    try {
      const model = genAI.getGenerativeModel({ 
        model: currentModelName,
        systemInstruction: systemMessage ? systemMessage.content : undefined
      });

      // Gemini requiert une alternance stricte User -> Model.
      const validHistory: { role: 'user' | 'model', parts: { text: string }[] }[] = [];
      let expectedRole: 'user' | 'model' = 'user';

      for (const msg of chatHistory) {
        const role = msg.role === 'user' ? 'user' : 'model';
        if (role === expectedRole) {
          validHistory.push({
            role,
            parts: [{ text: msg.content }]
          });
          expectedRole = expectedRole === 'user' ? 'model' : 'user';
        }
      }

      const chat = model.startChat({
        history: validHistory,
      });

      const result = await chat.sendMessage(prompt);
      return result.response.text() || "Désolé, je n'ai pas pu générer de réponse.";
    } catch (error: any) {
      lastError = error;
      console.warn(`Chat: Échec avec ${currentModelName}:`, error.message);
      if (error?.message?.includes('404') || error?.message?.includes('not found')) {
        continue; // Essayer le modèle suivant
      }
      throw error; // Pour les autres erreurs (ex: quota), on laisse remonter
    }
  }

  throw new Error(`Le Chat Socrate n'a pas pu se connecter à l'IA. Vérifiez votre clé API Gemini dans les Paramètres. Erreur : ${lastError?.message}`);
}
