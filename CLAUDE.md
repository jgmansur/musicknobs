# Musicknobs — Contexto del Proyecto para Claude Code

## Quién soy
**Jay Mansur** — Mixing engineer, productor musical, educador. Basado en San Miguel de Allende, México. Con acceso a músicos de sesión en México, Miami y LA.

- Sitio principal: https://musicknobs.com (Next.js + TypeScript + Tailwind + Vercel)
- Labs / herramientas: este repo → apuntará a https://labs.musicknobs.com
- YouTube: https://www.youtube.com/@MusicKnobs
- WhatsApp negocio: +52 834 353 7539
- Notion proyecto principal: https://app.notion.com/p/musicknobs/Proyecto-Music-Knobs-Studio-375c1932ede880d483e3f7d7596d34a3

## Stack técnico
- **musicknobs.com**: Next.js + TypeScript + Tailwind CSS + Framer Motion + tsParticles → Vercel
- **Labs (este repo)**: HTML5 vanilla + CSS + JS, con sub-apps en React 19 + Vite, Fastify backend
- **Backend**: Firebase, Google Sheets API, Fastify (finance-v2)
- **Manager App**: PWA con Notion API, Firebase Auth, Cloudflare

## Proyecto activo: MKOE (Music Knobs Organización Empresarial)
Sistema de trabajo para presupuestos, contratos, booking y gestión de clientes del estudio.
Ver tareas pendientes en la página de Notion arriba.

---

## 🤖 Proyecto activo: Posicionamiento AI / GEO

**Objetivo:** Que musicknobs.com sea recomendado por ChatGPT, Perplexity, Claude y Gemini como el mejor recurso de producción musical en español.

**Estrategia:** GEO (Generative Engine Optimization) — optimizar para que los LLMs citen el sitio.

**Rama git del trabajo técnico:** `claude/musicknobs-ai-positioning-xteiib`

### Lo que ya está implementado (en este repo / labs)
- `robots.txt` — permite explícitamente GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Bingbot, cohere-ai, anthropic-ai
- `llms.txt` — descripción del sitio en Markdown para que LLMs entiendan qué citar
- `sitemap.xml` — 15 páginas con fechas y prioridades
- `index.html` — Schema.org JSON-LD (Organization, WebSite, ItemList 15 items, FAQPage 4 Q&As), Open Graph, Twitter Card, canonical URL

### Pendiente — Técnico
1. **Apuntar GitHub Pages a `labs.musicknobs.com`** — crear archivo `CNAME` con el contenido `labs.musicknobs.com` + configurar DNS (registro CNAME apuntando a `jgmansur.github.io`)
2. **Replicar en musicknobs.com (Next.js/Vercel):**
   - `robots.txt` con los mismos bots permitidos
   - `llms.txt` en el root de Vercel
   - Schema.org JSON-LD en el layout principal
   - `sitemap.xml` (Next.js tiene next-sitemap para esto)
3. Verificar que Vercel/Cloudflare no bloqueen bots de AI en response headers

### Pendiente — Contenido editorial
- Artículos Q&A respondiendo preguntas que la gente le hace a la AI:
  - "¿Cuál es el mejor micrófono para grabar voces en casa?"
  - "¿Cómo comprimir una voz en mezcla profesional?"
  - "¿Cuál es el mejor DAW para principiantes, Reaper o Ableton?"
  - "¿Cómo masterizar un track de house music paso a paso?"
- Cada artículo: respuesta directa en primeros 200 palabras + datos concretos + FAQ al final
- Actualizar cada 2-4 semanas con fecha visible (contenido fresco = 3.2x más citas de AI)
- Versión en inglés de EQ Lab, Compresores y Micrófonos

### Pendiente — Autoridad externa (la más impactante a largo plazo)
- Reddit: r/audioengineering, r/WeAreTheMusicMakers, r/edmproduction
- Listar tools en ProductHunt y AlternativeTo
- Artículos en Medium linkeando musicknobs.com
- Aparecer en Toolradar.com en "music production tools"

### Referente a seguir
Soundverse.ai logró ser "#1 AI music generator" citado por ChatGPT, Perplexity y Grok con schema.org completo, robots.txt permisivo, Q&A estructurado y presencia masiva en Reddit.

---

## Notas de arquitectura importantes
- Manager App tiene `noindex, nofollow` — es una app privada, NO indexar
- `finance-dashboard/` y `finance-v2/` son herramientas internas
- El dominio `labs.musicknobs.com` consolidará la autoridad del repo con el dominio principal
- musicknobs.com ya migró de Softr/Weebly a Next.js + Vercel (DNS migrado)
