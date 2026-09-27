import { ProviderError } from "../errors";

export type WikipediaArticle = {
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  externallinks?: string[];
};

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new ProviderError("wikipedia", "PROVIDER_ERROR", "Wikipedia request failed.");
  return response.json();
}

export async function fetchWikipedia(title: string): Promise<WikipediaArticle | null> {
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const linksUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&ellimit=50&format=json&titles=${encodeURIComponent(title)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const [summary, links] = await Promise.all([
      fetchJson(summaryUrl, controller.signal),
      fetchJson(linksUrl, controller.signal)
    ]);

    if (!summary) return null;

    const pages = (links as { query?: { pages?: Record<string, { extlinks?: Array<{ "*": string }> }> } } | null)?.query?.pages;
    const externallinks = pages
      ? Object.values(pages).flatMap(page => page.extlinks?.map(link => link["*"]) ?? [])
      : [];

    return {
      ...(summary as Omit<WikipediaArticle, "externallinks">),
      externallinks
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new ProviderError("wikipedia", "TIMEOUT", "Wikipedia request timed out.");
    }
    throw new ProviderError("wikipedia", "NETWORK", "Wikipedia request failed.");
  } finally {
    clearTimeout(timer);
  }
}
