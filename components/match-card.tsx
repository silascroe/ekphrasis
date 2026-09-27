import type { IdentificationResult } from "../lib/types";
import { SourceAnnotation } from "./source-annotation";

export function MatchCard({ result }: { result: Extract<IdentificationResult, { state: "MATCH" }> }) {
  return (
    <article>
      {result.source.image_url ? <img src={result.source.image_url} alt={result.artwork.title ?? "Artwork"} /> : null}
      <h2>{result.artwork.title ?? "Untitled artwork"}</h2>
      <p><span>Artist</span> · {result.artwork.artist ?? "Unknown artist"}</p>
      <p><span>Year</span> · {result.artwork.year ?? "Date unknown"}</p>
      <p><span>Medium</span> · {result.artwork.medium ?? "Medium unavailable"}</p>
      {result.artwork.style ? <p><span>Style</span> · {result.artwork.style}</p> : null}
      <p className="confidence-indicator" aria-label="Confidence">Confidence · {result.confidence}</p>
      {result.context ? <p>{result.context}</p> : null}
      {result.detail ? <p>{result.detail}</p> : null}
      {result.related_reading.length ? (
        <section aria-label="Related reading">
          {result.related_reading.map(link => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.title}</a>
          ))}
        </section>
      ) : null}
      <SourceAnnotation name={result.source.name} url={result.source.url} />
    </article>
  );
}
