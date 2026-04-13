# Troopod — AI Landing Page Personalizer

An AI-powered tool that takes an ad creative + landing page URL and generates personalized, CRO-optimized copy changes to improve message match and conversion.

---

## How it works

```
User inputs ad creative (image upload or URL)
         +
User inputs landing page URL
         ↓
1. Backend scrapes the LP → extracts real text elements (H1, H2, CTAs, paragraphs, list items)
         ↓
2. Claude Vision analyzes the ad creative → extracts: headline, offer, tone, audience, pain point, urgency
         ↓
3. Claude generates element-by-element copy changes with CRO reasoning
         ↓
4. Output: message match score, before/after diffs, simulated preview
```

---

## Local setup

### 1. Clone / download the project

### 2. Install dependencies
```bash
npm install
```

### 3. Set your Anthropic API key
```bash
cp .env.example .env
# Edit .env and add your key:
# ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Run
```bash
npm start
# → http://localhost:3000
```

---

## Deploy to Vercel (recommended for live demo)

### Option A — Vercel CLI
```bash
npm i -g vercel
vercel
# Follow prompts. Set env var ANTHROPIC_API_KEY in Vercel dashboard.
```

### Option B — Vercel Dashboard
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import your repo
3. Add environment variable: `ANTHROPIC_API_KEY` = your key
4. Deploy

---

## Project structure

```
troopod/
├── server.js          # Express backend — scraper + Anthropic proxy
├── vercel.json        # Vercel deployment config
├── package.json
├── .env.example
└── public/
    └── index.html     # Full frontend (single file)
```

---

## Key design decisions

### Scraper first, inference fallback
The backend first tries to scrape real page elements using `cheerio`. If the page blocks scraping (CORS, JS-rendered, etc.), Claude infers from the URL structure. This means the tool works even for pages it can't fully access.

### JSON schema validation
Every AI response is validated against a strict schema. Fields are sanitized, types are checked, and malformed responses trigger a retry prompt rather than a crash.

### Handling hallucinations
- The AI is constrained to only modify elements that were actually extracted from the page
- Confidence scoring (high/medium/low) per change lets users prioritize
- Warnings are surfaced when message match risk is detected

### Handling broken UI
- The preview is a simulated render, not an iframe of the external page — eliminates any external breakage risk
- All change data is sanitized before rendering to prevent XSS

### Handling inconsistent outputs
- JSON is parsed with a fallback regex extractor if standard parse fails
- All required fields have defaults
- The `type` field is validated against an allowlist

---

## Assignment notes / assumptions

1. "Personalized page" = existing page with AI-generated copy changes, NOT a redesign — consistent with CRO best practices
2. Ad creative analysis uses Claude Vision (supports JPEG, PNG, WebP, GIF)
3. Real page elements are scraped server-side to avoid CORS; JS-heavy SPAs may not scrape fully
4. The simulated preview shows the hero section and key features — a full page iframe would require a proxy or headless browser (Puppeteer), which is out of scope for this prototype
