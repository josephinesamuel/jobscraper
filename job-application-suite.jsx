import { useState, useRef } from "react";

const PROXY = "http://localhost:3001";
const STEPS = ["Scrape Jobs", "Upload CV", "AI Analysis", "Create Docs", "Log to Sheet"];

function Badge({ color = "gray", children }) {
  const map = {
    blue:  { bg: "var(--color-background-info)",    txt: "var(--color-text-info)"    },
    green: { bg: "var(--color-background-success)",  txt: "var(--color-text-success)" },
    amber: { bg: "var(--color-background-warning)",  txt: "var(--color-text-warning)" },
    red:   { bg: "var(--color-background-danger)",   txt: "var(--color-text-danger)"  },
    gray:  { bg: "var(--color-background-secondary)",txt: "var(--color-text-secondary)"},
  };
  const s = map[color] || map.gray;
  return <span style={{ background: s.bg, color: s.txt, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{children}</span>;
}

function Card({ children, style }) {
  return <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", ...style }}>{children}</div>;
}

function Label({ children }) {
  return <p style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>{children}</p>;
}

function Spinner() {
  return <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid var(--color-border-secondary)", borderTopColor: "var(--color-text-secondary)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

function Input({ value, onChange, placeholder, type = "text", style }) {
  return <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{ width: "100%", fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box", ...style }} />;
}

function PrimaryBtn({ onClick, disabled, loading, children, style }) {
  return <button onClick={onClick} disabled={disabled || loading} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 6, border: "0.5px solid var(--color-border-primary)", background: "var(--color-text-primary)", color: "var(--color-background-primary)", cursor: disabled || loading ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, opacity: disabled ? 0.5 : 1, ...style }}>{loading && <Spinner />}{children}</button>;
}

function GhostBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>{children}</button>;
}

function StepBar({ current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "1.5rem" }}>
      {STEPS.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 68 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: done ? "var(--color-text-success)" : active ? "var(--color-text-primary)" : "var(--color-background-secondary)", border: `0.5px solid ${done ? "var(--color-border-success)" : active ? "var(--color-border-primary)" : "var(--color-border-secondary)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, color: done || active ? "var(--color-background-primary)" : "var(--color-text-tertiary)", transition: "all 0.2s" }}>{done ? "✓" : i + 1}</div>
              <span style={{ fontSize: 10, fontWeight: active ? 500 : 400, color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)", textAlign: "center" }}>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, margin: "0 2px 20px", background: done ? "var(--color-border-success)" : "var(--color-border-tertiary)", transition: "background 0.3s" }} />}
          </div>
        );
      })}
    </div>
  );
}

function JobRow({ job, selected, onSelect, onAnalyze }) {
  return (
    <div onClick={() => onSelect(job)} style={{ background: selected ? "var(--color-background-info)" : "var(--color-background-secondary)", border: `0.5px solid ${selected ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`, borderRadius: "var(--border-radius-md)", padding: "10px 12px", cursor: "pointer", transition: "all 0.15s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 500, fontSize: 13, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.title}</p>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0 }}>{job.company} · {job.location}</p>
          {job.salary && <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "3px 0 0" }}>{job.salary}</p>}
        </div>
        <button onClick={e => { e.stopPropagation(); onAnalyze(job); }} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", cursor: "pointer", color: "var(--color-text-primary)", flexShrink: 0 }}>Analyze ↗</button>
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep]               = useState(0);
  const [proxyOk, setProxyOk]         = useState(null);
  const [checking, setChecking]       = useState(false);
  const [query, setQuery]             = useState("Software Engineer");
  const [location, setLocation]       = useState("Berlin");
  const [maxJobs, setMaxJobs]         = useState(10);
  const [scraping, setScraping]       = useState(false);
  const [jobs, setJobs]               = useState([]);
  const [scrapeErr, setScrapeErr]     = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [cvText, setCvText]           = useState("");
  const fileRef = useRef();
  const [analyzing, setAnalyzing]     = useState(false);
  const [analysis, setAnalysis]       = useState(null);
  const [activeJob, setActiveJob]     = useState(null);
  const [aiErr, setAiErr]             = useState("");
  const [googleToken, setGoogleToken] = useState("");
  const [creatingDocs, setCreatingDocs] = useState(false);
  const [docs, setDocs]               = useState(null);
  const [docErr, setDocErr]           = useState("");
  const [logging, setLogging]         = useState(false);
  const [logDone, setLogDone]         = useState(false);
  const [tracker, setTracker]         = useState([]);
  const [logErr, setLogErr]           = useState("");

  async function handleCheckProxy() {
    setChecking(true);
    try { const r = await fetch(`${PROXY}/health`); setProxyOk(r.ok); }
    catch { setProxyOk(false); }
    finally { setChecking(false); }
  }

  async function scrapeJobs() {
    setScraping(true); setScrapeErr(""); setJobs([]);
    try {
      const startRes = await fetch(`${PROXY}/scrape`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, location, maxResults: maxJobs }) });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Scrape start failed");
      const runId = startData.runId;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const pollData = await (await fetch(`${PROXY}/scrape/status/${runId}`)).json();
        if (pollData.status === "SUCCEEDED") break;
        if (pollData.status === "FAILED" || pollData.status === "ABORTED") throw new Error(`Run ${pollData.status}`);
      }
      const resultsRes = await fetch(`${PROXY}/scrape/results/${runId}`);
      const items = await resultsRes.json();
      if (!resultsRes.ok) throw new Error(items.error);
      setJobs(items);
      if (items.length) setStep(1); else setScrapeErr("No jobs found.");
    } catch (e) { setScrapeErr(e.message); }
    finally { setScraping(false); }
  }

  function loadDemoJobs() {
    setJobs([
      { id: "d1", title: "Senior Frontend Engineer", company: "N26", location: "Berlin, Germany", salary: "€80k–€110k", url: "https://n26.com/careers", description: "Senior Frontend Engineer. Stack: React, TypeScript, GraphQL, Jest, Storybook. Own features end to end, collaborate with design, clean maintainable code. CI/CD with GitHub Actions. Agile. Nice to have: fintech, A11y, performance profiling." },
      { id: "d2", title: "Full-Stack Developer", company: "Zalando", location: "Berlin, Germany", salary: "€70k–€95k", url: "https://jobs.zalando.com", description: "Platform team. Node.js, React, Kotlin microservices, AWS, Kubernetes. REST APIs, Docker, PostgreSQL, event-driven architecture with Kafka. Strong CS fundamentals required." },
      { id: "d3", title: "React Engineer", company: "Delivery Hero", location: "Berlin / Remote", salary: "€65k–€90k", url: "https://careers.deliveryhero.com", description: "Consumer-facing features for food delivery app. React, Redux Toolkit, React Query, TypeScript, Playwright E2E. Mobile-first design, performance budgets, internationalization." },
    ]);
    setStep(1);
  }

  async function analyzeJob(job) {
    if (!cvText.trim()) { setAiErr("Paste your CV first (Step 2)."); setStep(1); return; }
    setActiveJob(job); setAnalyzing(true); setAiErr(""); setAnalysis(null); setStep(2);
    try {
      const res = await fetch(`${PROXY}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobDescription: job.description, cvText, company: job.company, jobTitle: job.title }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data); setStep(3);
    } catch (e) { setAiErr(e.message); }
    finally { setAnalyzing(false); }
  }

  async function createDocs() {
    if (!googleToken.trim()) { setDocErr("Paste your Google access token first."); return; }
    setCreatingDocs(true); setDocErr("");
    try {
      const cvContent = [analysis.cvTitle, "", "PROFESSIONAL SUMMARY", analysis.cvSummary, "", "SKILLS", analysis.skillsSection, "", "EXPERIENCE IMPROVEMENTS", ...(analysis.experienceImprovements || []), "", "PROJECT IMPROVEMENTS", ...(analysis.projectImprovements || []), "", "ADDITIONAL KEYWORDS", (analysis.additionalKeywords || []).join(", ")].join("\n");
      const [cvRes, coverRes] = await Promise.all([
        fetch(`${PROXY}/docs/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `CV — ${activeJob.company} — ${activeJob.title}`, content: cvContent, accessToken: googleToken }) }),
        fetch(`${PROXY}/docs/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Cover Letter — ${activeJob.company} — ${activeJob.title}`, content: analysis.coverLetter || "", accessToken: googleToken }) }),
      ]);
      const cvData = await cvRes.json(); const coverData = await coverRes.json();
      if (!cvRes.ok) throw new Error(cvData.error); if (!coverRes.ok) throw new Error(coverData.error);
      setDocs({ cvUrl: cvData.url, coverUrl: coverData.url }); setStep(4);
    } catch (e) { setDocErr(e.message); }
    finally { setCreatingDocs(false); }
  }

  async function logToSheet() {
    setLogging(true); setLogErr("");
    try {
      const row = [new Date().toLocaleDateString("en-GB"), activeJob.company, activeJob.title, activeJob.location, "Applied", docs.cvUrl, docs.coverUrl, activeJob.url || ""];
      const res = await fetch(`${PROXY}/sheets/append`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ row, accessToken: googleToken }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTracker(prev => [...prev, { date: row[0], company: row[1], title: row[2], status: row[4], cvUrl: row[5], coverUrl: row[6], jobUrl: row[7] }]);
      setLogDone(true);
    } catch (e) { setLogErr(e.message); }
    finally { setLogging(false); }
  }

  function handleFile(e) {
    const f = e.target.files[0]; if (!f) return;
    new FileReader().onload = ev => setCvText(ev.target.result);
    const r = new FileReader(); r.onload = ev => setCvText(ev.target.result); r.readAsText(f);
  }

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", padding: "1rem 0", maxWidth: 720, margin: "0 auto" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontWeight: 500, fontSize: 20 }}>Job Application Suite</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>Scrape LinkedIn → AI CV analysis → Google Docs → Tracker sheet</p>
      </div>

      {/* Proxy status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.25rem", padding: "10px 14px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: proxyOk === true ? "var(--color-text-success)" : proxyOk === false ? "var(--color-text-danger)" : "var(--color-text-tertiary)" }} />
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", flex: 1 }}>
          {proxyOk === true ? "Proxy connected — all APIs ready" : proxyOk === false ? "Proxy not found — open your terminal and run: npm start (in job-suite-proxy folder)" : "Start your local proxy first, then click Check"}
        </span>
        <button onClick={handleCheckProxy} disabled={checking} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", cursor: "pointer", color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
          {checking && <Spinner />}{checking ? "Checking..." : "Check connection"}
        </button>
      </div>

      <StepBar current={step} />

      {/* Step 0 — Scrape */}
      <Card style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Label>1 — LinkedIn Job Search (Apify)</Label>
          {jobs.length > 0 && <Badge color="green">{jobs.length} jobs loaded</Badge>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 8, marginBottom: 10 }}>
          <div><p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "0 0 3px" }}>Keywords</p><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Frontend Engineer" /></div>
          <div><p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "0 0 3px" }}>Location</p><Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Berlin" /></div>
          <div><p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "0 0 3px" }}>Max</p><Input type="number" value={maxJobs} onChange={e => setMaxJobs(Number(e.target.value))} /></div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <PrimaryBtn onClick={scrapeJobs} loading={scraping}>{scraping ? "Scraping..." : "Scrape via Apify"}</PrimaryBtn>
          <GhostBtn onClick={loadDemoJobs}>Load demo jobs</GhostBtn>
        </div>
        {scrapeErr && <p style={{ fontSize: 12, color: "var(--color-text-danger)", margin: "8px 0 0" }}>⚠ {scrapeErr}</p>}
      </Card>

      {jobs.length > 0 && (
        <Card style={{ marginBottom: "1rem" }}>
          <Label>Scraped jobs — click Analyze ↗ on any job</Label>
          <div style={{ display: "grid", gap: 6 }}>
            {jobs.map(job => <JobRow key={job.id} job={job} selected={selectedJob?.id === job.id} onSelect={setSelectedJob} onAnalyze={j => { setStep(1); setTimeout(() => analyzeJob(j), 50); }} />)}
          </div>
        </Card>
      )}

      {/* Step 1 — CV */}
      {step >= 1 && (
        <Card style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Label>2 — Your CV</Label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => fileRef.current?.click()} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "transparent", cursor: "pointer", color: "var(--color-text-secondary)" }}>Upload .txt</button>
              <input ref={fileRef} type="file" accept=".txt,.md" onChange={handleFile} style={{ display: "none" }} />
              {cvText && <Badge color="green">CV ready</Badge>}
            </div>
          </div>
          <textarea value={cvText} onChange={e => setCvText(e.target.value)} placeholder="Paste your CV here as plain text..." style={{ width: "100%", height: 150, fontSize: 12, lineHeight: 1.7, padding: 8, borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", resize: "vertical", boxSizing: "border-box", fontFamily: "var(--font-mono)" }} />
        </Card>
      )}

      {/* Step 2 — Analysis */}
      {(analyzing || analysis || aiErr) && (
        <Card style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <Label>3 — AI Analysis{activeJob ? ` — ${activeJob.company}` : ""}</Label>
            {analyzing && <Spinner />}
          </div>
          {analyzing && <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>Analyzing job vs your CV...</p>}
          {aiErr && <p style={{ fontSize: 12, color: "var(--color-text-danger)" }}>⚠ {aiErr}</p>}
          {analysis && !analyzing && (
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 6px" }}>ATS keywords</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{(analysis.atsKeywords || []).map(k => <Badge key={k} color="blue">{k}</Badge>)}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 6px", color: "var(--color-text-success)" }}>✓ You have</p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>{(analysis.have || []).map((h, i) => <li key={i}>{h}</li>)}</ul>
                </div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 6px", color: "var(--color-text-danger)" }}>✗ Missing</p>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>{(analysis.missing || []).map((m, i) => <li key={i}>{m}</li>)}</ul>
                </div>
              </div>
              <div><p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 5px" }}>Optimized title</p><div style={{ background: "var(--color-background-secondary)", borderRadius: 6, padding: "8px 10px", fontSize: 13, fontWeight: 500 }}>{analysis.cvTitle}</div></div>
              <div><p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 5px" }}>Summary (copy-paste)</p><div style={{ background: "var(--color-background-secondary)", borderRadius: 6, padding: "8px 10px", fontSize: 12, lineHeight: 1.8, color: "var(--color-text-secondary)" }}>{analysis.cvSummary}</div></div>
              {(analysis.experienceImprovements || []).length > 0 && (
                <div><p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 5px" }}>Experience improvements</p><ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>{analysis.experienceImprovements.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
              )}
              <div><p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 5px" }}>Cover letter</p><div style={{ background: "var(--color-background-secondary)", borderRadius: 6, padding: "10px 12px", fontSize: 12, lineHeight: 1.9, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>{analysis.coverLetter}</div></div>
            </div>
          )}
        </Card>
      )}

      {/* Step 3 — Google Docs */}
      {analysis && !analyzing && (
        <Card style={{ marginBottom: "1rem" }}>
          <Label>4 — Create Google Docs</Label>
          <div style={{ background: "var(--color-background-secondary)", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 4px" }}>Get your Google access token (2 min):</p>
            <ol style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              <li>Go to <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" style={{ color: "var(--color-text-info)" }}>developers.google.com/oauthplayground</a></li>
              <li>In the list, find and select <strong>Google Docs API v1</strong> + <strong>Google Sheets API v4</strong></li>
              <li>Click <strong>Authorize APIs</strong> → sign in with your Google account</li>
              <li>Click <strong>Exchange authorization code for tokens</strong></li>
              <li>Copy the <strong>Access token</strong> and paste below</li>
            </ol>
          </div>
          <Input value={googleToken} onChange={e => setGoogleToken(e.target.value)} placeholder="Paste your Google access token here..." style={{ marginBottom: 10 }} />
          <PrimaryBtn onClick={createDocs} loading={creatingDocs} disabled={!analysis}>{creatingDocs ? "Creating docs..." : "Create Google Docs →"}</PrimaryBtn>
          {docErr && <p style={{ fontSize: 12, color: "var(--color-text-danger)", margin: "8px 0 0" }}>⚠ {docErr}</p>}
        </Card>
      )}

      {/* Step 4 — Log */}
      {docs && (
        <Card style={{ marginBottom: "1rem" }}>
          <Label>5 — Docs created → append to tracker sheet</Label>
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {[{ label: "Optimized CV", url: docs.cvUrl }, { label: "Cover Letter", url: docs.coverUrl }].map(({ label, url }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 6, border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
                  <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "2px 0 0", fontFamily: "var(--font-mono)", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</p>
                </div>
                <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "0.5px solid var(--color-border-secondary)", textDecoration: "none", color: "var(--color-text-primary)", background: "var(--color-background-primary)" }}>Open ↗</a>
              </div>
            ))}
          </div>
          <PrimaryBtn onClick={logToSheet} loading={logging} disabled={logDone} style={logDone ? { background: "var(--color-background-success)", color: "var(--color-text-success)", border: "0.5px solid var(--color-border-success)" } : {}}>
            {logDone ? "✓ Logged to sheet" : "Append to Google Sheet →"}
          </PrimaryBtn>
          {logErr && <p style={{ fontSize: 12, color: "var(--color-text-danger)", margin: "8px 0 0" }}>⚠ {logErr}</p>}
        </Card>
      )}

      {tracker.length > 0 && (
        <Card>
          <Label>Application tracker</Label>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "0.5px solid var(--color-border-secondary)" }}>
                {["Date","Company","Role","Status","CV","Cover Letter","Job"].map(h => <th key={h} style={{ padding: "5px 8px", fontWeight: 500, color: "var(--color-text-secondary)", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {tracker.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "6px 8px", color: "var(--color-text-secondary)" }}>{row.date}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 500 }}>{row.company}</td>
                    <td style={{ padding: "6px 8px", color: "var(--color-text-secondary)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</td>
                    <td style={{ padding: "6px 8px" }}><Badge color="amber">{row.status}</Badge></td>
                    <td style={{ padding: "6px 8px" }}><a href={row.cvUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-text-info)" }}>CV ↗</a></td>
                    <td style={{ padding: "6px 8px" }}><a href={row.coverUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-text-info)" }}>Letter ↗</a></td>
                    <td style={{ padding: "6px 8px" }}>{row.jobUrl ? <a href={row.jobUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-text-info)" }}>View ↗</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
