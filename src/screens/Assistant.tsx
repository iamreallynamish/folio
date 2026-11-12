import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../ctx.ts";
import { Icon } from "../ui/Icon.tsx";
import { LogoMark } from "../ui/Logo.tsx";
import { Provenance } from "../ui/kit.tsx";
import { TypeIn } from "../ui/Reveal.tsx";
import { Reveal } from "../ui/Reveal.tsx";

interface Msg { role: "user" | "assistant"; text: string; answer?: any; fresh?: boolean }
const SUGGESTIONS = ["How much did I spend this month?", "Which merchants do I spend the most with?", "Where does my money go?", "How much scholarship money have I received?", "Am I within budget?", "How are my investments performing?"];

export function Assistant() {
  const { user, go } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem("folio-chat") ?? "[]"); } catch { return []; } });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { sessionStorage.setItem("folio-chat", JSON.stringify(msgs.slice(-30).map(({ fresh, ...m }) => m))); end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question.trim() }]);
    setInput(""); setBusy(true);
    try {
      const { answer } = await api("/assistant", { body: { question, history, ai } });
      setMsgs((m) => [...m.map((x) => ({ ...x, fresh: false })), { role: "assistant", text: answer.text, answer, fresh: true }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: e.message, answer: { provenance: "none" } }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="screen" style={{ minHeight: "calc(100dvh - 140px)" }}>
      <header className="screen-head">
        <Reveal as="h1" className="large-title" text="Ask Folio" once="title-assistant" />
        {msgs.length > 0 && <div className="actions"><button className="btn small gray" onClick={() => setMsgs([])}>Clear</button></div>}
      </header>

      {msgs.length === 0 && (
        <div className="stack" style={{ alignItems: "center", textAlign: "center", padding: "12px 0", gap: 10 }}>
          <LogoMark size={52} />
          <p className="subhead muted" style={{ maxWidth: 420 }}>Ask about your spending, budgets, income, scholarships and investments. Answers are worked out from your own records and say how they were produced.</p>
          <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 6 }}><Provenance kind="verified" /><Provenance kind="estimate" /><Provenance kind="ai" /></div>
        </div>
      )}

      <div className="chat grow" aria-live="polite">
        {msgs.map((m, i) => m.role === "user" ? <div key={i} className="bubble me text">{m.text}</div> : (
          <div key={i} className="bubble bot">
            {m.answer && m.answer.provenance !== "none" && <div><Provenance kind={m.answer.provenance} /></div>}
            {m.fresh ? <TypeIn text={m.text} /> : <div className="text">{m.text}</div>}
            {m.answer?.facts?.length > 0 && <dl className="facts">{m.answer.facts.map((f: any, j: number) => <div key={j} style={{ display: "contents" }}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
            {m.answer?.note && <div className="caption faint" style={{ whiteSpace: "normal" }}>{m.answer.note}</div>}
            {m.answer?.provenance === "none" && !user.hasAssistantKey && m.answer?.suggestions && <button className="btn plain small" style={{ alignSelf: "flex-start", padding: 0 }} onClick={() => go("settings")}>Open Settings</button>}
          </div>
        ))}
        {busy && <div className="bubble bot typing" aria-label="Working"><span><i /><i /><i /></span></div>}
        <div ref={end} />
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          {user.hasAssistantKey && (
            <button type="button" className="chip" aria-pressed={ai} onClick={() => setAi(!ai)} title="Send every question to Claude for a written, AI-generated answer" style={{ alignSelf: "center", flex: "none" }}><Icon name="spark" style={{ width: 13, height: 13 }} />AI</button>
          )}
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your money" aria-label="Question" />
          <button className="send" disabled={!input.trim() || busy} aria-label="Send"><Icon name="up" /></button>
        </form>
      </div>
    </div>
  );
}
