const { Groq } = require("groq-sdk");
const fs = require('fs');
const path = require('path');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY // Ensure to set this in GitHub Secrets
});

const DATA_FILE_PATH = path.join(__dirname, '..', '..', 'noticias', 'data.json');

async function fetchNews() {
  try {
    console.log("Fetching copyright news via AI...");
    const today = new Date().toISOString();

    const prompt = `You are a legal expert in music copyright law and AI. Your task is to provide the latest news or current state of copyright law regarding AI in music. You must return ONLY a raw JSON object string (do not use markdown blocks like \`\`\`json) exactly matching this structure:

{
  "lastUpdated": "${today}",
  "es": {
    "title": "Noticias Diarias: Copyright e Inteligencia Artificial",
    "subtitle": "Lo último en leyes de derechos de autor para músicos, compositores y productores.",
    "sections": [
      {
        "id": "noticia-reciente-1",
        "title": "Título de noticia específica de la última semana",
        "content": "Resumen detallado con nombres de empresas, artistas o cortes (en español).",
        "sourceUrl": "URL real de la fuente de la noticia"
      },
      {
        "id": "noticia-reciente-2",
        "title": "Título de otra noticia de impacto reciente",
        "content": "Explicación de las implicaciones legales para productores (en español).",
        "sourceUrl": "URL real de la fuente de la noticia"
      },
      {
        "id": "guia-practica",
        "title": "Guía del día: Proceso de Registro",
        "content": "Un consejo práctico actualizado sobre cómo proteger obras con IA hoy (en español).",
        "sourceUrl": "URL de referencia o tutorial relevante"
      }
    ]
  },
  "en": {
    "title": "Daily News: Copyright & Artificial Intelligence",
    "subtitle": "The latest in copyright law for musicians, composers, and producers.",
    "sections": [
      {
        "id": "recent-news-1",
        "title": "Specific news title from the last week",
        "content": "Detailed summary with names of companies, artists, or courts (in English).",
        "sourceUrl": "Real URL of the news source"
      },
      {
        "id": "recent-news-2",
        "title": "Another impactful recent news title",
        "content": "Explanation of legal implications for producers (in English).",
        "sourceUrl": "Real URL of the news source"
      },
      {
        "id": "practical-guide",
        "title": "Today's Guide: Registration Process",
        "content": "Updated practical tip on how to protect AI-assisted works today (in English).",
        "sourceUrl": "Relevant reference or tutorial URL"
      }
    ]
  }
}

Important: Use real, up-to-date facts from the LAST 7 DAYS. For each section, include a VALID and WORKING sourceUrl from a reputable news site (The Verge, Reuters, Billboard, Music Business Worldwide, etc.). Avoid placeholder URLs.`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2, // Low temperature for factual consistency
    });

    const content = completion.choices[0].message.content.trim();

    // Enhanced JSON extraction: Find the first '{' and the last '}'
    const startIdx = content.indexOf('{');
    const endIdx = content.lastIndexOf('}');

    if (startIdx === -1 || endIdx === -1) {
      throw new Error("AI output did not contain a valid JSON object.");
    }

    const jsonString = content.substring(startIdx, endIdx + 1);

    // Parse it to ensure it's valid before saving
    const parsedData = JSON.parse(jsonString);

    // Validate parsed data structure
    const requiredKeys = ['lastUpdated', 'es', 'en'];
    const missingKeys = requiredKeys.filter(key => !(key in parsedData));
    if (missingKeys.length > 0) {
      throw new Error(`Parsed JSON is missing required keys: ${missingKeys.join(', ')}`);
    }

    // Write to file
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(parsedData, null, 2), 'utf8');
    console.log("Successfully updated data.json!");

  } catch (error) {
    console.error("========================");
    console.error("🚨 ERROR FETCHING NEWS 🚨");
    console.error("========================");
    console.error("Message:", error.message);
    console.error("Name:", error.name);
    if (error.status) console.error("Status:", error.status);
    if (error.error) console.error("Details:", JSON.stringify(error.error, null, 2));
    console.error("Stack:", error.stack);
    console.error("========================");
    process.exit(1);
  }
}

fetchNews();
