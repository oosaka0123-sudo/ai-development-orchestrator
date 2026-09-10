const required = ['ANTHROPIC_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);

const base = `We are designing a registered-customer "How to use Chat Homepage" page for non-technical shop owners and small businesses. The service promise is: a professional builds the website first; after launch the customer updates it only by chatting in ordinary language. The page must help a new customer understand in about 3 minutes how to request their first update. Discuss: information architecture; first-screen message; copyable request examples for business hours, photos, text, prices, and notices; how to request corrections/undo; what can/cannot be requested; warnings about passwords/API keys/payment-card data and personal data; FAQ; logged-in navigation; mobile UX; public vs authenticated content; and what to omit to keep it simple. No implementation yet. Return valid JSON only.`;

const roles = {
  claude: 'Focus on implementation clarity, support burden, edge cases, maintainability, and what instructions prevent ambiguous update requests.',
  gemini: 'Focus on beginner UX, information architecture, mobile onboarding, alternative approaches, and product/brand fit.',
  chatgpt: 'Act as PM. Focus on priority, scope control, safety, user confidence, conversion from onboarding to first successful request, and final tradeoffs.'
};

async function request(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text().then(t=>t.slice(0,300))}`);
  return r.json();
}

async function ask(provider, prompt) {
  const system = `${roles[provider]} Return one JSON object with keys: decision, summary, recommended_sections, must, should, nice, risks, public_private, notes. Keep arrays concise.`;
  if (provider === 'claude') {
    const data = await request('https://api.anthropic.com/v1/messages', {
      method:'POST', headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:process.env.ANTHROPIC_COUNCIL_MODEL||'claude-sonnet-5',max_tokens:1800,system,messages:[{role:'user',content:prompt}]})
    });
    return JSON.parse(data.content?.find(x=>x.type==='text')?.text || '{}');
  }
  if (provider === 'gemini') {
    const model = encodeURIComponent(process.env.GEMINI_COUNCIL_MODEL||'gemini-3.8-flash');
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method:'POST', headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:1800}})
    });
    return JSON.parse(data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '{}');
  }
  const data = await request('https://api.openai.com/v1/responses', {
    method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    body:JSON.stringify({model:process.env.OPENAI_COUNCIL_MODEL||'gpt-5.6-terra',instructions:system,input:prompt,reasoning:{effort:'medium'},max_output_tokens:1800})
  });
  const text = data.output_text ?? data.output?.flatMap(i=>i.content??[]).map(c=>c.text??'').join('') ?? '{}';
  return JSON.parse(text);
}

const providers = ['claude','gemini','chatgpt'];
const rounds = [];
rounds.push(Object.fromEntries(await Promise.all(providers.map(async p=>[p,await ask(p,`ROUND 1 — independent proposal.\n${base}`)]))));
rounds.push(Object.fromEntries(await Promise.all(providers.map(async p=>[p,await ask(p,`ROUND 2 — cross-review. Critique weak assumptions and revise your proposal.\n${base}\nROUND 1:\n${JSON.stringify(rounds[0])}`)]))));
rounds.push(Object.fromEntries(await Promise.all(providers.map(async p=>[p,await ask(p,`ROUND 3 — final recommendation. Give your best final structure and priorities after the discussion. Do not compromise just to agree.\n${base}\nEARLIER ROUNDS:\n${JSON.stringify(rounds)}`)]))));

const result = {topic:'registered-customer usage guide', generated_at:new Date().toISOString(), rounds};
await import('node:fs/promises').then(fs=>fs.writeFile('customer-guide-council-result.json',JSON.stringify(result,null,2)));
console.log('COUNCIL_COMPLETE');
for (const p of providers) console.log(`${p.toUpperCase()} FINAL: ${JSON.stringify(rounds[2][p])}`);
