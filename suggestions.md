# Product and architecture suggestions

These are proposals for the project owner to review. They are not approved implementation requirements; no behavior changes are authorized by this document.

## Let independent museum evidence outweigh one disagreement

When several independent museum catalogs support the same artwork and one catalog disagrees, a single mismatch should not automatically erase the corroborating evidence. For example, with four independent sources, three supporting the same work and one opposing it should remain a result the app can present, with the disagreement reflected in its confidence and explanation.

The current matcher has a strong-mismatch veto on an individual candidate, but it does not calculate a 3-of-4 cross-museum vote. A future design should define how records from different catalogs are grouped as the same work, which sources count as independent, what support threshold qualifies, and how conflicting catalog metadata is shown. Codex's own confidence should remain separate from museum corroboration.

## Give non-art and uncertain images a useful result

Codex may receive memes, photographs, screenshots, or other images that are not artworks. Instead of returning a generic failure when no artwork can be established, consider a distinct informational result with a short, cautious image description and a clear explanation that no artwork was identified. Keep this state separate from technical failures such as timeouts or unavailable providers, and avoid confidently labeling an image “not art” when the evidence is inconclusive.

## Consider modernizing the Rijksmuseum adapter

The current Rijksmuseum integration uses its older API-key-based interface. Rijksmuseum's newer public Data Services Search API uses Linked Art identifiers and requires a resolver and field mapping, so this is an adapter redesign rather than a drop-in endpoint swap. Assess whether migrating would reduce credential setup enough to justify the work and any differences in coverage or behavior.

- [Rijksmuseum Data Services Search API](https://data.rijksmuseum.nl/docs/search)
- [Rijksmuseum HTTP resolver](https://data.rijksmuseum.nl/docs/http)
