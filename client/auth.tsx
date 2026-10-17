import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

// Privy runs only on /login and /logout. After login we trade the Privy access token for our own
// httpOnly session cookie, so the rest of the site stays plain server-rendered HTML.

const root = document.getElementById("privy-root")!;
const appId = root.dataset.appId!;
const mode = root.dataset.mode as "login" | "logout";
const next = root.dataset.next || "/account";

function Status({ text, error }: { text: string; error?: boolean }) {
  return <p className={error ? "auth-error" : "muted small"}>{text}</p>;
}

function Login() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const sent = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || sent.current) return;
    sent.current = true;
    setStatus("Signing you in…");
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        location.href = next;
      } catch (e) {
        sent.current = false;
        setStatus("");
        setError(`Sign-in failed: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    })();
  }, [ready, authenticated, getAccessToken]);

  if (!ready) return <Status text="Loading…" />;
  return (
    <div>
      <button className="btn" type="button" onClick={() => { setError(""); login(); }} disabled={!!status}>
        {status ? status : "Continue with email, Google or wallet"}
      </button>
      {error && <Status text={error} error />}
    </div>
  );
}

function Logout() {
  const { ready, logout } = usePrivy();
  useEffect(() => {
    if (!ready) return;
    (async () => {
      await logout().catch(() => undefined);
      await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
      location.href = "/";
    })();
  }, [ready, logout]);
  return <Status text="Signing you out…" />;
}

createRoot(root).render(
  <StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "light", accentColor: "#2f4bff", logo: `${location.origin}/logo.svg`, landingHeader: "Sign in to Xanax" },
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
      }}
    >
      {mode === "logout" ? <Logout /> : <Login />}
    </PrivyProvider>
  </StrictMode>,
);
