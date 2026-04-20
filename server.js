'use strict';

const express = require('express');
const https   = require('https');
const path    = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// ── system prompt (always included) ─────────────────────────────
const SYSTEM_PROMPT =
`You are a synthesis engine for a designer's research fragments.
Surface what the designer is actually circling, even if unnamed.
Use exact words from their fragments. Do not introduce new concepts.`;

// ── POST /api/synthesize ─────────────────────────────────────────
app.post('/api/synthesize', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' });
  }

  const { trigger, fragments = [], keywords = [], connections = [] } = req.body;

  let userContent = '';
  let maxTokens   = 600;

  if (trigger === 'what am i circling?') {
    // top 5 keywords + fragment count
    const top5  = keywords.slice(0, 5);
    const kwStr = top5.map(k => `"${k.tag}" (weight ${k.weight})`).join(', ');
    userContent =
      `I have ${fragments.length} research fragment${fragments.length !== 1 ? 's' : ''}.\n` +
      `Top keywords by weight: ${kwStr || 'none'}.` +
      `\nWhat am I circling?`;
    maxTokens = 200;

  } else if (trigger === 'give me the concept') {
    // all confirmed keywords + connections
    const kwStr   = keywords.map(k => `"${k.tag}" (${k.weight})`).join(', ');
    const connStr = connections
      .map(c => `[${c.fromSnippet}] → ${c.type} → [${c.toSnippet}]`)
      .join('\n');
    userContent =
      `Keywords: ${kwStr || 'none'}\n\n` +
      `Connections:\n${connStr || 'none'}\n\n` +
      `Give me the concept.`;
    maxTokens = 600;

  } else if (trigger === 'push back') {
    // outlier fragment — first item in the fragments array (selected on frontend)
    const f = fragments[0] || {};
    userContent =
      `Fragment: "${f.content || ''}"\n` +
      `Type: ${f.type || ''}\n` +
      `Tags: ${(f.tags || []).join(', ') || 'none'}\n\n` +
      `Push back on this.`;
    maxTokens = 200;

  } else {
    return res.status(400).json({ error: `Unknown trigger: ${trigger}` });
  }

  const bodyObj = {
    model:      'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userContent }],
  };
  const bodyStr = JSON.stringify(bodyObj);

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
      'content-length':    Buffer.byteLength(bodyStr),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => { raw += chunk; });
    apiRes.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(raw); } catch (e) {
        return res.status(500).json({ error: 'Failed to parse Anthropic response' });
      }
      if (apiRes.statusCode !== 200) {
        const msg = parsed.error?.message || `Anthropic API error ${apiRes.statusCode}`;
        return res.status(apiRes.statusCode).json({ error: msg });
      }
      const text = (parsed.content || []).find(b => b.type === 'text')?.text || '';
      res.json({ text });
    });
  });

  apiReq.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  apiReq.write(bodyStr);
  apiReq.end();
});

// ── POST /api/extract ─────────────────────────────────────────────
const EXTRACT_PROMPT =
`You are a cognitive fragment extractor.

Given a transcript of spoken or written thought, extract distinct thought-units.

Rules:
* Each fragment is a meaningful phrase, NOT a full sentence
* Node label: 2–4 words, concise and readable
* Stay close to the speaker's wording, but remove filler words (e.g. "the", "so", "like", "just", "kind of")
* Do NOT paraphrase poetically or introduce new concepts
* Avoid generic labels like "idea", "process", "thing"
* Prefer phrases that capture specific meaning or tension

Selection:
* Return up to 20 fragments
* Prioritize fragments that are:
  * conceptually important
  * repeated or emphasized
  * semantically distinct from each other

For each fragment:
* sourceSpan: exact original words from the transcript
* type: one of feeling | observation | question | tension | anchor
* tags: 1–3 short, specific, lowercase words (avoid generic terms)

Return ONLY valid JSON, no explanation.

Output schema:
[
  {
    "label": "...",
    "sourceSpan": "...",
    "tags": ["..."],
    "type": "feeling|observation|question|tension|anchor"
  }
]`;

app.post('/api/extract', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' });
  }

  const { transcript } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'empty transcript' });
  }

  const bodyObj = {
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    system:     EXTRACT_PROMPT,
    messages:   [{ role: 'user', content: transcript.trim() }],
  };
  const bodyStr = JSON.stringify(bodyObj);

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
      'content-length':    Buffer.byteLength(bodyStr),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => { raw += chunk; });
    apiRes.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(raw); } catch (e) {
        return res.status(500).json({ error: 'Failed to parse Anthropic response' });
      }
      if (apiRes.statusCode !== 200) {
        const msg = parsed.error?.message || `Anthropic API error ${apiRes.statusCode}`;
        return res.status(apiRes.statusCode).json({ error: msg });
      }
      const text = (parsed.content || []).find(b => b.type === 'text')?.text || '';
      console.log('[extract] raw Claude text:', JSON.stringify(text).slice(0, 500));
      let fragments;
      try {
        // Extract JSON array from anywhere in the response (handles preamble/fences)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('no JSON array found');
        fragments = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('[extract] parse error:', e.message, '| text was:', text.slice(0, 300));
        return res.status(500).json({ error: 'Failed to parse extraction result as JSON', raw: text.slice(0, 300) });
      }
      if (!Array.isArray(fragments)) {
        return res.status(500).json({ error: 'Unexpected extraction format' });
      }
      res.json({ fragments: fragments.slice(0, 20) });
    });
  });

  apiReq.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  apiReq.write(bodyStr);
  apiReq.end();
});

// ── start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`synthesis → http://localhost:${PORT}`);
});
