# CLAUDE.md

Proje rehberi `AGENTS.md` dosyasındadır — her oturumda onu da oku (stack, klasör haritası,
değişmez kurallar, konvansiyonlar).

## Git / commit / push kuralı (ÖNEMLİ)
- Bu proje **farklı bir GitHub hesabına** yüklüdür. **Commit ATMA, push YAPMA.**
- Push'u **kullanıcı kendi eliyle** yapar. Sen yalnızca kod değişikliklerini yaparsın.
- Değişiklikler test edilip hazır olduğunda, kullanıcıya **"push etmeyi unutma"** diye **kısaca hatırlat** —
  bunu her seferinde uzun uzun açıklamaya gerek yok, tek satır hatırlatma yeterli.
- Lokal (`npm run dev`) ile Vercel **aynı bulut Supabase**'ine bağlanır; bu yüzden lokalde veri
  değiştiren işlemler (silme, settlement finalize/paid, schema/migration) canlı veriyi de etkiler.
