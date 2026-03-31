require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const path    = require("path");
const fs      = require("fs");

const app  = express();
const PORT = process.env.PORT || 3001;
const ENV_PATH = path.join(__dirname, ".env");

// ── Runtime key store ─────────────────────────────────────────────
const keys = {
  apify:        process.env.APIFY_TOKEN       || "",
  anthropic:    process.env.ANTHROPIC_KEY     || "",
  sheetId:      process.env.GOOGLE_SHEET_ID   || "",
  gclientId:    process.env.GOOGLE_CLIENT_ID  || "",
  gclientSecret:process.env.GOOGLE_CLIENT_SECRET || "",
  grefreshToken:process.env.GOOGLE_REFRESH_TOKEN || "",
  cvDocId:      process.env.CV_DOC_ID           || "",
};

// In-memory access token cache
let googleAccessToken = null;
let googleTokenExpiry = 0;

// ── Persist a key to .env file ────────────────────────────────────
function saveToEnv(keyName, value) {
  try {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    const line  = `${keyName}=${value}`;
    const regex = new RegExp(`^${keyName}=.*$`, "m");
    content = regex.test(content) ? content.replace(regex, line) : content + "\n" + line;
    fs.writeFileSync(ENV_PATH, content.trim() + "\n");
  } catch(e) { console.error("Could not save to .env:", e.message); }
}

// ── Get a valid Google access token (auto-refresh) ────────────────
async function getGoogleToken() {
  // Return cached token if still valid (with 60s buffer)
  if (googleAccessToken && Date.now() < googleTokenExpiry - 60000) {
    return googleAccessToken;
  }
  if (!keys.grefreshToken) return null;
  if (!keys.gclientId || !keys.gclientSecret) return null;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     keys.gclientId,
      client_secret: keys.gclientSecret,
      refresh_token: keys.grefreshToken,
      grant_type:    "refresh_token",
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error("Token refresh failed: " + (data.error_description || data.error || "unknown"));
  }
  googleAccessToken = data.access_token;
  googleTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return googleAccessToken;
}

// ── Parse a posted date into "DD/MM/YYYY" stored as plain text ───
function parsePostedDate(val) {
  if (!val) return "";
  // Handle Unix timestamps: LinkedIn uses ms, some actors use seconds
  let d;
  if (typeof val === "number" || /^\d{9,13}$/.test(String(val))) {
    const n = Number(val);
    d = new Date(n > 1e10 ? n : n * 1000); // seconds → ms if needed
  } else {
    d = new Date(val);
  }
  if (isNaN(d.getTime())) return String(val);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ── Middleware ────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Health ────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({
  status: "ok",
  port: PORT,
  googleAuth: !!keys.grefreshToken,
}));

// ── Google OAuth status ───────────────────────────────────────────
app.get("/auth/status", (_, res) => {
  res.json({
    connected: !!keys.grefreshToken,
    hasClientId: !!keys.gclientId,
    hasClientSecret: !!keys.gclientSecret,
  });
});

// ── Step 1: redirect browser to Google consent screen ────────────
app.get("/auth/google", (req, res) => {
  if (!keys.gclientId) return res.status(400).send("GOOGLE_CLIENT_ID not set in .env");
  const params = new URLSearchParams({
    client_id:     keys.gclientId,
    redirect_uri:  `http://localhost:${PORT}/auth/google/callback`,
    response_type: "code",
    scope:         "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive",
    access_type:   "offline",
    prompt:        "consent",   // force refresh_token to be returned
  });
  res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params);
});

// ── Step 2: handle callback, exchange code for tokens ────────────
app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("No code returned from Google.");
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     keys.gclientId,
        client_secret: keys.gclientSecret,
        redirect_uri:  `http://localhost:${PORT}/auth/google/callback`,
        grant_type:    "authorization_code",
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.refresh_token) {
      return res.status(400).send("OAuth failed: " + (data.error_description || JSON.stringify(data)));
    }
    // Store refresh token in memory + .env
    keys.grefreshToken = data.refresh_token;
    googleAccessToken  = data.access_token;
    googleTokenExpiry  = Date.now() + (data.expires_in || 3600) * 1000;
    saveToEnv("GOOGLE_REFRESH_TOKEN", data.refresh_token);

    // Redirect back to app with success
    res.send(`
      <html><body style="font-family:sans-serif;background:#0f0f11;color:#f0eff4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
          <p style="font-size:32px;margin-bottom:12px;">✅</p>
          <p style="font-size:18px;font-weight:600;margin-bottom:8px;">Google account connected!</p>
          <p style="color:#9a99a8;margin-bottom:20px;">Your refresh token has been saved. You won't need to log in again.</p>
          <a href="/" style="background:#7c6af7;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;">← Back to JobCraft</a>
        </div>
      </body></html>
    `);
  } catch(e) {
    res.status(500).send("Error: " + e.message);
  }
});

// ── Save API keys from UI ─────────────────────────────────────────
app.post("/keys", (req, res) => {
  const { apify, anthropic, sheetId, gclientId, gclientSecret } = req.body;
  if (apify)         { keys.apify         = apify;         saveToEnv("APIFY_TOKEN", apify); }
  if (anthropic)     { keys.anthropic     = anthropic;     saveToEnv("ANTHROPIC_KEY", anthropic); }
  if (sheetId)       { keys.sheetId       = sheetId;       saveToEnv("GOOGLE_SHEET_ID", sheetId); }
  if (gclientId)     { keys.gclientId     = gclientId;     saveToEnv("GOOGLE_CLIENT_ID", gclientId); }
  if (gclientSecret) { keys.gclientSecret = gclientSecret; saveToEnv("GOOGLE_CLIENT_SECRET", gclientSecret); }
  if (req.body.cvDocId)  { keys.cvDocId = req.body.cvDocId; saveToEnv("CV_DOC_ID", req.body.cvDocId); }
  res.json({ ok: true });
});

