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
        "id": "cambios-ley",
        "title": "Cambios Recientes en la Ley de Copyright",
        "content": "Summarize the latest major news about AI music copyright here in Spanish."
      },
      {
        "id": "que-registrar",
        "title": "¿Qué se puede y qué no se puede registrar?",
        "content": "Explain clearly what musicians can and cannot register if they use AI, in Spanish."
      },
      {
        "id": "intervencion-humana",
        "title": "Productores: Edición vs Intervención Humana",
        "content": "Answer the question: if I add real instruments or edit an AI track, can I register it? Focus on the amount of human intervention needed, in Spanish."
      }
    ]
  },
  "en": {
    "title": "Daily News: Copyright & Artificial Intelligence",
    "subtitle": "The latest in copyright law for musicians, composers, and producers.",
    "sections": [
      {
        "id": "law-changes",
        "title": "Recent Changes in Copyright Law",
        "content": "Summarize the latest major news about AI music copyright here in English."
      },
      {
        "id": "what-can-be-registered",
        "title": "What Can and Cannot Be Registered?",
        "content": "Explain clearly what musicians can and cannot register if they use AI, in English."
      },
      {
        "id": "human-intervention",
        "title": "Producers: Editing vs. Human Intervention",
        "content": "Answer the question: if I add real instruments or edit an AI track, can I register it? Focus on the amount of human intervention needed, in English."
      }
    ]
  }
}

Important: Use real, up-to-date facts as of 2024-2025 regarding the US Copyright Office and global trends. Translate the content smoothly.`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2, // Low temperature for factual consistency
    });

    const jsonString = completion.choices[0].message.content.trim();

    // Sometimes the AI still outputs markdown despite prompt, sanitize it:
    const cleanJson = jsonString.replace(/^\s*```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();

    // Parse it to ensure it's valid before saving
    const parsedData = JSON.parse(cleanJson);

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
