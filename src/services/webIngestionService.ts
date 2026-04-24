export type WebSourceMode = 'rss' | 'scrape';

export interface WebSourceDefinition {
  id: string;
  name: string;
  url: string;
  mode: WebSourceMode;
  enabled: boolean;
}

export interface IngestedDocument {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  url?: string;
  text: string;
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
  const candidates = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`,
  ];

  let lastError: any;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} on ${candidate}`);
        continue;
      }
      const text = await res.text();
      if (text && text.trim().length > 0) return text;
      lastError = new Error(`Empty response from ${candidate}`);
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
      if (!text) return null;
      return {
        sourceId: source.id,
        sourceName: source.name || source.url,
        sourceUrl: source.url,
        title,
        url: link,
        text,
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
        const articleText = truncate(stripHtml(html), 22000);
        const bestText = getLongestTextCandidate([articleText, doc.text]);
        if (!bestText) return doc;
        return {
          ...doc,
          text: bestText,
        };
      } catch {
        return doc;
      }
    })
  );
  return enriched;
}

async function collectFromScrape(source: WebSourceDefinition): Promise<IngestedDocument[]> {
  const html = await fetchTextWithFallbacks(source.url);
  const text = truncate(stripHtml(html), 16000);
  if (!text) return [];
  return [{
    sourceId: source.id,
    sourceName: source.name || source.url,
    sourceUrl: source.url,
    title: source.name || source.url,
    url: source.url,
    text,
  }];
}

export async function collectFromWebSource(source: WebSourceDefinition, maxRssItems = 5): Promise<IngestedDocument[]> {
  if (source.mode === 'rss') {
    return collectFromRss(source, maxRssItems);
  }
  return collectFromScrape(source);
}
