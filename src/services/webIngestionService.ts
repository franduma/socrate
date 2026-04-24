import { Readability } from '@mozilla/readability';

export type WebSourceMode = 'rss' | 'scrape' | 'browser_proxy';

export interface BrowserProxySnapshot {
  pageUrl?: string;
  pageTitle?: string;
  rawContent: string;
  capturedAt?: number;
}

export interface WebSourceDefinition {
  id: string;
  name: string;
  url: string;
  mode: WebSourceMode;
  enabled: boolean;
  titlePrefix?: string;
  granularityProfileId?: string;
  semanticCollectionId?: string;
  similarityThreshold?: number;
  vectorEngineMode?: 'local' | 'provider';
  rssMaxItems?: number;
  browserProxySnapshot?: BrowserProxySnapshot;
}

export interface IngestedDocument {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  url?: string;
  text: string;
  rawContent?: string;
  publishedAt?: string;
}

function stripHtml(value: string) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLongestTextFromSelectors(doc: Document) {
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.article-body',
    '.article-content',
    '.post-content',
    '.entry-content',
    '#content',
    '#main',
  ];
  let best = '';
  selectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => {
      const text = stripHtml((node as HTMLElement).innerText || node.textContent || '');
      if (text.length > best.length) best = text;
    });
  });
  return best;
}

function extractReadableWebContent(html: string, url?: string, titleHint?: string) {
  const raw = String(html || '');
  if (!raw.trim()) {
    return { title: titleHint || '', text: '' };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'text/html');

    const readability = new Readability(doc, {
      charThreshold: 120,
      keepClasses: false,
      maxElemsToParse: 0,
    });
    const article = readability.parse();
    const readableText = stripHtml(article?.content || article?.textContent || '');
    if (readableText.length >= 120) {
      return {
        title: (article?.title || titleHint || '').trim(),
        text: readableText,
      };
    }

    const heuristic = extractLongestTextFromSelectors(doc);
    if (heuristic.length >= 80) {
      return {
        title: titleHint || doc.title || '',
        text: heuristic,
      };
    }
  } catch {
    // Fallback below
  }

  return {
    title: titleHint || '',
    text: stripHtml(raw),
  };
}

function isLikelyErrorOrBlockedPage(input: { title?: string; text?: string; raw?: string; url?: string }) {
  const title = String(input.title || '').toLowerCase();
  const text = String(input.text || '').toLowerCase();
  const raw = String(input.raw || '').toLowerCase();
  const url = String(input.url || '').toLowerCase();
  const probe = `${title}\n${text}\n${raw}`.slice(0, 6000);
  const patterns = [
    'oops, something went wrong',
    'something went wrong',
    'access denied',
    'captcha',
    'robot check',
    'verify you are human',
    'error 451',
    'http 451',
    'for legal reasons',
  ];
  const hasErrorPattern = patterns.some((p) => probe.includes(p));
  if (!hasErrorPattern) return false;
  const tinyText = text.trim().length > 0 && text.trim().length < 420;
  const yahooLike = /yahoo\.com/.test(url) || probe.includes('yahoo');
  return tinyText || yahooLike;
}

function truncate(value: string, max = 12000) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function getLongestTextCandidate(texts: Array<string | undefined | null>) {
  const normalized = texts
    .map((t) => String(t || '').trim())
    .filter((t) => t.length > 0);
  if (!normalized.length) return '';
  return normalized.sort((a, b) => b.length - a.length)[0];
}

async function fetchTextWithFallbacks(url: string) {
  const sanitized = String(url || '').trim();
  const withoutProtocol = sanitized.replace(/^https?:\/\//i, '');
  const candidates: Array<{ url: string; kind: 'text' | 'allorigins_json' }> = [
    { url: sanitized, kind: 'text' },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(sanitized)}`, kind: 'text' },
    { url: `https://api.allorigins.win/get?url=${encodeURIComponent(sanitized)}`, kind: 'allorigins_json' },
    { url: `https://r.jina.ai/http://${withoutProtocol}`, kind: 'text' },
    { url: `https://r.jina.ai/https://${withoutProtocol}`, kind: 'text' },
  ];

  let lastError: any;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} on ${candidate.url}`);
        continue;
      }
      let text = '';
      if (candidate.kind === 'allorigins_json') {
        const payload = await res.json().catch(() => null as any);
        text = String(payload?.contents || '');
      } else {
        text = await res.text();
      }
      if (text && text.trim().length > 0) return text;
      lastError = new Error(`Empty response from ${candidate.url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}

export async function fetchRawWebContent(url: string) {
  return fetchTextWithFallbacks(url);
}

function parseRssDocuments(xmlRaw: string, source: WebSourceDefinition, maxItems = 5): IngestedDocument[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlRaw, 'text/xml');
  const items = Array.from(xml.querySelectorAll('item')).slice(0, maxItems);
  return items
    .map((item) => {
      const title = item.querySelector('title')?.textContent?.trim() || `RSS item (${source.name})`;
      const link = item.querySelector('link')?.textContent?.trim() || undefined;
      const description =
        item.querySelector('content\\:encoded')?.textContent ||
        item.querySelector('description')?.textContent ||
        '';
      const publishedAt = item.querySelector('pubDate')?.textContent?.trim() || undefined;
      const text = truncate(stripHtml(description));
      return {
        sourceId: source.id,
        sourceName: source.name || source.url,
        sourceUrl: source.url,
        title,
        url: link,
        text: text || title,
        publishedAt,
      } as IngestedDocument;
    })
    .filter(Boolean) as IngestedDocument[];
}

