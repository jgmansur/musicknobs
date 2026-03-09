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
    // Exact same structure and content as "es", but translated to English.
    "title": "Daily News: Copyright & Artificial Intelligence",
    "subtitle": "The latest in copyright law for musicians, composers, and producers.",
    "sections": [ ... ]
  }
}

Important: Use real, up-to-date facts as of 2024-2025 regarding the US Copyright Office and global trends. Translate the content smoothly.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama3-70b-8192", // You can switch this to another model if preferred
            temperature: 0.2, // Low temperature for factual consistency
        });

        const jsonString = completion.choices[0].message.content.trim();

        // Sometimes the AI still outputs markdown despite prompt, sanitize it:
        const cleanJson = jsonString.replace(/^```json\n?/, '').replace(/\n?```$/, '');

        // Parse it to ensure it's valid before saving
        const parsedData = JSON.parse(cleanJson);

        // Write to file
        fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(parsedData, null, 2), 'utf8');
        console.log("Successfully updated data.json!");

    } catch (error) {
        console.error("Error fetching news:", error);
        process.exit(1);
    }
}

fetchNews();
