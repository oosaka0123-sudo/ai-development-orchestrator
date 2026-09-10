if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
const prompt = `You are Claude, the implementation/operations member of a 3-agent council. Review a proposed registered-customer usage page for Chat Homepage. Target users are non-technical shop owners and small businesses. Service promise: a professional builds the site first; after launch the customer updates it only by ordinary-language chat.

ChatGPT PM proposal: make this an onboarding page, not a manual. First screen says "just tell us what you want changed in normal words" and offers a first-request CTA. Then 5 copyable examples (business hours, photo, text, price, notice), how to correct/undo, what is possible, what not to send (passwords/API keys/card data; clarify personal-data publishing), the flow request→confirm→change→check, "if you don't know how to ask, just say so", and a short FAQ. Mobile-first; no technical terms; keep policy details elsewhere. If customer-specific/site-specific data is shown, authenticated access is required.

Critique this proposal and improve it. Decide the recommended section order, what MUST/SHOULD/NICE to include, what to omit, operational risks, and whether this page can initially be a generic public help page or must be authenticated. Pay special attention to ambiguous requests, support burden, reversibility, and safe handling of uploads/data. Return valid JSON only with keys decision, summary, recommended_sections, must, should, nice, omit, risks, public_private, notes.`;
const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_COUNCIL_MODEL||'claude-sonnet-5',max_tokens:2200,system:'Be concrete, skeptical, and implementation-aware. Return JSON only.',messages:[{role:'user',content:prompt}]})});
if(!r.ok) throw new Error(`${r.status} ${await r.text().then(t=>t.slice(0,300))}`);
const data=await r.json();
const text=data.content?.find(x=>x.type==='text')?.text||'{}';
const parsed=JSON.parse(text);
await import('node:fs/promises').then(fs=>fs.writeFile('customer-guide-claude-result.json',JSON.stringify(parsed,null,2)));
console.log('CLAUDE_RESULT='+JSON.stringify(parsed));