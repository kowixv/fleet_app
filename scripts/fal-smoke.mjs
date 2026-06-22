// fal.ai bağlantı/anahtar testi (standalone).
//   node scripts/fal-smoke.mjs            -> metin endpoint testi
//   node scripts/fal-smoke.mjs <görsel>   -> vision endpoint testi (jpg/png/webp)
//
// FAL_KEY ortam değişkeni gerekir (lokal: `set FAL_KEY=...` / `export FAL_KEY=...`).

import { readFile } from "node:fs/promises";
import { fal } from "@fal-ai/client";

const KEY = process.env.FAL_KEY;
const MODEL = process.env.AI_MODEL || "google/gemini-2.5-flash";

if (!KEY) {
  console.error("HATA: FAL_KEY tanımlı değil. Önce keyini ayarla.");
  process.exit(1);
}
fal.config({ credentials: KEY });

const imagePath = process.argv[2];

try {
  if (imagePath) {
    const buf = await readFile(imagePath);
    const ext = imagePath.split(".").pop()?.toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
    console.log(`Vision testi (${MODEL}) — ${imagePath} ...`);
    const r = await fal.subscribe("openrouter/router/vision", {
      input: {
        prompt: "Bu görselde bir trucking yükü var mı? Varsa load number ve tutarı tek satırda söyle.",
        image_urls: [dataUri],
        model: MODEL,
        temperature: 0,
      },
    });
    console.log("\nÇIKTI:\n" + (r?.data?.output ?? "(boş)"));
  } else {
    console.log(`Metin testi (${MODEL}) ...`);
    const r = await fal.subscribe("openrouter/router", {
      input: {
        prompt: 'Sadece şu JSON\'u döndür: {"ok": true, "msg": "fal baglantisi calisiyor"}',
        model: MODEL,
        temperature: 0,
      },
    });
    console.log("\nÇIKTI:\n" + (r?.data?.output ?? "(boş)"));
  }
  console.log("\n✅ fal.ai çağrısı başarılı — key ve model çalışıyor.");
} catch (e) {
  console.error("\n❌ fal.ai çağrısı başarısız:", e?.message || e);
  process.exit(1);
}
