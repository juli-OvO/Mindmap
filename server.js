'use strict';

const express = require('express');
const https   = require('https');
const path    = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// ── JSON extraction helpers ──────────────────────────────────────
function preview(value, limit = 900) {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(0, limit) + '...<truncated>' : text;
}

function stripJsonFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function findBalancedRegions(text, openCh, closeCh) {
  const regions = [];
  let depth = 0, start = -1, inString = false, escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape)                  { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true;  continue; }
    if (ch === '"')              { inString = !inString; continue; }
    if (inString)                continue;

    if (ch === openCh) {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === closeCh && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        regions.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return regions;
}

function extractJsonPayload(text, expectedType, isExpectedShape = () => true) {
  const cleaned = stripJsonFences(text);
  const openCh = expectedType === 'array' ? '[' : '{';
  const closeCh = expectedType === 'array' ? ']' : '}';
  const regions = findBalancedRegions(cleaned, openCh, closeCh);

  if (!regions.length) {
    const err = new Error(`no JSON ${expectedType} found`);
    err.extracted = '';
    throw err;
  }

  let lastErr = null;
  for (const region of regions) {
    try {
      const parsed = JSON.parse(region);
      const ok = expectedType === 'array'
        ? Array.isArray(parsed)
        : parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      if (ok && isExpectedShape(parsed)) return { json: region, value: parsed };
      if (ok) lastErr = new Error(`JSON ${expectedType} did not match expected schema`);
    } catch (err) {
      lastErr = err;
    }
  }

  const err = new Error(lastErr ? lastErr.message : `no valid JSON ${expectedType} found`);
  err.extracted = regions[0] || '';
  throw err;
}

function extractJsonArray(text, isExpectedShape) {
  return extractJsonPayload(text, 'array', isExpectedShape);
}

function extractJsonObject(text, isExpectedShape) {
  return extractJsonPayload(text, 'object', isExpectedShape);
}

function logModelParseFailure(endpoint, text, extracted, err) {
  console.error(`[${endpoint}] model JSON parse failed`);
  console.error(`[${endpoint}] parse error:`, err.message);
  console.error(`[${endpoint}] extracted candidate:`, preview(extracted || ''));
  console.error(`[${endpoint}] raw model text:`, preview(text || ''));
}

function parseAnthropicRaw(raw, endpoint) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[${endpoint}] failed to parse Anthropic HTTP JSON:`, err.message);
    console.error(`[${endpoint}] raw HTTP body:`, preview(raw));
    throw err;
  }
}

function isExtractShape(value) {
  return Array.isArray(value) && value.every(item =>
    item &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.label === 'string' &&
    typeof item.sourceSpan === 'string' &&
    typeof item.type === 'string' &&
    Array.isArray(item.tags)
  );
}

function patchShapeProblems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { missingKeys: [], nonArrayKeys: ['<root>'] };
  }
  const requiredKeys = ['newNodes', 'editedNodes', 'keptNodes', 'relationships', 'topTags'];
  return {
    missingKeys: requiredKeys.filter(key => !(key in value)),
    nonArrayKeys: requiredKeys.filter(key => key in value && !Array.isArray(value[key])),
  };
}

function isPatchShape(value) {
  const problems = patchShapeProblems(value);
  return problems.missingKeys.length === 0 && problems.nonArrayKeys.length === 0;
}

// ── system prompt (always included) ─────────────────────────────
const SYSTEM_PROMPT =
`You are analyzing a personal thinking graph.

Your task is to produce a WORKING SYNTHESIS.

Do NOT write a polished artist statement.
Do NOT exaggerate clarity.
Do NOT be poetic or metaphor-heavy.

Stay grounded in the actual nodes.

Your goal:
Help the user see structure in their thinking.

Output format:

Working center:
1–2 sentences describing what the user seems to be circling.

Patterns:
- recurring idea or theme
- repeated structure or behavior
- notable cluster or grouping

Tensions:
- contradiction
- unresolved conflict
- competing directions

Gaps:
- what is missing or underdeveloped
- what is implied but not stated

Next moves:
- 2–3 concrete actions (reword, connect, test, remove, expand)

Confidence:
low / medium / high

Why:
one sentence explaining confidence level