async function collectFromRss(source: WebSourceDefinition, maxItems = 5): Promise<IngestedDocument[]> {
  const xmlRaw = await fetchTextWithFallbacks(source.url);
  const docs = parseRssDocuments(xmlRaw, source, maxItems);
  const enriched = await Promise.all(
    docs.map(async (doc) => {
      if (!doc.url) return doc;
      try {
        const html = await fetchTextWithFallbacks(doc.url);
        const readable = extractReadableWebContent(html, doc.url, doc.title);
        const articleText = truncate(readable.text, 22000);
        const bestText = getLongestTextCandidate([articleText, doc.text]);
        const composed = truncate(
          [
            doc.publishedAt ? `Published: ${doc.publishedAt}` : '',
            readable.title || doc.title,
            bestText || doc.text,
          ]
            .filter(Boolean)
            .join('\n\n'),
          22000
        );
        if (!composed) return doc;
        return {
          ...doc,
          text: composed,
        };
      } catch {
        const fallbackText = truncate(
          [doc.publishedAt ? `Published: ${doc.publishedAt}` : '', doc.title, doc.text]
            .filter(Boolean)
            .join('\n\n'),
          22000
        );
        return {
          ...doc,
          text: fallbackText || doc.text,
        };
      }
    })
  );
  return enriched;
}

async function collectFromScrape(source: WebSourceDefinition): Promise<IngestedDocument[]> {
  const html = await fetchTextWithFallbacks(source.url);
  const readable = extractReadableWebContent(html, source.url, source.name || source.url);
  if (isLikelyErrorOrBlockedPage({ title: readable.title, text: readable.text, raw: html, url: source.url })) {
    throw new Error('Page source bloquee ou erreur de rendu (ex: Oops/451/CAPTCHA).');
  }
  const text = truncate(readable.text, 16000);
  if (!text) return [];
  return [{
    sourceId: source.id,
    sourceName: source.name || source.url,
    sourceUrl: source.url,
    title: readable.title || source.name || source.url,
    url: source.url,
    text,
    rawContent: html,
  }];
}

async function collectFromBrowserProxy(source: WebSourceDefinition): Promise<IngestedDocument[]> {
  const snapshot = source.browserProxySnapshot;
  const raw = String(snapshot?.rawContent || '').trim();
  if (!raw) {
    throw new Error("Aucune capture proxy disponible pour cette source. Ouvrez l'onglet cible, copiez son contenu, puis collez-le dans la source proxy.");
  }
  const pageUrl = String(snapshot?.pageUrl || source.url || '').trim();
  const pageTitle = String(snapshot?.pageTitle || source.name || pageUrl || source.url || 'Page proxy').trim();
  const readable = extractReadableWebContent(raw, pageUrl || source.url, pageTitle);
  if (isLikelyErrorOrBlockedPage({ title: readable.title, text: readable.text, raw, url: pageUrl || source.url })) {
    throw new Error("Capture proxy invalide (page d'erreur detectee: Oops/451/CAPTCHA).");
  }
  const bestText = truncate(getLongestTextCandidate([readable.text, stripHtml(raw)]), 22000);
  if (!bestText) {
    throw new Error("Capture proxy vide ou illisible.");
  }
  return [{
    sourceId: source.id,
    sourceName: source.name || source.url,
    sourceUrl: source.url,
    title: readable.title || pageTitle || source.name || source.url,
    url: pageUrl || source.url,
    text: bestText,
    rawContent: raw,
    publishedAt: snapshot?.capturedAt ? new Date(snapshot.capturedAt).toISOString() : undefined,
  }];
}

function getYahooFallbackScrapeUrl(sourceUrl: string) {
  try {
    const u = new URL(sourceUrl);
    if (!u.hostname.toLowerCase().includes('yahoo.com')) return null;
    return 'https://finance.yahoo.com/news/';
  } catch {
    return null;
  }
}

export async function collectFromWebSource(source: WebSourceDefinition, maxRssItems = 5): Promise<IngestedDocument[]> {
  if (source.mode === 'browser_proxy') {
    return collectFromBrowserProxy(source);
  }
  if (source.mode === 'rss') {
    try {
      return collectFromRss(source, maxRssItems);
    } catch (error: any) {
      const msg = String(error?.message || error || '');
      const is451 = msg.includes('HTTP 451');
      const yahooFallbackUrl = getYahooFallbackScrapeUrl(source.url);
      if (is451 && yahooFallbackUrl) {
        return collectFromScrape({
          ...source,
          mode: 'scrape',
          url: yahooFallbackUrl,
          name: `${source.name} (fallback scrape)`,
        });
      }
      throw error;
    }
  }
  return collectFromScrape(source);
}
