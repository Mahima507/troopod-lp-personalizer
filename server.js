require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-opus-4-5';

// ─── Scrape landing page ───────────────────────────────────────────────────
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch page: ${response.status} ${response.statusText}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer for cleaner extraction
    $('script, style, noscript, nav, footer, header, [aria-hidden="true"]').remove();

    // Extract structured page elements
    const elements = [];

    // Title
    const title = $('title').text().trim();
    if (title) elements.push({ type: 'title', selector: 'title', text: title });

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc) elements.push({ type: 'meta_description', selector: 'meta[name="description"]', text: metaDesc });

    // H1
    $('h1').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 2) elements.push({ type: 'h1', selector: `h1:nth-of-type(${i + 1})`, text });
    });

    // H2
    $('h2').slice(0, 6).each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 2) elements.push({ type: 'h2', selector: `h2:nth-of-type(${i + 1})`, text });
    });

    // H3
    $('h3').slice(0, 4).each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 2) elements.push({ type: 'h3', selector: `h3:nth-of-type(${i + 1})`, text });
    });

    // CTAs - buttons and prominent links
    $('button, a.btn, a.button, [class*="cta"], [class*="btn"], [role="button"]').slice(0, 6).each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 1 && text.length < 60) {
        elements.push({ type: 'cta', selector: `cta_${i}`, text });
      }
    });

    // Hero paragraph / subheadline
    $('p').slice(0, 8).each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 30 && text.length < 400) {
        elements.push({ type: 'paragraph', selector: `p:nth-of-type(${i + 1})`, text: text.slice(0, 300) });
      }
    });

    // Feature/benefit items
    $('li').slice(0, 8).each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 10 && text.length < 150) {
        elements.push({ type: 'list_item', selector: `li:nth-of-type(${i + 1})`, text });
      }
    });

    // Get raw HTML snippet for preview (first 8000 chars)
    const bodyHtml = $('body').html() || html;
    const previewHtml = bodyHtml.slice(0, 8000);

    res.json({
      url,
      elements: elements.slice(0, 30),
      previewHtml,
      pageTitle: title || url
    });

  } catch (err) {
    console.error('Scrape error:', err.message);
    res.status(500).json({ error: `Could not fetch page: ${err.message}` });
  }
});

// ─── Personalize ──────────────────────────────────────────────────────────
app.post('/api/personalize', async (req, res) => {
  const { adImageBase64, adImageType, adUrl, lpUrl, lpElements, context, goal } = req.body;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' });
  }

  const userContent = [];

  // Attach ad image if provided
  if (adImageBase64 && adImageType) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: adImageType, data: adImageBase64 }
    });
  }

  const elementsText = lpElements && lpElements.length
    ? lpElements.map(e => `[${e.type}] "${e.text}"`).join('\n')
    : 'No elements extracted — infer from URL structure.';

  const prompt = `You are a senior CRO strategist and landing page personalization expert.

TASK: Analyze the ad creative and generate personalized copy changes for this landing page.

Landing Page URL: ${lpUrl}
${adUrl && !adImageBase64 ? `Ad Creative URL: ${adUrl}` : adImageBase64 ? '(Ad image attached above)' : ''}
Industry/Context: ${context || 'Not specified'}
Conversion Goal: ${goal}

ACTUAL PAGE ELEMENTS EXTRACTED:
${elementsText}

YOUR JOB:
1. Analyze the ad creative — extract: headline, offer, tone, audience segment, pain point, unique value prop, urgency signals, visual style keywords.
2. For EACH page element listed above, generate a personalized replacement that:
   - Creates message match between ad and landing page
   - Is benefit-led and audience-specific
   - Applies CRO best practices (clarity, urgency, specificity)
   - Preserves the page's existing structure and design intent
3. Only suggest changes that genuinely improve conversion — don't change for the sake of it.
4. Flag hallucination risks, broken message match, or changes that could confuse users.

STRICT JSON RESPONSE — no preamble, no markdown fences:
{
  "ad_insights": {
    "headline": "core message/offer from the ad",
    "audience": "specific audience segment targeted",
    "tone": "emotional/stylistic tone",
    "offer": "specific offer or value proposition",
    "pain_point": "problem the ad addresses",
    "urgency": "any urgency/scarcity signal",
    "keywords": ["kw1", "kw2", "kw3", "kw4"]
  },
  "changes": [
    {
      "element": "exact element type from above e.g. h1, cta, paragraph",
      "type": "headline|cta|copy|trust|list_item",
      "before": "original text",
      "after": "personalized replacement text",
      "cro_reason": "specific reason this change improves conversion",
      "confidence": "high|medium|low"
    }
  ],
  "warnings": ["specific risk or inconsistency to flag"],
  "message_match_score": 7,
  "summary": "2-sentence summary of the personalization strategy applied"
}`;

  userContent.push({ type: 'text', text: prompt });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errBody}` });
    }

    const data = await response.json();
    const rawText = data.content.map(i => i.text || '').join('');

    // Validate JSON before returning
    let parsed;
    try {
      const clean = rawText.replace(/```json\n?|```\n?/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      // Attempt to extract JSON from response
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          return res.status(500).json({ error: 'AI returned malformed JSON. Please retry.', raw: rawText.slice(0, 500) });
        }
      } else {
        return res.status(500).json({ error: 'AI returned unexpected format. Please retry.', raw: rawText.slice(0, 500) });
      }
    }

    // Sanitize: ensure required fields exist
    parsed.changes = (parsed.changes || []).map(c => ({
      element: c.element || 'unknown',
      type: ['headline', 'cta', 'copy', 'trust', 'list_item'].includes(c.type) ? c.type : 'copy',
      before: c.before || '',
      after: c.after || '',
      cro_reason: c.cro_reason || '',
      confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'medium'
    }));

    parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    parsed.message_match_score = Math.min(10, Math.max(1, parseInt(parsed.message_match_score) || 5));

    res.json(parsed);

  } catch (err) {
    console.error('Personalize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: MODEL, hasKey: !!ANTHROPIC_API_KEY });
});

// ─── Serve frontend ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Troopod LP Personalizer running on http://localhost:${PORT}`);
  console.log(`API Key configured: ${!!ANTHROPIC_API_KEY}`);
});