Rules:
- Use plain language
- Be specific
- Do not generalize beyond evidence
- Do not introduce new concepts not present in the nodes`;

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
    maxTokens = 600;

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
    maxTokens = 500;

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

Return ONLY raw JSON.
Do not use markdown fences.
Do not include explanatory text before or after the JSON.
Follow the exact schema.

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
      try {
        parsed = parseAnthropicRaw(raw, 'extract');
      } catch (err) {
        return res.status(502).json({
          error: 'server could not parse Anthropic HTTP response',
          code: 'ANTHROPIC_RESPONSE_JSON_INVALID',
        });
      }
      if (apiRes.statusCode !== 200) {
        const msg = parsed.error?.message || `Anthropic API error ${apiRes.statusCode}`;
        return res.status(apiRes.statusCode).json({ error: msg });
      }
      const text = (parsed.content || []).find(b => b.type === 'text')?.text || '';

      if (!text.trim()) {
        return res.status(502).json({
          error: 'model returned empty extraction text',
          code: 'MODEL_EMPTY_TEXT',
        });
      }

      let fragments;
      try {
        fragments = extractJsonArray(text, isExtractShape).value;
      } catch (err) {
        logModelParseFailure('extract', text, err.extracted, err);
        return res.status(502).json({
          error: 'invalid JSON or schema from model in extract flow',
          code: 'MODEL_EXTRACT_PAYLOAD_INVALID',
          detail: err.message,
        });
      }

      if (!isExtractShape(fragments)) {
        console.error('[extract] invalid extraction shape after parse');
        return res.status(502).json({
          error: 'invalid extraction shape from model',
          code: 'MODEL_EXTRACT_SHAPE_INVALID',
        });
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

// ── POST /api/patch ─────────────────────────────────────────────
const PATCH_PROMPT =
`You are a research graph patch engine.

You receive:
1. NEW_TRANSCRIPT — new spoken or written input
2. EXISTING_GRAPH — JSON array of current nodes: [{id, label, content, type, tags}]

Your job:
* Compare the new input against the existing graph
* newNodes: ideas in the transcript genuinely not present in the graph
* editedNodes: existing nodes refined or shifted by the new input — reference the existing id
* keptNodes: existing node ids confirmed or echoed without change
* relationships: connections implied by the transcript
* topTags: the 5 most important semantic tags across the whole new session
* suggestedNodes: exactly 3 possible nodes the thinker hasn't articulated yet

Rules for labels:
* 2–4 words, close to the speaker's wording
* Remove filler; do NOT paraphrase poetically or introduce new concepts
* Avoid generic labels: "idea", "process", "thing"

Rules for topTags:
* Return the 5 most important tags for the whole session in topTags
* Specific and useful, not generic clutter
* Do NOT generate per-node tags — topTags is the only tag output

Rules for relationships:
* type must be one of: "contradicts", "leads_to", "parallel"
* from/to must reference either:
  - an existing node id (e.g. "f001")
  - or "new:<index>" where index is the 0-based position in the newNodes array (e.g. "new:0", "new:1")
* Only suggest relationships clearly implied by the text

Rules for suggestedNodes (exactly 3):
* Label: 2–4 words, specific not generic
* Based on unresolved gaps: isolated nodes, unresolved contradictions, long chains, repeated themes
* suggestionType: one of "bridge", "next_step", "question", "tension", "return"
* basedOn: array of 1–2 node ids or "new:N" refs the suggestion relates to
* confidence: 0.0–1.0
* Good labels: "missing bridge", "unspoken fear", "next material test", "old pattern"
* Bad labels: "explore this more", "creative idea", "you should consider"

Return ONLY raw JSON.
Do not use markdown fences.
Do not include explanatory text before or after the JSON.
Follow the exact schema.

