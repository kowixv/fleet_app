# 06 — Codex + MCP Kurulumu

Bundan sonraki geliştirmeler **Codex** ile yapılacak. Codex, **MCP (Model Context Protocol)**
sunucularına bağlanarak harici araçları kullanabilir. Bu projede iki MCP işini çok kolaylaştırır:
**Supabase MCP** (veritabanı şemasını okuma/SQL doğrulama) ve **fal MCP** (model erişimi).

> Codex repo kökündeki **`AGENTS.md`** dosyasını otomatik okur — proje kuralları orada. MCP ise
> harici sistemlere (DB, fal) bağlanmak içindir.

## Codex MCP nasıl yapılandırılır?
- Config dosyası: **`~/.codex/config.toml`** (global) veya güvenilen projede `.codex/config.toml`.
- Her sunucu `[mcp_servers.<ad>]` bloğuyla tanımlanır:
  - **stdio** sunucu: `command` + `args` + opsiyonel `env`.
  - **HTTP** sunucu: `url` + opsiyonel `bearer_token_env_var`.
- CLI ile de eklenebilir: `codex mcp add <ad> -- <komut> <args...>` ve `codex mcp list`.
- Resmî dokümanlar: [Codex MCP](https://developers.openai.com/codex/mcp),
  [Config reference](https://developers.openai.com/codex/config-reference).

## 1) Supabase MCP (read-only — önerilen)
Codex'in şemayı okuyup SQL'i doğrulayabilmesi ama **yazamaması** için read-only kurулur.

**Erişim token'ı:** Supabase → **Account → Access Tokens** → yeni **Personal Access Token** oluştur
(ör. "codex-mcp"). **project-ref**: Supabase Project URL'indeki alt alan adı
(`https://<PROJECT_REF>.supabase.co`).

`~/.codex/config.toml`:
```toml
[mcp_servers.supabase]
command = "npx"
args = [
  "-y", "@supabase/mcp-server-supabase@latest",
  "--read-only",
  "--project-ref=PROJECT_REF_BURAYA"
]

[mcp_servers.supabase.env]
SUPABASE_ACCESS_TOKEN = "sbp_xxx_personal_access_token"
```
- `--read-only`: yalnızca okuma; veritabanına yazmayı engeller (önerilir).
- Resmî kaynak: [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp),
  [github: supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp).

Ne işe yarar: Codex'e "settlements tablosuna şu kolonu ekleyen migration'ı yaz" dediğinde mevcut
şemayı gerçek DB'den okuyup doğru SQL üretir; tabloları/RLS'i listeler.

## 2) fal MCP (model erişimi)
fal, 1000+ modele MCP üzerinden erişim sağlayan bir MCP sunucusu sunar
([fal blog](https://blog.fal.ai/connect-your-ai-to-1-000-models-with-the-fal-mcp-server/)).
Bu sayede Codex, geliştirme sırasında fal modellerini deneyebilir.

stdio (npx) deseni — **paket adını fal blog/dokümanından teyit et**, tipik kalıp:
```toml
[mcp_servers.fal]
command = "npx"
args = ["-y", "<fal-mcp-paket-adi>"]   # fal blog'undaki güncel paket adını kullan

[mcp_servers.fal.env]
FAL_KEY = "fal_key_buraya"
```
Eğer fal **hosted (HTTP)** bir MCP URL'i veriyorsa, alternatif:
```toml
[mcp_servers.fal]
url = "https://<fal-mcp-url>"
bearer_token_env_var = "FAL_KEY"
```

## 3) Doğrulama
```bash
codex mcp list          # tanımlı sunucular
# Codex oturumunda: "list supabase tables" / "describe settlements table" gibi iste
```

## İpuçları
- Token'ları config.toml'a düz metin yazmak yerine ortam değişkeninden okutmak daha güvenli; en
  azından dosyayı git'e **koyma** (kişisel `~/.codex/` altında tut).
- Üretim DB'sinde Codex'e yazma yetkisi verme; `--read-only` ile sınırla, migration'ları sen
  **SQL Editor**'den uygula veya ayrı bir staging projesinde dene.
- Bu projeye özel kurallar (settlement motorunu bozma, testleri yeşil tut) `AGENTS.md`'de; Codex
  bunları otomatik okur.
