"use client";

// app/login/page.tsx — one credential, three products.
//
// Intentionally the same two fields, in the same order, with the same
// wording as the floor app and Travola Home. A manager who has signed into one
// has signed into all three; making this screen look clever would only
// make them wonder whether it wants something different.
//
// It also carries the configuration banner. This is where a bounced page
// request lands, and where someone types a code that was never wrong when
// the real problem is an environment variable — so the page asks
// /api/health on mount and says so before anyone starts doubting
// themselves.
import { useEffect, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

export default function LoginPage() {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A configuration failure is not the user's fault and is not fixed by
  // retyping the code, so it is presented differently from a rejected
  // credential.
  const [isConfig, setIsConfig] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => (response.ok ? null : response.json()))
      .then((data) => {
        const problems: Array<{ fix: string }> = data?.problems ?? [];
        if (problems.length) {
          setIsConfig(true);
          setError(`This deployment is not fully configured. ${problems.map((p) => p.fix).join(" ")}`);
        } else if (data && data.database && !data.database.ok) {
          setIsConfig(true);
          setError(`Travola Pantry cannot reach the database: ${data.database.detail}`);
        }
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIsConfig(false);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, passcode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIsConfig(Boolean(data.configuration) || response.status >= 500);
        setError(
          data.error ??
            (response.status >= 500
              ? "The server hit an error signing in. Check this deployment's logs — the usual cause is a missing environment variable."
              : "That restaurant name and code do not match."),
        );
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6">
          <img src="/brand/travola-icon.svg" alt="" aria-hidden="true" className="w-9 h-9 rounded-[9px]" />
          <span className="flex items-baseline gap-2.5">
            <span className="text-xl font-bold tracking-wide text-ai">Travola</span>
            <span className="font-mono text-[9px] text-ink-400 tracking-[0.2em] uppercase">Pantry</span>
          </span>
        </div>

        <form onSubmit={submit} className="card card-lit p-6 flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink-50">Sign in</h1>
            <p className="text-sm text-ink-400 mt-2 leading-relaxed">
              Use the same restaurant name and code as the floor manager and Travola Home.
            </p>
          </div>

          <Field label="Restaurant name">
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="organization"
              autoFocus
              required
            />
          </Field>

          <Field label="Code">
            <input
              className={`${inputClass} tracking-[0.5em] text-lg`}
              value={passcode}
              onChange={(event) => setPasscode(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••"
              required
            />
          </Field>

          {error ? (
            <div
              className={
                isConfig
                  ? "rounded-xl border border-state-dining/30 bg-state-diningBg p-3"
                  : "rounded-xl border border-state-seated/30 bg-state-seatedBg p-3"
              }
            >
              <p className={`text-sm ${isConfig ? "text-state-dining" : "text-state-seated"}`}>{error}</p>
              {isConfig ? (
                <p className="text-xs text-ink-400 mt-2 leading-relaxed">
                  This is a setup problem, not a wrong code — retyping it will not help.{" "}
                  <a href="/api/health" className="text-ai underline">Check what is missing</a>.
                </p>
              ) : null}
            </div>
          ) : null}

          <Button type="submit" tone="primary" disabled={busy || !name || passcode.length < 4} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-xs text-ink-400/70 mt-5 text-center leading-relaxed">
          Travola Pantry is where inventory lives and where the night's sales are recorded. The floor manager and Travola Home sign in with this same code.
        </p>
      </div>
    </div>
  );
}