Output schema:
{
  "newNodes": [
    { "label": "...", "sourceSpan": "...", "type": "feeling|observation|question|tension|anchor" }
  ],
  "editedNodes": [
    { "id": "existing-id", "label": "...", "content": "...", "reason": "..." }
  ],
  "keptNodes": ["id1", "id2"],
  "relationships": [
    { "from": "id-or-new:0", "to": "id-or-new:1", "type": "contradicts|leads_to|parallel" }
  ],
  "topTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "suggestedNodes": [
    {
      "id": "suggestion_1",
      "label": "...",
      "reason": "...",
      "suggestionType": "bridge|next_step|question|tension|return",
      "basedOn": ["id-or-new:0"],
      "confidence": 0.72,
      "isSuggestion": true,
      "status": "floating"
    }
  ]
}`;

app.post('/api/patch', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' });
  }

  const { transcript, existingNodes = [] } = req.body;
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'empty transcript' });
  }

  const userContent =
    `NEW_TRANSCRIPT:\n${transcript.trim()}\n\nEXISTING_GRAPH:\n${JSON.stringify(existingNodes)}`;

  const bodyObj = {
    model:      'claude-sonnet-4-6',
    max_tokens: 1600,
    system:     PATCH_PROMPT,
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
      try {
        parsed = parseAnthropicRaw(raw, 'patch');
      } catch (err) {
        return res.status(502).json({
          error: 'server could not parse Anthropic HTTP response',
          code: 'ANTHROPIC_RESPONSE_JSON_INVALID',
        });
      }
      if (apiRes.statusCode !== 200) {
        const msg = parsed.error?.message || `Anthropic API error ${apiRes.statusCode}`;
        return res.status(apiRes.statusCode).json({ error: msg });
      }
      const text = (parsed.content || []).find(b => b.type === 'text')?.text || '';

      if (!text.trim()) {
        return res.status(502).json({
          error: 'model returned empty patch text',
          code: 'MODEL_EMPTY_TEXT',
        });
      }

      let patch;
      try {
        patch = extractJsonObject(text, isPatchShape).value;
      } catch (err) {
        logModelParseFailure('patch', text, err.extracted, err);
        return res.status(502).json({
          error: 'invalid JSON or schema from model in patch flow',
          code: 'MODEL_PATCH_PAYLOAD_INVALID',
          detail: err.message,
        });
      }

      const { missingKeys, nonArrayKeys } = patchShapeProblems(patch);
      if (missingKeys.length || nonArrayKeys.length) {
        console.error('[patch] invalid patch shape:', {
          missingKeys,
          nonArrayKeys,
          keys: Object.keys(patch),
        });
        return res.status(502).json({
          error: 'invalid patch shape from model',
          code: 'MODEL_PATCH_SHAPE_INVALID',
          detail: `missing: ${missingKeys.join(', ') || 'none'}; non-arrays: ${nonArrayKeys.join(', ') || 'none'}`,
        });
      }

      const newNodes    = patch.newNodes;
      const editedNodes = patch.editedNodes;
      const keptNodes   = patch.keptNodes;
      const topTags     = patch.topTags.slice(0, 5);

      const VALID_REL = new Set(['contradicts', 'leads_to', 'parallel']);
      const relationships = patch.relationships
        .filter(r => r && r.from && r.to && VALID_REL.has(r.type));

      // suggestedNodes is optional — pass through if present, else empty array
      const VALID_SUG_TYPE = new Set(['bridge', 'next_step', 'question', 'tension', 'return']);
      const suggestedNodes = Array.isArray(patch.suggestedNodes)
        ? patch.suggestedNodes
            .filter(s => s && s.id && s.label && VALID_SUG_TYPE.has(s.suggestionType))
            .slice(0, 3)
        : [];

      if (!newNodes.length && !editedNodes.length && !keptNodes.length) {
        return res.status(422).json({ error: 'empty patch' });
      }

      res.json({ patch: { newNodes, editedNodes, keptNodes, relationships, topTags, suggestedNodes } });
    });
  });

  apiReq.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  apiReq.write(bodyStr);
  apiReq.end();
});

// ── POST /api/suggestDirections ──────────────────────────────────
const SUGGEST_SYSTEM =
`You are assisting a thinking graph tool.

Your task is to generate SMALL, ACTIONABLE suggestions based ONLY on the current nodes.

Do NOT summarize the whole project.
Do NOT write concept statements.
Do NOT be poetic or abstract.

Focus on helping the user CONTINUE thinking.

Constraints:
- Use only ideas present in the nodes
- Do not invent unsupported themes
- Keep all labels short (2–5 words)
- Be specific and grounded
- Prefer usefulness over cleverness

Suggestion types:
- missing_question → something the user hasn't asked
- bridge → link between two ideas
- tension → contradiction or conflict
- anchor → repeated or central idea
- clarify → vague or unclear node

