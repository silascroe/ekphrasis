import type { IdentificationResult } from "../lib/types";

export function SuggestionCard({ result }: { result: Extract<IdentificationResult, { state: "SUGGESTION" }> }) {
  return (
    <article className="suggestion-card" aria-labelledby="suggestion-title">
      <p className="suggestion-label">Unverified suggestion</p>
      <h2 id="suggestion-title">{result.artwork.title ?? "Possible identification"}</h2>
      {result.artwork.artist ? <p><span>Artist</span> · {result.artwork.artist}</p> : null}
      {result.artwork.year ? <p><span>Year</span> · {result.artwork.year}</p> : null}
      {result.artwork.medium ? <p><span>Medium</span> · {result.artwork.medium}</p> : null}
      <p>Codex proposed this identity, but the museum catalogs did not confirm it. Treat it as a lead, not a verified match.</p>
      {result.unavailable_sources.length ? <p>Some museum sources were unavailable during verification.</p> : null}
      <p className="confidence-indicator">Codex research confidence · {result.confidence}</p>
      {result.evidence.length || result.candidates.length ? (
        <details>
          <summary>Codex’s research notes</summary>
          {result.evidence.length ? <ul>{result.evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : null}
          {result.candidates.length ? <p>Search clues: {result.candidates.join(" · ")}</p> : null}
        </details>
      ) : null}
      {result.source_urls.length ? (
        <section aria-label="Unverified research links">
          <p>Research links (not museum confirmation)</p>
          <ul>{result.source_urls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a></li>)}</ul>
        </section>
      ) : null}
    </article>
  );
}