// ── Apify: start scrape ───────────────────────────────────────────
app.post("/scrape", async (req, res) => {
  const { urls, count = 10 } = req.body;
  if (!keys.apify) return res.status(400).json({ error: "Apify token not set. Go to API Keys." });
  if (!urls?.length) return res.status(400).json({ error: "At least one LinkedIn search URL is required." });
  try {
    const r = await fetch(
      `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs?token=${keys.apify}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, count, scrapeCompany: true }),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || data.error || "Apify error" });
    res.json({ runId: data.data?.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Apify: poll status ────────────────────────────────────────────
app.get("/scrape/status/:runId", async (req, res) => {
  try {
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${req.params.runId}?token=${keys.apify}`);
    const data = await r.json();
    const run  = data.data || {};
    if (run.status === "FAILED") {
      try {
        const logR    = await fetch(`https://api.apify.com/v2/actor-runs/${req.params.runId}/log?token=${keys.apify}&limit=20`);
        const logText = await logR.text();
        const lastLines = logText.split("\n").filter(Boolean).slice(-6).join(" | ");
        return res.json({ status: run.status, errorMessage: run.statusMessage || lastLines });
      } catch(_) {}
    }
    res.json({ status: run.status, errorMessage: run.statusMessage || "" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Apify: fetch results ──────────────────────────────────────────
app.get("/scrape/results/:runId", async (req, res) => {
  try {
    const r     = await fetch(`https://api.apify.com/v2/actor-runs/${req.params.runId}/dataset/items?token=${keys.apify}`);
    const items = await r.json();
    res.json(items.map(item => ({
      id:                   item.id || Math.random().toString(36).slice(2),
      // Core
      title:                item.title              || item.jobTitle        || "",
      standardizedTitle:    item.standardizedTitle  || "",
      company:              item.companyName        || item.company         || "",
      location:             item.location           || "",
      // Description
      description:          item.descriptionText    || item.description     || "",
      descriptionText:      item.descriptionText    || "",
      // URLs
      link:                 item.link               || "",           // LinkedIn job post URL
      url:                  item.url                || item.jobUrl   || item.link || "",
      applyUrl:             item.applyUrl           || "",           // external apply URL if any
      applyMethod:          item.applyMethod        || "",           // "SimpleOnsiteApply" = Easy Apply
      // Dates
      postedAt:             item.postedAt           || item.publishedAt || "",
      // Job details
      employmentType:       item.employmentType     || "",
      seniorityLevel:       item.seniorityLevel     || "",
      jobFunction:          item.jobFunction        || "",
      industries:           item.industries         || "",
      workplaceTypes:       item.workplaceTypes     || [],
      salary:               item.salary             || "",
      applicantsCount:      item.applicantsCount    || "",
      // Hiring manager
      jobPosterName:        item.jobPosterName      || "",
      jobPosterTitle:       item.jobPosterTitle     || "",
      jobPosterProfileUrl:  item.jobPosterProfileUrl|| "",
      // Company
      companyUrl:           item.companyLinkedinUrl || item.companyUrl || "",
      companyWebsite:       item.companyWebsite     || "",
      companyIndustry:      item.companyIndustry    || "",
      companySize:          String(item.companyEmployeesCount || item.companySize || ""),
      companyAddressLocality: item.companyAddress?.addressLocality || "",
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Claude AI analysis ────────────────────────────────────────────
app.post("/docs/create", async (req, res) => {
  const { title, content } = req.body;
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected. Go to API Keys and click Connect Google." });
    const cr  = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const doc = await cr.json();
    if (!cr.ok) return res.status(cr.status).json({ error: doc.error?.message });
    await fetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
    });
    res.json({ url: `https://docs.google.com/document/d/${doc.documentId}/edit`, docId: doc.documentId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Google Sheets: append single row (tracker) ────────────────────
app.post("/sheets/append-jobs", async (req, res) => {
  const { jobs } = req.body;
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set. Go to API Keys." });
  if (!jobs?.length) return res.status(400).json({ error: "No jobs to append." });

  const header = [
    "Company Name",
    "Position Title",
    "Job Description",
    "Apply URL",
    "LinkedIn Job URL",
    "Easy Apply?",
    "Date Posted",
    "City",
    "Hiring Status",
    "Hiring Manager",
    "Hiring Manager URL",
    "Seniority",
    "Employment Type",
    "Workplace Type",
    "Industry",
    "Applicants",
    "Adjusted CV Doc",
    "Cover Letter Link",
    "Status",
  ];

  const rows = jobs.map(j => {
    const isEasyApply = j.applyMethod === "SimpleOnsiteApply";
    const applyUrl    = isEasyApply
      ? j.link   // for easy apply, the apply action IS the LinkedIn link
      : (j.applyUrl || j.link || j.url || "");
    const linkedInUrl = j.link || j.url || "";
    const city        = j.companyAddressLocality || (j.location || "").split(",")[0].trim();
    const postedDate  = parsePostedDate(j.postedAt);
    const hiringMgr   = [j.jobPosterName, j.jobPosterTitle].filter(Boolean).join(" — ");

    return [
      j.company        || "",
      j.title || j.standardizedTitle || "",
      (j.descriptionText || j.description || "").slice(0, 5000),
      applyUrl,
      linkedInUrl,
      isEasyApply ? "Yes (Easy Apply)" : "No (External)",
      postedDate,
      city,
      "Open",
      hiringMgr,
      j.jobPosterProfileUrl || "",
      j.seniorityLevel      || "",
      j.employmentType      || "",
      Array.isArray(j.workplaceTypes) ? j.workplaceTypes.join(", ") : (j.workplaceTypes || ""),
      j.industries          || "",
      j.applicantsCount     || "",
      "", // Adjusted CV Doc
      "", // Cover Letter Link
      "", // Status
    ];
  });

  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected. Go to API Keys and click Connect Google." });

    // Get existing tabs
    const metaR  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${token}` } });
    const meta   = await metaR.json();
    if (!metaR.ok) return res.status(metaR.status).json({ error: meta.error?.message || "Cannot read spreadsheet" });
    const tabNames = (meta.sheets || []).map(s => s.properties.title);

    // Create RawData tab if missing
    if (!tabNames.includes("RawData")) {
      const addR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}:batchUpdate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "RawData" } } }] }),
      });
      const addData = await addR.json();
      if (!addR.ok) return res.status(addR.status).json({ error: addData.error?.message });
    }

    // Check if Jobs tab is empty → write header first
    const checkR   = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/RawData!A1`, { headers: { Authorization: `Bearer ${token}` } });
    const checkData = await checkR.json();
    const isEmpty   = !checkData.values || checkData.values.length === 0;
    const toWrite   = isEmpty ? [header, ...rows] : rows;

    // Append
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/RawData!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: toWrite }) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Sheets append error" });
    res.json({ success: true, rowsAdded: rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── Read CV from Google Doc (single-tab doc) ─────────────────────
app.get("/cv/read", async (req, res) => {
  if (!keys.cvDocId) return res.status(400).json({ error: "CV_DOC_ID not set. Add it in API Keys." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    const r = await fetch(
      `https://docs.googleapis.com/v1/documents/${keys.cvDocId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const doc = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: doc.error?.message });

    // Extract plain text from document body
    let fullText = "";
    for (const block of (doc.body?.content || [])) {
      if (block.paragraph) {
        for (const el of block.paragraph.elements || []) {
          if (el.textRun?.content) fullText += el.textRun.content;
        }
      }
    }

    res.json({
      docId: keys.cvDocId,
      title: doc.title,
      fullText: fullText.trim(),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Analyze CV + Job → generate keywords + analysis ──────────────
app.post("/cv/analyze-job", async (req, res) => {
  const { cvText, jobDescription, company, jobTitle } = req.body;
  if (!keys.anthropic) return res.status(400).json({ error: "Anthropic key not set." });
  if (!cvText || !jobDescription) return res.status(400).json({ error: "cvText and jobDescription required." });

  const prompt = `You are an expert ATS optimization specialist and tech recruiter.

MY CV (full text):
${cvText}

JOB DESCRIPTION:
${jobDescription}

Company: ${company}
Role: ${jobTitle}

Your task:
1. Extract the most important ATS keywords, skills, and phrases from the job description
2. Compare with my CV — identify what I already have and what is missing
3. Generate a list of ATS-optimized keywords to add to my CV's keyword section

Return ONLY a valid JSON object — no markdown, no backticks:
{
  "atsKeywords": ["20-30 highly relevant ATS keywords and phrases for this specific role"],
  "have": ["3-5 things I already have matching the JD"],
  "missing": ["3-5 things missing or weak"],
  "cvTitle": "optimized professional title for this role",
  "cvSummary": "3-sentence ATS-optimized professional summary for this role",
  "experienceImprovements": ["2-3 copy-paste bullet point improvements"],
  "keywordBlock": "A block of MAXIMUM 95 ATS keywords separated by spaces — these will REPLACE the keyword placeholder in my CV. Make them highly relevant to this specific job, diverse, and natural-looking. Include technical skills, methodologies, tools, and role-specific terms. STRICT LIMIT: do not exceed 95 words total. Format as plain space-separated text, no bullet points, no commas, no special characters.",
  "coverLetter": "150-250 word personalized cover letter for ${company}, role ${jobTitle}. Natural confident tone. Ready to send."
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": keys.anthropic, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message });
    const raw = data.content?.find(b => b.type === "text")?.text || "";
    res.json(JSON.parse(raw.replace(/```json|```/g, "").trim()));
  } catch(e) { res.status(500).json({ error: "Parse error: " + e.message }); }
});

// ── Create adjusted CV doc — Drive copy of single-tab CV doc + replace keywords ─
app.post("/cv/create-adjusted", async (req, res) => {
  const { keywordBlock, jobTitle, company } = req.body;
  if (!keys.cvDocId) return res.status(400).json({ error: "CV_DOC_ID not set." });
  if (!keywordBlock)  return res.status(400).json({ error: "keywordBlock required." });

  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    const title = `CV — ${company} — ${jobTitle}`;

    // Step 1: Copy the CV doc via Drive — preserves ALL formatting exactly
    const copyR = await fetch(
      `https://www.googleapis.com/drive/v3/files/${keys.cvDocId}/copy`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: title }),
      }
    );
    const copyData = await copyR.json();
    if (!copyR.ok) return res.status(copyR.status).json({ error: copyData.error?.message || "Failed to copy CV doc" });
    const newDocId = copyData.id;

    // Step 2: Read the copied doc body to find keyword placeholder indices
    const docR = await fetch(
      `https://docs.googleapis.com/v1/documents/${newDocId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const doc = await docR.json();
    if (!docR.ok) return res.status(docR.status).json({ error: doc.error?.message });

    const bodyContent = doc.body?.content || [];

    // Step 3: Find keyword placeholder start and end index
    let keywordStartIndex = -1;
    let keywordEndIndex   = -1;

    for (const block of bodyContent) {
      if (!block.paragraph) continue;
      for (const el of block.paragraph.elements || []) {
        const text = el.textRun?.content || "";
        if (text.toLowerCase().includes("keyword")) {
          if (keywordStartIndex === -1) keywordStartIndex = el.startIndex;
          keywordEndIndex = el.endIndex;
        } else if (keywordStartIndex !== -1 && text.trim().length > 0) {
          break;
        }
      }
    }

    if (keywordStartIndex === -1) {
      return res.status(400).json({ error: "No keyword placeholder found. Make sure your CV doc has lines containing 'keyword'." });
    }

    // Step 4: Delete placeholder + insert real keywords
    const updateR = await fetch(`https://docs.googleapis.com/v1/documents/${newDocId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          { deleteContentRange: { range: { startIndex: keywordStartIndex, endIndex: keywordEndIndex } } },
          { insertText: { location: { index: keywordStartIndex }, text: keywordBlock } },
        ]
      }),
    });
    const updateData = await updateR.json();
    if (!updateR.ok) return res.status(updateR.status).json({ error: updateData.error?.message || "Failed to replace keywords" });

    res.json({
      url: `https://docs.google.com/document/d/${newDocId}/edit`,
      docId: newDocId,
      title,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Read SSOT tab from Google Sheet ──────────────────────────────
app.get("/ssot/jobs", async (req, res) => {
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/UniqueNewJobs`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Could not read UniqueNewJobs tab" });

    const rows = data.values || [];
    if (rows.length < 2) return res.json({ jobs: [], headers: [] });

    const headers = rows[0].map(h => h.trim());
    const jobs = rows.slice(1).map((row, idx) => {
      const obj = { _rowIndex: idx + 2 }; // 1-based, +1 for header
      headers.forEach((h, i) => { obj[h] = row[i] || ""; });
      // Normalize to known field names for the UI
      return {
        _rowIndex:      obj._rowIndex,
        company:        obj["Company Name"]     || "",
        title:          obj["Position Title"]   || "",
        description:    obj["Job Description"]  || "",
        applyUrl:       obj["Apply URL"]        || "",
        linkedInUrl:    obj["LinkedIn Job URL"] || "",
        easyApply:      obj["Easy Apply?"]      || "",
        postedAt:       obj["Date Posted"]      || "",
        city:           obj["City"]             || "",
        hiringStatus:   obj["Hiring Status"]    || "",
        hiringManager:  obj["Hiring Manager"]   || "",
        seniority:      obj["Seniority"]        || "",
        employmentType: obj["Employment Type"]  || "",
        workplaceType:  obj["Workplace Type"]   || "",
        industry:       obj["Industry"]         || "",
        applicants:     obj["Applicants"]       || "",
        adjustedCvUrl:       obj["Adjusted CV"]             || "",
        coverLetterUrl:      obj["Cover Letter Link"]       || "",
        previouslyScraped:   obj["Previously Scraped"]      || "",
        oldAppStatus:        obj["Old Application Status"]  || "",
        priority:            obj["Priority"]                || "",
      };
    });
    res.json({ jobs, headers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Write Adjusted CV / Cover Letter link back to SSOT by company+title key ──
app.post("/ssot/update-links", async (req, res) => {
  const { company, title, adjustedCvUrl, coverLetterUrl } = req.body;
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  if (!company && !title) return res.status(400).json({ error: "company and title required." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    // Read full SSOT sheet
    const sheetR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const sheetData = await sheetR.json();
    if (!sheetR.ok) return res.status(sheetR.status).json({ error: sheetData.error?.message });

    const rows    = sheetData.values || [];
    if (!rows.length) return res.status(404).json({ error: "SSOT tab is empty." });

    const headers  = rows[0].map(h => (h||"").trim());
    const compCol  = headers.indexOf("Company Name");
    // Sheet uses "Title" not "Position Title"
    const titleCol = headers.indexOf("Title") >= 0 ? headers.indexOf("Title") : headers.indexOf("Position Title");
    // Sheet uses "Adjusted CV Doc" not "Adjusted CV"
    let   cvCol    = headers.indexOf("Adjusted CV Doc") >= 0 ? headers.indexOf("Adjusted CV Doc") : headers.indexOf("Adjusted CV");
    let   coverCol = headers.indexOf("Cover Letter Link");

    // Find matching row by company + title (case-insensitive)
    const targetComp  = (company||"").toLowerCase().trim();
    const targetTitle = (title||"").toLowerCase().trim();
    let   matchRow    = -1;

    for (let i = 1; i < rows.length; i++) {
      const c = (rows[i][compCol]  || "").toLowerCase().trim();
      const t = (rows[i][titleCol] || "").toLowerCase().trim();
      if (c === targetComp && t === targetTitle) { matchRow = i + 1; break; } // 1-based
    }

    if (matchRow === -1) {
      return res.json({ success: true, note: "Job not found in SSOT — link not saved." });
    }

    const missingCols = [];
    if (adjustedCvUrl && cvCol < 0)    missingCols.push("Adjusted CV Doc");
    if (coverLetterUrl && coverCol < 0) missingCols.push("Cover Letter Link");

    if (missingCols.length > 0) {
      const nextIdx = headers.length;
      const nextLetter = String.fromCharCode(65 + nextIdx);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT!${nextLetter}1?valueInputOption=USER_ENTERED`,
        { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [missingCols] }) }
      );
      if (adjustedCvUrl && cvCol < 0)    cvCol    = nextIdx;
      if (coverLetterUrl && coverCol < 0) coverCol = nextIdx + (adjustedCvUrl && cvCol < 0 ? 1 : 0);
    }

    const updates = [];
    if (adjustedCvUrl && cvCol >= 0)   updates.push({ range: `SSOT!${String.fromCharCode(65+cvCol)}${matchRow}`,    values: [[adjustedCvUrl]] });
    if (coverLetterUrl && coverCol >= 0) updates.push({ range: `SSOT!${String.fromCharCode(65+coverCol)}${matchRow}`, values: [[coverLetterUrl]] });

    if (updates.length > 0) {
      const upR = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values:batchUpdate`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }) }
      );
      const upData = await upR.json();
      if (!upR.ok) return res.status(upR.status).json({ error: upData.error?.message });
    }

    res.json({ success: true, matchRow });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Generate Cover Letter for a job ──────────────────────────────
app.post("/cv/cover-letter", async (req, res) => {
  const { cvText, jobDescription, company, jobTitle, hiringManager } = req.body;
  if (!keys.anthropic) return res.status(400).json({ error: "Anthropic key not set." });

  const coverPrompt = [
    "You are an expert tech recruiter and career coach.",
    "",
    "MY CV:",
    cvText,
    "",
    "JOB DESCRIPTION:",
    jobDescription,
    "",
    "Company: " + company,
    "Role: " + jobTitle,
    hiringManager ? "Hiring Manager: " + hiringManager : "",
    "",
    "Write a personalized cover letter and return it as a JSON object — no markdown, no backticks.",
    "",
    "The JSON must have these exact fields:",
    "{",
    '  "name": "Full name from CV",',
    '  "location": "City, Country from CV",',
    '  "email": "Email from CV",',
    '  "linkedin": "LinkedIn URL from CV or empty string if not found",',
    '  "portfolio": "Personal website or portfolio URL from CV if present, otherwise empty string",',
    '  "title": "Cover Letter — ' + jobTitle + ' (' + company + ')",',
    '  "opening": "Opening paragraph 2-3 sentences. What draws you to this role. Do NOT start with I am writing to apply.",',
    '  "body1": "Second paragraph 2-3 sentences. Most relevant technical experience matching their requirements. Specific tools metrics outcomes.",',
    '  "body2": "Third paragraph 2-3 sentences. Second angle of fit — process collaboration or different skill area.",',
    '  "strengths": [',
    '    { "label": "Category label", "text": "specific achievement relevant to this role" },',
    '    { "label": "Category label", "text": "specific achievement relevant to this role" },',
    '    { "label": "Category label", "text": "specific achievement relevant to this role" },',
    '    { "label": "Category label", "text": "specific achievement relevant to this role" }',
    '  ],',
    '  "closing": "1-2 sentences on what you can contribute immediately.",',
    "}",
    "",
    "Requirements:",
    "- STRICT: 180-220 words total for the letter body (excluding header) — must fit on 1 page",
    "- Natural confident non-generic tone",
    "- Every sentence references something specific from the CV or job description",
    "- Category labels should be short and descriptive e.g. Test automation, API testing, Release validation",
    "- Each bullet text should be 1 sentence max — concise and specific",
    "- For portfolio: look for any personal website, portfolio URL, or lovable.app link in the CV — include it if found",
    "",
    "Return ONLY the JSON object, nothing else.",
  ].filter(Boolean).join("\n");

    try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": keys.anthropic, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, messages: [{ role: "user", content: coverPrompt }] }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message });
    const raw = data.content?.find(b => b.type === "text")?.text || "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ structured: parsed });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Create cover letter Google Doc — justified, proper bullets, 1 page ──
app.post("/docs/create-cover-letter", async (req, res) => {
  const { structured, title } = req.body;
  if (!structured) return res.status(400).json({ error: "structured cover letter data required." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    const cl = structured;
    const docTitle = title || cl.title || "Cover Letter";

    // Create blank doc
    const cr = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: docTitle }),
    });
    const doc = await cr.json();
    if (!cr.ok) return res.status(cr.status).json({ error: doc.error?.message });
    const docId = doc.documentId;

    // Helper: paragraph style — justified or left-aligned
    const paraStyle = (alignment) => ({
      updateParagraphStyle: {
        paragraphStyle: { alignment },
        fields: "alignment",
      }
    });

    // We build requests in order using insertText + formatting
    // Track current insert index (starts at 1)
    let idx = 1;
    const requests = [];

    // Helper: insert a line of text + optional paragraph style + optional bold range
    function insertLine(text, opts = {}) {
      const { bold = false, boldUpTo = null, alignment = "JUSTIFIED", fontSize = 10, paraEnd = true } = opts;
      const content = text + (paraEnd ? "\n" : "");
      requests.push({ insertText: { location: { index: idx }, text: content } });

      // Only apply text style if there is actual text content
      if (text.length > 0) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: idx, endIndex: idx + text.length },
            textStyle: { fontSize: { magnitude: fontSize, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial" } },
            fields: "fontSize,weightedFontFamily",
          }
        });

        if (bold) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: idx, endIndex: idx + text.length },
              textStyle: { bold: true },
              fields: "bold",
            }
          });
        }

        if (boldUpTo !== null && boldUpTo > 0 && boldUpTo <= text.length) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: idx, endIndex: idx + boldUpTo },
              textStyle: { bold: true },
              fields: "bold",
            }
          });
        }
      }

      // Paragraph alignment always applies (even to empty lines — it covers the newline char)
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: idx, endIndex: idx + content.length },
          paragraphStyle: { alignment },
          fields: "alignment",
        }
      });

      idx += content.length;
    }

    // Helper: insert a bullet point paragraph
    function insertBullet(label, text, opts = {}) {
      const { fontSize = 10 } = opts;
      const safeLabel = label || "";
      const safeText  = text  || "";
      const content   = safeLabel + ": " + safeText + "\n";
      const contentLen = content.length;

      requests.push({ insertText: { location: { index: idx }, text: content } });

      // Font size (only if content has chars beyond newline)
      if (contentLen > 1) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: idx, endIndex: idx + contentLen - 1 },
            textStyle: { fontSize: { magnitude: fontSize, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial" } },
            fields: "fontSize,weightedFontFamily",
          }
        });
      }

      // Justified alignment
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: idx, endIndex: idx + contentLen },
          paragraphStyle: { alignment: "JUSTIFIED" },
          fields: "alignment",
        }
      });

      // Bullet list
      requests.push({
        createParagraphBullets: {
          range: { startIndex: idx, endIndex: idx + contentLen - 1 },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        }
      });

      // Bold label only (guard: label must be non-empty)
      if (safeLabel.length > 0) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: idx, endIndex: idx + safeLabel.length },
            textStyle: { bold: true },
            fields: "bold",
          }
        });
      }

      idx += contentLen;
    }

    // ── BUILD DOCUMENT ──────────────────────────────────────────────

    // Header block — left aligned, small font
    const headerFontSize = 10;
    insertLine(cl.name || "", { alignment: "START", bold: false, fontSize: headerFontSize });
    // Combine address + phone + email + linkedin on one line like Josephine's
    // Portfolio is optional — only include if AI found one in the CV
    const contactLine = [cl.location, cl.email, cl.linkedin, cl.portfolio].filter(Boolean).join(" · ");
    insertLine(contactLine, { alignment: "START", fontSize: headerFontSize });

    // Horizontal rule (simulate with underscored empty line + border via paragraph border)
    // Google Docs API doesn't support HR directly — we use a bottom-bordered paragraph
    const hrText = " \n";
    requests.push({ insertText: { location: { index: idx }, text: hrText } });
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: idx, endIndex: idx + hrText.length },
        paragraphStyle: {
          borderBottom: {
            color: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
            dashStyle: "SOLID",
            padding: { magnitude: 2, unit: "PT" },
            width: { magnitude: 1, unit: "PT" },
          },
          spaceBelow: { magnitude: 6, unit: "PT" },
        },
        fields: "borderBottom,spaceBelow",
      }
    });
    idx += hrText.length;

    // Title — bold, left aligned
    insertLine(cl.title || docTitle, { alignment: "START", bold: true, fontSize: 10 });

    // Blank line
    insertLine("", { alignment: "START", fontSize: 10 });

    // Salutation
    insertLine("Dear Hiring Team,", { alignment: "START", fontSize: 10 });

    // Blank line
    insertLine("", { alignment: "START", fontSize: 10 });

    // Body paragraphs — justified
    insertLine(cl.opening || "", { alignment: "JUSTIFIED", fontSize: 10 });
    insertLine("", { alignment: "START", fontSize: 10 });
    insertLine(cl.body1 || "", { alignment: "JUSTIFIED", fontSize: 10 });
    insertLine("", { alignment: "START", fontSize: 10 });
    insertLine(cl.body2 || "", { alignment: "JUSTIFIED", fontSize: 10 });

    // Blank line before strengths
    insertLine("", { alignment: "START", fontSize: 10 });

    // "My relevant strengths:" — bold
    insertLine("My relevant strengths:", { alignment: "START", bold: true, fontSize: 10 });
    insertLine("", { alignment: "START", fontSize: 10 });

    // Bullet points
    for (const strength of (cl.strengths || [])) {
      insertBullet(strength.label, strength.text, { fontSize: 10 });
    }

    // Blank line
    insertLine("", { alignment: "START", fontSize: 10 });

    // Closing — justified
    insertLine(cl.closing || "", { alignment: "JUSTIFIED", fontSize: 10 });

    // Blank line
    insertLine("", { alignment: "START", fontSize: 10 });

    // Sign-off — left aligned
    insertLine("Thank you for your consideration.", { alignment: "START", fontSize: 10 });
    insertLine("Sincerely,", { alignment: "START", fontSize: 10 });
    insertLine(cl.name || "", { alignment: "START", fontSize: 10 });

    // Set page margins to match a tight professional layout (keep it to 1 page)
    requests.push({
      updateDocumentStyle: {
        documentStyle: {
          marginTop:    { magnitude: 56, unit: "PT" },  // ~0.78 inch
          marginBottom: { magnitude: 56, unit: "PT" },
          marginLeft:   { magnitude: 56, unit: "PT" },
          marginRight:  { magnitude: 56, unit: "PT" },
        },
        fields: "marginTop,marginBottom,marginLeft,marginRight",
      }
    });

    // Execute all requests in one batchUpdate
    const upR = await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    const upData = await upR.json();
    if (!upR.ok) return res.status(upR.status).json({ error: upData.error?.message || "Formatting failed" });

    res.json({ url: `https://docs.google.com/document/d/${docId}/edit`, docId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── Fetch single job via apimaestro/linkedin-job-detail ──────────
// Input: { job_id: ["4391581434"] } — single job ID, returns full details
app.post("/job/fetch", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "LinkedIn job URL required." });
  if (!keys.apify) return res.status(400).json({ error: "Apify token not set. Go to API Keys." });

  const jobIdMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (!jobIdMatch) return res.status(400).json({ error: "URL must be a LinkedIn job view URL: https://www.linkedin.com/jobs/view/4391581434" });

  const jobId = jobIdMatch[1];

  try {
    // Actor: apimaestro/linkedin-job-detail (ID: 39xxtfNEwIEQ1hRiM)
    // Input: job_id as array of numbers (not strings)
    const actorInput = { job_id: [parseInt(jobId)] };
    const r = await fetch(
      `https://api.apify.com/v2/acts/39xxtfNEwIEQ1hRiM/runs?token=${keys.apify}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actorInput),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || data.error || "Apify error" });
    res.json({ runId: data.data?.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Append single job row to Jobs sheet ──────────────────────────
app.post("/job/append-to-sheet", async (req, res) => {
  const { job } = req.body;
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  if (!job) return res.status(400).json({ error: "Job data required." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    // Same column structure as bulk export
    const isEasyApply = job.applyMethod === "SimpleOnsiteApply";
    const postedDate  = parsePostedDate(job.postedAt);
    const city        = job.companyAddressLocality || (job.location || "").split(",")[0].trim();
    const hiringMgr   = [job.jobPosterName, job.jobPosterTitle].filter(Boolean).join(" — ");
    const row = [
      job.company || "", job.title || "",
      (job.description || "").slice(0, 49000),
      job.applyUrl || job.link || "", job.link || "",
      isEasyApply ? "Yes (Easy Apply)" : "No (External)",
      postedDate, city, "Open", hiringMgr,
      job.jobPosterProfileUrl || "", job.seniorityLevel || "",
      job.employmentType || "",
      Array.isArray(job.workplaceTypes) ? job.workplaceTypes.join(", ") : (job.workplaceTypes || ""),
      job.industries || "", job.applicantsCount || "", "", "",
    ];

    // Check if header exists
    const checkR = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/RawData!A1`, { headers: { Authorization: `Bearer ${token}` } });
    const checkData = await checkR.json();
    const isEmpty = !checkData.values || !checkData.values.length;
    const header = ["Company Name","Position Title","Job Description","Apply URL","LinkedIn Job URL","Easy Apply?","Date Posted","City","Hiring Status","Hiring Manager","Hiring Manager URL","Seniority","Employment Type","Workplace Type","Industry","Applicants","Adjusted CV","Cover Letter Link"];
    const toWrite = isEmpty ? [header, row] : [row];

    const r2 = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/RawData!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: toWrite }) }
    );
    const d2 = await r2.json();
    if (!r2.ok) return res.status(r2.status).json({ error: d2.error?.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Fetch results from apimaestro/linkedin-job-detail run ─────────
// Response: array of { job_info, company_info, apply_details }
app.get("/job/fetch-results/:runId", async (req, res) => {
  try {
    const r     = await fetch(`https://api.apify.com/v2/actor-runs/${req.params.runId}/dataset/items?token=${keys.apify}`);
    const items = await r.json();
    if (!Array.isArray(items) || !items.length) return res.status(404).json({ error: "No results found." });

    const item = items[0];
    const ji   = item.job_info     || {};
    const ci   = item.company_info || {};
    const ai   = item.apply_details || {};

    const jobId    = ji.job_posting_id || ji.job_url?.match(/\/(\d+)\//)?.[1] || "";
    const jobUrl   = ji.job_url || `https://www.linkedin.com/jobs/view/${jobId}`;
    const applyUrl = ai.application_url || jobUrl;
    const location = ji.location || "";
    const city     = location.split(",")[0].trim();
    const wpTypes  = (ji.workplace_types || []).map(w => w.charAt(0) + w.slice(1).toLowerCase());

    res.json({
      id:               String(jobId || Date.now()),
      title:            ji.title            || "",
      standardizedTitle:ji.title            || "",
      company:          ci.name             || "",
      location,
      city,
      companyAddressLocality: city,
      description:      ji.description      || "",
      descriptionText:  ji.description      || "",
      link:             jobUrl,
      url:              jobUrl,
      applyUrl,
      applyMethod:      ai.is_easy_apply ? "SimpleOnsiteApply" : "",
      easyApply:        ai.is_easy_apply ? "Yes (Easy Apply)" : "No (External)",
      postedAt:         ji.listed_at        || ji.original_listed_at || "",
      employmentType:   ji.employment_status|| "",
      seniorityLevel:   ji.experience_level || "",
      workplaceTypes:   wpTypes,
      workplaceType:    wpTypes[0]          || "",
      industries:       (ci.industries || ji.industries || []).join(", "),
      applicantsCount:  String(ai.total_applies || ""),
      jobPosterName:    "",
      jobPosterProfileUrl: "",
      companyUrl:       ci.url              || "",
      companyIndustry:  (ci.industries || []).join(", "),
      companySize:      String(ci.staff_count || ""),
      hiringManager:    "",
      hiringStatus:     "Open",
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── German language requirement detection ────────────────────────
// Scans job description text and returns one of:
//   "Required" / "Nice to Have" / "Not Mentioned"
function detectGermanRequired(description) {
  const d = (description || "").toLowerCase();

  // Detect if description is written mostly in German (majority German text signal)
  // Simple heuristic: common German-only words that appear frequently
  const germanOnlyWords = ["und", "die", "der", "das", "ist", "für", "wir", "sie", "eine", "mit", "auf", "von", "wir", "werden", "haben", "ihre", "unsere", "können", "werden", "suchen"];
  const germanWordCount = germanOnlyWords.filter(w => {
    const re = new RegExp(`\\b${w}\\b`, "g");
    return (d.match(re) || []).length >= 2; // must appear at least twice
  }).length;
  const isMostlyGerman = germanWordCount >= 5;

  // Required signals
  const requiredKeywords = [
    "deutschkenntnisse erforderlich",
    "fließende deutschkenntnisse",
    "fliessende deutschkenntnisse",
    "sehr gute deutschkenntnisse",
    "deutsch als muttersprache",
    "c1/c2 deutsch",
    "c1 deutsch",
    "c2 deutsch",
    "deutsch c1",
    "deutsch c2",
    "deutsch voraussetzung",
    "deutsche sprache erforderlich",
    "deutschkenntnisse sind erforderlich",
    "sehr gute deutsche sprachkenntnisse",
    "fließend deutsch",
    "fliessend deutsch",
    "verhandlungssicheres deutsch",
  ];
  if (requiredKeywords.some(kw => d.includes(kw))) return "Required";
  if (isMostlyGerman) return "Required";

  // Nice to Have signals
  const niceKeywords = [
    "deutschkenntnisse von vorteil",
    "deutsch von vorteil",
    "deutsch wünschenswert",
    "deutsch wuenschenswert",
    "deutsch wäre ein plus",
    "deutsch waere ein plus",
    "deutsch wäre von vorteil",
    "b1/b2 deutsch",
    "b1 deutsch",
    "b2 deutsch",
    "deutsch b1",
    "deutsch b2",
    "gute deutschkenntnisse",
    "grundkenntnisse deutsch",
    "deutsche sprachkenntnisse von vorteil",
    "kenntnisse der deutschen sprache",
  ];
  if (niceKeywords.some(kw => d.includes(kw))) return "Nice to Have";

  return "Not Mentioned";
}

// ── Priority assignment logic ─────────────────────────────────────
function assignPriority(title, city) {
  const t = (title || "").toLowerCase();
  const c = (city  || "").toLowerCase();

  // ── City tier ─────────────────────────────────────────────────────
  const isBerlin = c.includes("berlin");
  const isMunich = c.includes("munich") || c.includes("münchen") || c.includes("munchen");

  // ── Role detection ────────────────────────────────────────────────

  // Working student (highest role priority)
  const isWorkingStudent = /\b(werkstudent|working student|student assistant|studentische hilfskraft|hiwi)\b/.test(t)
    || /\b(student.*intern|intern.*student)\b/.test(t);

  // Junior roles (high priority)
  const isJunior = /\b(junior|jr\.?|entry.?level|associate|berufseinsteiger|einsteiger|nachwuchs)\b/.test(t)
    && !isWorkingStudent;

  // Product Manager / Product Owner (high/medium)
  const isProductRole = /\b(product manager|product owner|produktmanager|produkt manager|produkt owner|produktowner|pm\b|po\b)\b/.test(t)
    && !isWorkingStudent && !isJunior;

  // Senior / Lead / Head (low priority)
  // Note: "manager" alone excluded — "product manager" is caught by isProductRole above
  const isSenior = /\b(senior|sr\.?|lead|head of|head,|principal|staff|director|vp\b|vice president|leitend|leiter|chef|gruppenleiter)\b/.test(t)
    && !isWorkingStudent && !isJunior;

  // ── Priority matrix ───────────────────────────────────────────────
  //
  //                    Berlin   Munich   Other
  // Working student      P0       P0      P1
  // Junior               P0       P1      P1
  // Product role         P0       P1      P2
  // Senior               P1       P2      P2
  // Unspecified          P0       P1      P2

  if (isBerlin) {
    if (isSenior)        return "P1";
    return "P0"; // working student, junior, product, unspecified
  }

  if (isMunich) {
    if (isWorkingStudent) return "P0";
    if (isSenior)         return "P2";
    return "P1"; // junior, product, unspecified
  }

  // Other cities
  if (isWorkingStudent) return "P1";
  if (isJunior)         return "P1";
  if (isSenior)         return "P2";
  return "P2"; // product role or unspecified outside Berlin/Munich
}

// ── Dedup RawData → UniqueNewJobs (with SSOT enrichment) ────────────
// Logic:
// 1. Read RawData, deduplicate within itself by title+company+city key
// 2. Write unique rows to UniqueNewJobs tab
// 3. For each unique row, cross-check against SSOT:
//    - If found in SSOT → Previously Scraped = TRUE + copy Application Status
//    - If not found    → Previously Scraped = FALSE + Application Status = ""
// 4. Add Priority column based on city + role
app.post("/rawdata/dedup", async (req, res) => {
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    // ── Step 1: Read RawData ──────────────────────────────────────────
    const rdR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/RawData`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rdData = await rdR.json();
    if (!rdR.ok) return res.status(rdR.status).json({ error: rdData.error?.message || "Could not read RawData" });

    const rdRows = rdData.values || [];
    if (rdRows.length < 2) return res.json({ uniqueCount: 0, dupCount: 0, message: "RawData is empty or has no data rows." });

    const rdHeaders  = rdRows[0].map(h => (h||"").trim());
    const rdDataRows = rdRows.slice(1);

    const colCompany = rdHeaders.indexOf("Company Name");
    const colTitle   = rdHeaders.indexOf("Position Title");
    const colCity    = rdHeaders.indexOf("City");

    // ── Step 2: Read SSOT for cross-reference ────────────────────────
    const ssotR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const ssotJson = await ssotR.json();
    const ssotRows = ssotJson.values || [];
    const ssotHeaders = (ssotRows[0] || []).map(h => (h||"").trim());

    const ssotCompCol   = ssotHeaders.indexOf("Company Name");
    const ssotTitleCol  = ssotHeaders.indexOf("Position Title");
    const ssotCityCol   = ssotHeaders.indexOf("City");
    const ssotStatusCol = ssotHeaders.indexOf("Old Application Status");

    // Build SSOT lookup map: key → application status
    const ssotMap = new Map();
    ssotRows.slice(1).forEach(row => {
      const company = (row[ssotCompCol]  || "").toLowerCase().trim();
      const title   = (row[ssotTitleCol] || "").toLowerCase().trim();
      const city    = (row[ssotCityCol]  || "").toLowerCase().trim();
      const status  = row[ssotStatusCol] || "";
      if (company || title) ssotMap.set(`${title}||${company}||${city}`, status);
    });

    // ── Step 3: Dedup RawData internally + enrich each unique row ────
    const seenKeys  = new Set();
    const uniqueRows = [];
    let   dupCount   = 0;

    rdDataRows.forEach(row => {
      const company = (row[colCompany] || "").toLowerCase().trim();
      const title   = (row[colTitle]   || "").toLowerCase().trim();
      const city    = (row[colCity]    || "").toLowerCase().trim();
      const key     = `${title}||${company}||${city}`;

      if (seenKeys.has(key)) {
        dupCount++;
        return; // skip internal duplicate
      }
      seenKeys.add(key);

      // Cross-check against SSOT
      const previouslyScraped      = ssotMap.has(key);
      const oldApplicationStatus   = previouslyScraped ? ssotMap.get(key) : "";

      // Detect German requirement from Job Description
      const colDesc = rdHeaders.indexOf("Job Description");
      const desc    = colDesc >= 0 ? (row[colDesc] || "") : "";
      const germanRequired = detectGermanRequired(desc);

      // Assign priority
      const priority = assignPriority(row[colTitle] || "", row[colCity] || "");

      // Pad row to full header width (Sheets API omits trailing empty cells)
      const paddedRow = [...row];
      while (paddedRow.length < rdHeaders.length) paddedRow.push("");

      // Build enriched row: original + Previously Scraped + Old App Status + German Required + Priority
      uniqueRows.push([...paddedRow, previouslyScraped ? "TRUE" : "FALSE", oldApplicationStatus, germanRequired, priority]);
    });

    // ── Step 4: Write to UniqueNewJobs tab ───────────────────────────
    if (uniqueRows.length > 0) {
      // Ensure tab exists
      const metaR = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const meta     = await metaR.json();
      const tabNames = (meta.sheets || []).map(sh => sh.properties.title);

      if (!tabNames.includes("UniqueNewJobs")) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}:batchUpdate`,
          { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "UniqueNewJobs" } } }] }) }
        );
      }

      // Check if header exists
      const unjCheckR = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/UniqueNewJobs!A1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const unjCheck = await unjCheckR.json();
      const unjEmpty = !unjCheck.values || !unjCheck.values.length;

      // Header = RawData headers + 4 enriched columns
      // Rename "Position Title" → "Title" to match exact SSOT column name
      const unjHeader = [...rdHeaders, "Previously Scraped", "Old Application Status", "German lang", "Priority "]
        .map(h => h === "Position Title" ? "Title" : h);
      const toWrite   = unjEmpty ? [unjHeader, ...uniqueRows] : uniqueRows;

      const writeR = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/UniqueNewJobs!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: toWrite }) }
      );
      const writeData = await writeR.json();
      if (!writeR.ok) return res.status(writeR.status).json({ error: writeData.error?.message || "Failed to write UniqueNewJobs" });
    }

    const prevScrapedCount = uniqueRows.filter(r => r[r.length - 4] === "TRUE").length;

    res.json({
      success: true,
      uniqueCount:       uniqueRows.length,
      dupCount,
      prevScrapedCount,
      message: `${uniqueRows.length} unique jobs written to UniqueNewJobs (${dupCount} internal dupes removed). ${prevScrapedCount} were previously scraped and enriched with application status.`,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/uniquenewjobs", async (req, res) => {
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/UniqueNewJobs`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Could not read UniqueNewJobs" });

    const rows = data.values || [];
    if (rows.length < 2) return res.json({ jobs: [], headers: [] });

    const headers = rows[0].map(h => (h||"").trim());
    const jobs = rows.slice(1).map((row, idx) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ""; });
      return {
        _rowIndex:           idx + 2,
        company:             obj["Company Name"]           || "",
        title:               obj["Title"]         || "",
        description:         obj["Job Description"]        || "",
        applyUrl:            obj["Apply URL"]              || "",
        linkedInUrl:         obj["LinkedIn Job URL"]       || "",
        easyApply:           obj["Easy Apply?"]            || "",
        postedAt:            obj["Date Posted"]            || "",
        city:                obj["City"]                   || "",
        hiringManager:       obj["Hiring Manager"]         || "",
        seniority:           obj["Seniority"]              || "",
        employmentType:      obj["Employment Type"]        || "",
        workplaceType:       obj["Workplace Type"]         || "",
        industry:            obj["Industry"]               || "",
        applicants:          obj["Applicants"]             || "",
        previouslyScraped:   obj["Previously Scraped"]     || "",
        oldAppStatus:        obj["Old Application Status"] || "",
        germanRequired:      obj["German lang"]        || "",
        priority:            obj["Priority "]              || obj["Priority"] || "",
      };
    });
    res.json({ jobs, headers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── S3: Push UniqueNewJobs → SSOT (skip dupes) ───────────────────

app.post("/uniquenewjobs/push-to-ssot", async (req, res) => {
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    // Read UniqueNewJobs
    const unjR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/UniqueNewJobs`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const unjData = await unjR.json();
    if (!unjR.ok) return res.status(unjR.status).json({ error: unjData.error?.message });
    const unjRows = unjData.values || [];
    if (unjRows.length < 2) return res.json({ appended: 0, skipped: 0, message: "UniqueNewJobs is empty." });

    const unjHeaders  = unjRows[0].map(h => (h||"").trim());
    const unjDataRows = unjRows.slice(1);
    const colComp  = unjHeaders.indexOf("Company Name");
    const colTitle = unjHeaders.indexOf("Title") >= 0 ? unjHeaders.indexOf("Title") : unjHeaders.indexOf("Position Title");
    const colCity  = unjHeaders.indexOf("City");

    // Read SSOT existing keys
    const ssotR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const ssotData  = await ssotR.json();
    const ssotRows  = ssotData.values || [];
    const ssotHdrs  = (ssotRows[0] || []).map(h => (h||"").trim());
    const ssotCompCol  = ssotHdrs.indexOf("Company Name");
    const ssotTitleCol = ssotHdrs.indexOf("Position Title");
    const ssotCityCol  = ssotHdrs.indexOf("City");

    const existingKeys = new Set();
    ssotRows.slice(1).forEach(row => {
      const c = (row[ssotCompCol]  || "").toLowerCase().trim();
      const t = (row[ssotTitleCol] || "").toLowerCase().trim();
      const ci = (row[ssotCityCol] || "").toLowerCase().trim();
      if (c || t) existingKeys.add(`${t}||${c}||${ci}`);
    });

    // Filter rows to append
    const toAppend = [];
    let skipped = 0;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    unjDataRows.forEach(row => {
      const c  = (row[colComp]  || "").toLowerCase().trim();
      const t  = (row[colTitle] || "").toLowerCase().trim();
      const ci = (row[colCity]  || "").toLowerCase().trim();
      const key = `${t}||${c}||${ci}`;
      if (existingKeys.has(key)) { skipped++; return; }
      existingKeys.add(key);

      // Map UniqueNewJobs → SSOT by matching column names exactly
      // Overrides: inject Scrapped Date = today, Application Status = "Not yet"
      const ssotRow = ssotHdrs.map(h => {
        if (h === "Scrapped Date")       return today;
        if (h === "Application Status")  return "Not yet";
        const idx = unjHeaders.indexOf(h);
        return idx >= 0 ? (row[idx] || "") : "";
      });
      toAppend.push(ssotRow);
    });

    if (toAppend.length > 0) {
      // Ensure SSOT has Scrapped Date + Application Status columns if missing
      const neededCols = ["Scrapped Date", "Application Status"];
      const missingCols = neededCols.filter(c => !ssotHdrs.includes(c));
      if (missingCols.length > 0) {
        const nextIdx = ssotHdrs.length;
        const colLetters = missingCols.map((_, i) => {
          const ci = nextIdx + i;
          return ci < 26 ? String.fromCharCode(65 + ci)
            : String.fromCharCode(65 + Math.floor(ci/26) - 1) + String.fromCharCode(65 + (ci % 26));
        });
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT!${colLetters[0]}1?valueInputOption=USER_ENTERED`,
          { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: [missingCols] }) }
        );
        ssotHdrs.push(...missingCols);
      }

      const appR = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: toAppend }) }
      );
      const appData = await appR.json();
      if (!appR.ok) return res.status(appR.status).json({ error: appData.error?.message });
    }

    res.json({
      success: true,
      appended: toAppend.length,
      skipped,
      message: `${toAppend.length} jobs pushed to SSOT. ${skipped} skipped (already in SSOT).`,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Debug: return raw SSOT headers to verify column names ────────
app.get("/ssot/headers", async (req, res) => {
  if (!keys.sheetId) return res.status(400).json({ error: "Sheet ID not set." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT!1:1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const headers = (data.values?.[0] || []).map((h, i) => ({ col: i, letter: String.fromCharCode(65 + i), name: h }));
    res.json({ headers });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── S4: Read full SSOT database ──────────────────────────────────

app.get("/ssot/database", async (req, res) => {
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Could not read SSOT" });

    const rows = data.values || [];
    if (rows.length < 2) return res.json({ jobs: [], headers: [] });

    const headers = rows[0].map(h => (h||"").trim());
    const dataRows = rows.slice(1);
    const jobs = dataRows
      .map((row, sheetIdx) => ({ row, sheetIdx }))
      .filter(({ row }) => row.some(cell => (cell||"").trim() !== "")) // skip empty rows
      .map(({ row, sheetIdx }) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ""; });
      return {
        _rowIndex:           sheetIdx + 2, // actual 1-based sheet row (header = row 1)
        company:             obj["Company Name"]            || "",
        title:               obj["Title"]                   || obj["Position Title"] || "",
        description:         obj["Job Description"]         || "",
        applyUrl:            obj["Apply URL"]               || "",
        linkedInUrl:         obj["LinkedIn Job URL"]        || "",
        easyApply:           obj["Easy Apply?"]             || "",
        postedAt:            obj["Date Posted"]             || "",
        city:                obj["City"]                    || "",
        hiringManager:       obj["Hiring Manager"]          || "",
        seniority:           obj["Seniority"]               || "",
        employmentType:      obj["Employment Type"]         || "",
        workplaceType:       obj["Workplace Type"]          || "",
        industry:            obj["Industry"]                || "",
        applicants:          obj["Applicants"]              || "",
        adjustedCvUrl:       obj["Adjusted CV Doc"]         || obj["Adjusted CV"]    || "",
        coverLetterUrl:      obj["Cover Letter Link"]       || "",
        previouslyScraped:   obj["Previously Scraped"]      || "",
        oldAppStatus:        obj["Old Application Status"]  || "",
        germanRequired:      obj["German lang"]         || "",
        priority:            obj["Priority "]               || obj["Priority"]       || "",
        appStatus:           obj["Application Status"]      || "",
        scrapedDate:         obj["Scrapped Date"]           || "",
      };
    });
    res.json({ jobs, headers, rowCount: jobs.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── S5: Update Application Status in SSOT by company+title key ───
app.post("/ssot/update-status", async (req, res) => {
  const { company, title, status } = req.body;
  if (!keys.sheetId) return res.status(400).json({ error: "Google Sheet ID not set." });
  if (!company && !title) return res.status(400).json({ error: "company and title required." });
  try {
    const token = await getGoogleToken();
    if (!token) return res.status(401).json({ error: "Google not connected." });

    // Read full SSOT sheet to find matching row
    const sheetR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const sheetData = await sheetR.json();
    if (!sheetR.ok) return res.status(sheetR.status).json({ error: sheetData.error?.message });

    const rows    = sheetData.values || [];
    if (!rows.length) return res.status(404).json({ error: "SSOT tab is empty." });

    const headers  = rows[0].map(h => (h||"").trim());
    const compCol  = headers.indexOf("Company Name");
    const titleCol = headers.indexOf("Title") >= 0 ? headers.indexOf("Title") : headers.indexOf("Position Title");
    let   statusCol = headers.indexOf("Application Status");

    // Add column if missing
    if (statusCol === -1) {
      statusCol = headers.length;
      const colLetter = statusCol < 26
        ? String.fromCharCode(65 + statusCol)
        : String.fromCharCode(65 + Math.floor(statusCol/26) - 1) + String.fromCharCode(65 + (statusCol % 26));
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT!${colLetter}1?valueInputOption=USER_ENTERED`,
        { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: [["Application Status"]] }) }
      );
    }

    // Find matching row by company+title
    const targetComp  = (company||"").toLowerCase().trim();
    const targetTitle = (title||"").toLowerCase().trim();
    let   matchRow    = -1;
    for (let i = 1; i < rows.length; i++) {
      const c = (rows[i][compCol]  || "").toLowerCase().trim();
      const t = (rows[i][titleCol] || "").toLowerCase().trim();
      if (c === targetComp && t === targetTitle) { matchRow = i + 1; break; }
    }
    if (matchRow === -1) return res.json({ success: true, note: "Row not found in SSOT." });

    const col = statusCol < 26
      ? String.fromCharCode(65 + statusCol)
      : String.fromCharCode(65 + Math.floor(statusCol/26) - 1) + String.fromCharCode(65 + (statusCol % 26));

    const upR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${keys.sheetId}/values/SSOT!${col}${matchRow}?valueInputOption=USER_ENTERED`,
      { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [[status || ""]] }) }
    );
    const upData = await upR.json();
    if (!upR.ok) return res.status(upR.status).json({ error: upData.error?.message });

    res.json({ success: true, matchRow, status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`\n✅  JobCraft is running!`);
  console.log(`\n   👉  Open in your browser: http://localhost:${PORT}\n`);
  if (!keys.grefreshToken) {
    console.log(`   ⚠️   Google not connected yet.`);
    console.log(`        Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env`);
    console.log(`        then visit: http://localhost:${PORT}/auth/google\n`);
  } else {
    console.log(`   ✅  Google account connected (refresh token found)\n`);
  }
});

// ── Read CV from Google Docs ──────────────────────────────────────