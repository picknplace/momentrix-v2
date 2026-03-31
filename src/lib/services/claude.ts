/**
 * Claude API helper for marketing & AI features
 * Replaces GAS callClaudeForMarketing_()
 */
import { getRequestContext } from '@cloudflare/next-on-pages';

interface ClaudeOptions {
  useWebSearch?: boolean;
  maxSearchUses?: number;
  maxTokens?: number;
  model?: 'haiku' | 'sonnet';
}

export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  opts: ClaudeOptions = {},
): Promise<string> {
  const { env } = getRequestContext();
  const apiKey = (env as Record<string, string>).ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');

  const modelId = opts.model === 'sonnet' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: opts.maxTokens || 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  if (opts.useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearchUses || 3 }];
  }

  const maxRetries = 3;
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json() as { content: Array<{ type: string; text?: string }> };
      let text = '';
      for (const block of data.content || []) {
        if (block.type === 'text' && block.text) text += block.text;
      }
      return text;
    }

    const errData = await res.json() as { error?: { message?: string } };
    lastError = errData.error?.message || `HTTP ${res.status}`;

    if ((res.status === 429 || res.status === 529) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, res.status === 429 ? 65000 : 30000));
      continue;
    }
    break;
  }

  throw new Error(`Claude API 오류: ${lastError}`);
}

export function extractJson<T = unknown>(text: string): T {
  // 1) fenced code block
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {
      const fixed = repairJson(fenced[1].trim());
      if (fixed !== null) return fixed as T;
    }
  }

  // 2) fenced but unclosed
  if (!fenced) {
    const fencedOpen = text.match(/```json\s*([\s\S]*)/);
    if (fencedOpen) {
      try { return JSON.parse(fencedOpen[1].trim()); } catch {
        const fixed = repairJson(fencedOpen[1].trim());
        if (fixed !== null) return fixed as T;
      }
    }
  }

  // 3) raw JSON
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch {
      const fixed = repairJson(jsonMatch[1]);
      if (fixed !== null) return fixed as T;
    }
  }

  // 4) truncated JSON
  const rawOpen = text.match(/(\{[\s\S]*|\[[\s\S]*)/);
  if (rawOpen) {
    const fixed = repairJson(rawOpen[1]);
    if (fixed !== null) return fixed as T;
  }

  throw new Error('Claude 응답에서 JSON을 추출할 수 없습니다: ' + text.substring(0, 200));
}

function repairJson(str: string): unknown | null {
  try {
    // trailing comma
    let s = str.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(s); } catch { /* continue */ }

    // close open quotes
    let openQuote = false;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) { openQuote = !openQuote; break; }
    }
    if (openQuote) s += '"';

    // close open brackets
    const stack: string[] = [];
    let inStr = false;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === '"' && (j === 0 || s[j - 1] !== '\\')) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') stack.push('}');
      else if (c === '[') stack.push(']');
      else if ((c === '}' || c === ']') && stack.length && stack[stack.length - 1] === c) stack.pop();
    }
    s = s.replace(/,\s*$/, '');
    while (stack.length) s += stack.pop();
    return JSON.parse(s);
  } catch {
    return null;
  }
}
