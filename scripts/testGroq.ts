import fs from "fs";

async function main() {
  const env = fs.readFileSync(".env.local", "utf8");
  const match = env.match(/GROQ_API_KEY=(.+)/);
  const key = match ? match[1].trim() : "";

  const sys = 'You suggest complementary music genre/mood pairs for a stereo-split listening app, where one track plays in each ear. Given a vibe description, respond with ONLY a raw JSON object, no markdown formatting, no code fences, no explanation outside the JSON: {"searchQueryA": string, "searchQueryB": string, "reasoning": string}. searchQueryA and searchQueryB should be short genre/mood search terms (2-4 words each, e.g. \'calm ambient piano\' or \'upbeat electronic\') suitable for searching a royalty-free music catalog. reasoning is one sentence explaining why these two complement each other for the given vibe.';

  // Test with groq/compound-mini
  const res1 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      model: "groq/compound-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: "focused and productive" },
      ],
      temperature: 0.7,
      max_tokens: 200,
    }),
  });

  console.log("=== GROQ COMPOUND-MINI STATUS ===", res1.status);
  const text1 = await res1.text();
  console.log("=== GROQ COMPOUND-MINI RAW RESPONSE ===");
  console.log(text1);
}

main().catch(console.error);
