/**
 * Galaxy AI - Eden AI Integration
 */

const axios = require('axios');
const { buildContextString } = require('./memory');

function buildSystemPrompt() {
  const context = buildContextString();
  const tone = buildContextString().includes('Casual') ? 'casual / friendly' : 'professional but warm';

  return [
    'You are Galaxy, a powerful AI assistant with full remote control over the user Windows PC.',
    'You can see their screen and take any action to help them.',
    context,
    '',
    'RESPONSE FORMAT (STRICT)',
    'You MUST always respond with valid JSON in exactly this format:',
    '{',
    '  "message": "Your conversational reply (required)",',
    '  "thinking": "One-sentence plan (optional)",',
    '  "actions": [],',
    '  "remember": []',
    '}',
    '',
    'AVAILABLE PC ACTIONS',
    'Mouse:',
    '  {"type":"click","x":100,"y":200}',
    '  {"type":"double_click","x":100,"y":200}',
    '  {"type":"right_click","x":100,"y":200}',
    '  {"type":"move_mouse","x":100,"y":200}',
    '  {"type":"scroll","amount":3}',
    '  {"type":"drag","fromX":0,"fromY":0,"toX":200,"toY":200}',
    '',
    'Keyboard:',
    '  {"type":"type","text":"hello world"}',
    '  {"type":"key","key":"{ENTER}"}',
    '  {"type":"hotkey","keys":["ctrl","c"]}',
    '',
    'Apps & system:',
    '  {"type":"open_app","app":"notepad.exe"}',
    '  {"type":"open_app","app":"https://google.com"}',
    '  {"type":"close_app","name":"notepad"}',
    '  {"type":"focus_window","title":"Untitled - Notepad"}',
    '  {"type":"run_command","command":"Get-Process | Format-Table"}',
    '',
    'Files:',
    '  {"type":"read_file","path":"C:\\\\Users\\\\notes.txt"}',
    '  {"type":"write_file","path":"C:\\\\notes.txt","content":"Hello"}',
    '  {"type":"list_files","path":"C:\\\\Users\\\\Downloads"}',
    '  {"type":"delete_file","path":"C:\\\\path","recursive":false}',
    '',
    'Clipboard:',
    '  {"type":"set_clipboard","text":"copy this"}',
    '  {"type":"get_clipboard"}',
    '',
    'Timing & vision:',
    '  {"type":"wait","ms":800}',
    '  {"type":"screenshot"}',
    '',
    'MEMORY',
    'Use the "remember" array to save facts:',
    '  [{"key":"preferred browser","value":"Chrome"}]',
    '',
    'To update profile: {"type":"update_profile","field":"context","value":"..."}',
    '',
    'GUIDELINES',
    '- Look at the screenshot before clicking. Coordinates matter.',
    '- Chain ALL actions for multi-step tasks in one response.',
    '- Add {"type":"wait","ms":500} when UI needs to load.',
    '- Include {"type":"screenshot"} to verify progress on complex tasks.',
    '- Be proactive and helpful.',
    '- Match tone: ' + tone + '.',
    '- Coordinates: (0,0) = top-left of primary monitor.',
  ].join('\n');
}

async function chat(userMessage, screenshotBase64, history, apiKey, provider) {
  provider = provider || 'openai/gpt-4o';
  if (!apiKey || apiKey === 'your_eden_ai_key_here') {
    return {
      message: 'Eden AI key not configured. Add EDEN_AI_KEY to your .env file and restart.',
      thinking: null, actions: [], remember: []
    };
  }

  const systemPrompt = buildSystemPrompt();
  const apiHistory = (history || []).slice(-12).map(h => ({ role: h.role, content: h.content }));

  const userContent = screenshotBase64
    ? [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + screenshotBase64 } }
      ]
    : userMessage;

  const messages = [...apiHistory, { role: 'user', content: userContent }];

  try {
    const response = await axios.post(
      'https://api.edenai.run/v2/multimodal/chat',
      {
        providers: provider,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 2048,
        temperature: 0.25,
        response_format: { type: 'json_object' }
      },
      {
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );

    const providerKey = provider.split('/')[0];
    const result = response.data?.[providerKey] || response.data?.[Object.keys(response.data)[0]];
    const rawText = result?.generated_text || result?.message?.content || '';
    return parseResponse(rawText);

  } catch (err) {
    if (err.response?.status === 400) return retryWithoutJsonMode(messages, systemPrompt, apiKey, provider);
    const detail = err.response?.data?.detail || err.message;
    console.error('[ai] Eden AI error:', detail);
    return { message: 'Eden AI error: ' + JSON.stringify(detail), thinking: null, actions: [], remember: [] };
  }
}

async function retryWithoutJsonMode(messages, systemPrompt, apiKey, provider) {
  try {
    const response = await axios.post(
      'https://api.edenai.run/v2/multimodal/chat',
      {
        providers: provider,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 2048,
        temperature: 0.25
      },
      {
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );
    const providerKey = provider.split('/')[0];
    const result = response.data?.[providerKey] || response.data?.[Object.keys(response.data)[0]];
    return parseResponse(result?.generated_text || '');
  } catch (err2) {
    return { message: 'Request failed: ' + err2.message, thinking: null, actions: [], remember: [] };
  }
}

function parseResponse(raw) {
  if (!raw) return { message: '(No response)', thinking: null, actions: [], remember: [] };

  // Try to extract JSON from markdown code block
  let jsonStr = raw;
  const blockStart = raw.indexOf('```');
  const blockEnd = raw.lastIndexOf('```');
  if (blockStart >= 0 && blockEnd > blockStart + 3) {
    const inner = raw.slice(blockStart + 3, blockEnd);
    const s = inner.indexOf('{');
    if (s >= 0) jsonStr = inner.slice(s);
  } else {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) jsonStr = raw.slice(s, e + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      message:  parsed.message  || raw,
      thinking: parsed.thinking || null,
      actions:  Array.isArray(parsed.actions)  ? parsed.actions  : [],
      remember: Array.isArray(parsed.remember) ? parsed.remember : []
    };
  } catch {
    return { message: raw, thinking: null, actions: [], remember: [] };
  }
}

module.exports = { chat };
