"use client";
import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { passkeyClient, magicLinkClient } from "better-auth/client/plugins";

const client = createAuthClient({ plugins: [passkeyClient(), magicLinkClient()] });

const css = `
:root{--bg:#0d1620;--glass:rgba(16,26,38,.6);--gline:rgba(255,255,255,.1);--ink:#fff;--dim:#c4cbd6;--mute:#8b95a3;--amber:#f8b800;--teal:#00d2be;--crit:#e5484d;--e2:0 24px 70px rgba(0,0,0,.5);--ease:cubic-bezier(.16,.84,.32,1)}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}
.ground{position:fixed;inset:0;z-index:0}
.ground .ly{position:absolute;inset:0;background:url(/events/img/dusk.jpg) center 40%/cover no-repeat;transform:scale(1.04)}
.ground .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,22,32,.6),rgba(13,22,32,.52) 40%,rgba(13,22,32,.76))}
.rule{height:4px;position:relative;z-index:2;background:linear-gradient(90deg,var(--amber) 0 25%,var(--teal) 25% 50%,#005185 50% 75%,var(--mute) 75% 100%)}
main{position:relative;z-index:1;min-height:calc(100vh - 4px);min-height:calc(100dvh - 4px);display:flex;align-items:center;justify-content:center;padding:40px 20px calc(40px + env(safe-area-inset-bottom))}
.card{width:100%;max-width:440px;padding:32px 34px 30px;border-radius:24px;background:var(--glass);-webkit-backdrop-filter:blur(18px) saturate(1.35);backdrop-filter:blur(18px) saturate(1.35);border:1px solid var(--gline);box-shadow:var(--e2)}
.mark{height:38px;width:auto;margin-bottom:16px;display:block}
.eyebrow{font-size:11.5px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:var(--teal)}
h1{font-family:"Arial Black",Helvetica,Arial,sans-serif;margin:8px 0 0;font-size:clamp(26px,6vw,34px);line-height:1.03;letter-spacing:-.02em}
h1 .a{color:var(--amber)}
p.lede{color:var(--dim);font-size:14.5px;margin:12px 0 0}
.stack{margin-top:20px;display:flex;flex-direction:column;gap:12px}
input{width:100%;font:inherit;font-size:16px;color:var(--ink);background:rgba(255,255,255,.06);border:1px solid var(--gline);border-radius:12px;padding:13px 15px}
input::placeholder{color:var(--mute)}
input:focus{outline:none;border-color:rgba(248,184,0,.55)}
button{font:inherit;font-weight:800;font-size:15px;border:0;border-radius:999px;padding:14px 22px;cursor:pointer;transition:transform .18s var(--ease)}
button:hover{transform:translateY(-2px)}
button:disabled{opacity:.55;pointer-events:none}
.primary{color:#151000;background:var(--amber);box-shadow:0 10px 34px -12px rgba(248,184,0,.55)}
.ghost{color:var(--ink);background:rgba(255,255,255,.05);border:1px solid var(--gline)}
.tealb{color:#04211d;background:var(--teal)}
.err{color:var(--crit);font-size:13px;display:block}
.ok{color:var(--teal);font-size:13.5px}
.fine{margin:16px 0 0;font-size:12px;color:var(--mute);line-height:1.6}
.row{display:flex;gap:10px;align-items:center}
.row hr{flex:1;border:0;border-top:1px solid var(--gline)}
.row span{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mute);font-weight:700}
.who{display:flex;align-items:center;gap:10px;margin-top:14px;padding:12px 16px;border-radius:12px;background:rgba(0,210,190,.08);border:1px solid rgba(0,210,190,.3);font-size:14px;color:var(--dim)}
.dot2{width:8px;height:8px;border-radius:50%;background:var(--teal);box-shadow:0 0 8px var(--teal)}
@media (prefers-reduced-motion:reduce){button:hover{transform:none}}
`;

export default function Portal() {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");

  async function refresh() {
    try {
      const s = await client.getSession();
      setSession(s?.data ?? null);
    } catch {
      setSession(null);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  const fail = (m) => setMsg({ bad: true, t: m });
  const good = (m) => setMsg({ bad: false, t: m });

  async function magic() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Add a complete email first.");
    setBusy("magic");
    const { error } = await client.signIn.magicLink({ email, callbackURL: "/portal" });
    setBusy("");
    error
      ? fail("Could not send the link. Try again in a minute.")
      : good("Link sent. Check your email on this device and tap it.");
  }
  async function pkey() {
    setBusy("pk");
    const res = await client.signIn.passkey();
    setBusy("");
    res?.error ? fail("No passkey on this device yet. Sign in another way first, then add one.") : refresh();
  }
  async function pwSignIn() {
    if (!email || !pw) return fail("Email and password, then try again.");
    setBusy("pw");
    const { error } = await client.signIn.email({ email, password: pw });
    setBusy("");
    error ? fail("That sign-in did not match.") : refresh();
  }
  async function addPasskey() {
    setBusy("addpk");
    const res = await client.passkey.addPasskey({ name: "This device" });
    setBusy("");
    res?.error ? fail("Could not add a passkey here.") : good("Passkey saved. Next time, one tap.");
  }
  async function signOut() {
    await client.signOut();
    refresh();
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="rule" />
      <div className="ground" aria-hidden>
        <div className="ly" />
        <div className="veil" />
      </div>
      <main>
        <div className="card">
          <img className="mark" src="/brand/pg-mark.png" alt="PaddockGavin" />
          {!session ? (
            <>
              <div className="eyebrow">Paddock Experience · Portal</div>
              <h1>
                Sign in,
                <br />
                <span className="a">your way</span>
              </h1>
              <p className="lede">
                One account for your submissions, your booth, your passes. Face ID and fingerprint
                sign-in works here once you add a passkey.
              </p>
              <div className="stack">
                <button className="tealb" onClick={pkey} disabled={!!busy}>
                  {busy === "pk" ? "Waiting for your device…" : "Sign in with Face ID / fingerprint"}
                </button>
                <div className="row">
                  <hr />
                  <span>or</span>
                  <hr />
                </div>
                <input
                  type="email"
                  autoComplete="username webauthn"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="primary" onClick={magic} disabled={!!busy}>
                  {busy === "magic" ? "Sending…" : "Email me a sign-in link"}
                </button>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password (staff and early accounts)"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                <button className="ghost" onClick={pwSignIn} disabled={!!busy}>
                  {busy === "pw" ? "Checking…" : "Sign in with password"}
                </button>
                {msg && <span className={msg.bad ? "err" : "ok"}>{msg.t}</span>}
              </div>
              <p className="fine">
                No account? Submitting a car, booth, or club application creates your record; the
                first sign-in with that email claims it.
              </p>
            </>
          ) : (
            <>
              <div className="eyebrow">Paddock Experience · Portal</div>
              <h1>
                You are
                <br />
                <span className="a">in</span>
              </h1>
              <div className="who">
                <span className="dot2" />
                <span>
                  Signed in as <b>{session.user?.email}</b>
                </span>
              </div>
              <div className="stack">
                <button className="tealb" onClick={addPasskey} disabled={!!busy}>
                  {busy === "addpk" ? "Waiting for your device…" : "Add Face ID / fingerprint to this device"}
                </button>
                <button className="ghost" onClick={signOut}>
                  Sign out
                </button>
                {msg && <span className={msg.bad ? "err" : "ok"}>{msg.t}</span>}
              </div>
              <p className="fine">
                Your submissions, booth, and payment history connect here as the portal build
                lands. Passkeys are per-device and sync through iCloud Keychain and Google
                Password Manager.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
