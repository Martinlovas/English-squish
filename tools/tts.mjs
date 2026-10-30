// Lager lydfiler for alt spillet sier, med Microsoft Azure sine naturlige stemmer.
// Leser audio/texts.json, lager bare klipp som mangler, og oppdaterer audio/manifest.json.
import fs from 'fs';
import crypto from 'crypto';

const fail = m => { console.log('::error::'+m); console.error(m); };
const KEY = (process.env.AZURE_SPEECH_KEY||'').trim(), REGION = (process.env.AZURE_SPEECH_REGION||'').trim().toLowerCase().replace(/\s+/g,'');
if (!KEY || !REGION) { fail(`Mangler hemmelighet: ${!KEY?'AZURE_SPEECH_KEY ':''}${!REGION?'AZURE_SPEECH_REGION':''}. Legg dem inn under Settings → Secrets and variables → Actions → Repository secrets.`); process.exit(1); }
console.log(`::notice::Region: ${REGION}, nøkkel: ${KEY.length} tegn (${KEY.slice(0,3)}…)`);
if (!/^[a-z0-9]+$/.test(REGION)) fail(`Regionen «${REGION}» ser rar ut. Den skal være for eksempel westeurope eller northeurope.`);
const VOICES = { t: 'en-GB-SoniaNeural', k: 'en-GB-MaisieNeural' };
const texts = JSON.parse(fs.readFileSync('audio/texts.json', 'utf8')).texts;
const manFile = 'audio/manifest.json';
const man = fs.existsSync(manFile) ? JSON.parse(fs.readFileSync(manFile, 'utf8')) : { clips: {} };
fs.mkdirSync('audio/a', { recursive: true });
const akey = (t, v) => v + '|' + String(t).trim().replace(/\s+/g, ' ').toLowerCase();
const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = () => { man.voices = VOICES; man.updated = new Date().toISOString(); fs.writeFileSync(manFile, JSON.stringify(man)); };

let made = 0, failed = 0, n = 0;
for (const { text, v } of texts) {
  n++;
  const k = akey(text, v), file = 'a/' + crypto.createHash('sha1').update(k).digest('hex').slice(0, 14) + '.mp3';
  if (man.clips[k] === file && fs.existsSync('audio/' + file)) continue;
  const ssml = `<speak version="1.0" xml:lang="en-GB"><voice name="${VOICES[v] || VOICES.t}"><prosody rate="-6%">${x(text)}</prosody></voice></speak>`;
  let ok = false;
  for (let attempt = 0; attempt < 7 && !ok; attempt++) {
    let r;
    try {
      r = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'english-squish' },
        body: ssml
      });
    } catch (e) { if (attempt === 6) fail(`Får ikke kontakt med Azure i region ${REGION}: ${e.message}`); await sleep(2000 * (attempt + 1)); continue; }
    if (r.ok) { fs.writeFileSync('audio/' + file, Buffer.from(await r.arrayBuffer())); man.clips[k] = file; made++; ok = true; break; }
    if (r.status === 401 || r.status === 403) { fail(`Azure sier nei (${r.status}): ${(await r.text()).slice(0,200)}. Sjekk at AZURE_SPEECH_KEY er KEY 1 fra Keys and Endpoint, og at AZURE_SPEECH_REGION (${REGION}) er samme region som tjenesten.`); save(); process.exit(1); }
    if (r.status === 429 || r.status >= 500) { const ra = Number(r.headers.get('retry-after')) || 2 ** attempt; await sleep(ra * 1000 + 300); continue; }
    fail(`Feil ${r.status} for «${text}»: ${(await r.text()).slice(0,200)}`); break;
  }
  if (!ok) failed++;
  await sleep(250);
  if (made && made % 50 === 0) { save(); console.log(`${n}/${texts.length} … ${made} nye lydklipp så langt`); }
}
save();
console.log(`Ferdig: ${made} nye lydklipp, ${failed} feil, ${Object.keys(man.clips).length} lydklipp totalt.`);
if (failed && !made) process.exit(1);