Return JSON only.`;

app.post('/api/suggestDirections', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' });

  const { nodes } = req.body;
  if (!Array.isArray(nodes) || !nodes.length) {
    return res.status(400).json({ error: 'nodes array required' });
  }

  const nodeStr    = nodes.map(n => `- ${n.label}`).join('\n');
  const userContent =
    `Current graph nodes:\n${nodeStr}\n\n` +
    `Return ONLY raw JSON. No markdown fences. No explanatory text.\n\n` +
    `{\n` +
    `  "suggestedNodes": [\n` +
    `    { "label": "short phrase", "type": "missing_question|bridge|tension|anchor|clarify", "reason": "one concrete sentence" }\n` +
    `  ],\n` +
    `  "suggestedRelationships": [\n` +
    `    { "from": "existing node label", "to": "existing or suggested node label", "relationship": "leads_to|contradicts|parallel", "reason": "one sentence" }\n` +
    `  ],\n` +
    `  "critique": [\n` +
    `    { "issue": "short label", "note": "what is weak or missing", "nextAction": "specific step" }\n` +
    `  ]\n` +
    `}\n\n` +
    `Rules:\n` +
    `- suggestedNodes MUST contain 2-3 items. An empty array is not acceptable.\n` +
    `- If you cannot derive suggestions strictly from the nodes, extrapolate one step beyond them.\n` +
    `- Max 3 suggestedRelationships, max 3 critique items.`;

  const bodyObj = {
    model:      'claude-sonnet-4-6',
    max_tokens: 900,
    system:     SUGGEST_SYSTEM,
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
      try { parsed = parseAnthropicRaw(raw, 'suggestDirections'); }
      catch (err) { return res.status(502).json({ error: 'server could not parse Anthropic response' }); }

      if (apiRes.statusCode !== 200) {
        const msg = parsed.error?.message || `Anthropic API error ${apiRes.statusCode}`;
        return res.status(apiRes.statusCode).json({ error: msg });
      }

      const text = (parsed.content || []).find(b => b.type === 'text')?.text || '';
      console.log('[suggestDirections] model text:', text.slice(0, 600));
      let obj;
      try {
        obj = extractJsonObject(text, v => Array.isArray(v.suggestedNodes)).value;
      } catch (err) {
        logModelParseFailure('suggestDirections', text, err.extracted, err);
        return res.status(502).json({ error: 'invalid suggestions JSON from model' });
      }

      const suggestedNodes         = (obj.suggestedNodes         || []).slice(0, 3);
      const suggestedRelationships = (obj.suggestedRelationships || []).slice(0, 3);
      const critique               = (obj.critique               || []).slice(0, 3);

      res.json({ suggestedNodes, suggestedRelationships, critique });
    });
  });

  apiReq.on('error', err => res.status(500).json({ error: err.message }));
  apiReq.write(bodyStr);
  apiReq.end();
});

// ── POST /api/synthesizeConcept ──────────────────────────────────
app.post('/api/synthesizeConcept', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in environment' });

  const { labels } = req.body;
  if (!Array.isArray(labels) || !labels.length) {
    return res.status(400).json({ error: 'labels array required' });
  }

  const userContent =
    `${JSON.stringify(labels, null, 2)}\n\n` +
    `Rules:\n` +
    `- 3-5 sentences\n` +
    `- stay grounded in given labels\n` +
    `- do NOT introduce unrelated ideas\n` +
    `- avoid generic phrases like "this explores..." or "this is about..."\n` +
    `- prioritize clarity over style\n\n` +
    `Return ONLY JSON:\n{"concept":"..."}`;

  const CONCEPT_SYSTEM =
    `You are summarizing a thinking process.\n` +
    `Given a list of short node labels, produce a concise concept statement.`;

  const bodyObj = {
    model:      'claude-sonnet-4-6',
    max_tokens: 250,
    system:     CONCEPT_SYSTEM,
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
      try { parsed = parseAnthropicRaw(raw, 'synthesizeConcept'); }
      catch (err) { return res.status(502).json({ error: 'server could not parse Anthropic response' }); }

      if (apiRes.statusCode !== 200) {
        const msg = parsed.error?.message || `Anthropic API error ${apiRes.statusCode}`;
        return res.status(apiRes.statusCode).json({ error: msg });
      }

      const text = (parsed.content || []).find(b => b.type === 'text')?.text || '';
      let concept;
      try {
        concept = extractJsonObject(text, v => typeof v.concept === 'string').value.concept;
      } catch (err) {
        logModelParseFailure('synthesizeConcept', text, err.extracted, err);
        return res.status(502).json({ error: 'invalid concept JSON from model' });
      }

      res.json({ concept });
    });
  });

  apiReq.on('error', err => res.status(500).json({ error: err.message }));
  apiReq.write(bodyStr);
  apiReq.end();
});

// ── start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`synthesis → http://localhost:${PORT}`);
});
