"use client";

import { useState } from "react";
import type { IdentificationResult } from "../lib/types";
import { UploadForm } from "../components/upload-form";
import { ProcessingState } from "../components/processing-state";
import { MatchCard } from "../components/match-card";
import { NoMatch } from "../components/no-match";
import { ErrorState } from "../components/error-state";

export function Home({
  initialState = "IDLE",
  result: initialResult
}: {
  initialState?: "IDLE" | "PROCESSING" | "MATCH" | "NO_MATCH" | "ERROR";
  result?: IdentificationResult;
}) {
  const [state, setState] = useState(initialState);
  const [result, setResult] = useState<IdentificationResult | undefined>(initialResult);

  function handleResult(next: IdentificationResult) {
    setResult(next);
    setState(next.state);
  }

  function reset() {
    setResult(undefined);
    setState("IDLE");
  }

  return (
    <main className="ekphrasis-shell">
      <header><p>Ekphrasis</p><h1>Identify your artwork</h1></header>
      {state === "IDLE" ? <UploadForm onStart={() => setState("PROCESSING")} onResult={handleResult} /> : null}
      {state === "PROCESSING" ? <ProcessingState /> : null}
      {result?.state === "MATCH" ? <MatchCard result={result} /> : null}
      {result?.state === "NO_MATCH" ? <NoMatch degraded={result.degraded} /> : null}
      {result?.state === "ERROR" ? <ErrorState code={result.error} /> : null}
      {state !== "IDLE" && state !== "PROCESSING" ? (
        <button type="button" onClick={reset}>Try another photo</button>
      ) : null}
    </main>
  );
}
