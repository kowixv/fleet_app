# -*- coding: utf-8 -*-
"""
Fleet App tanıtım PDF'ini üretir (Türkçe, kullanım ağırlıklı, mockup + diyagram).
Çalıştır:  python docs/tanitim/build_pdf.py
Çıktı:     Fleet-App-Tanitim.pdf  (repo kökü)
Not: Türkçe karakterler için Windows Arial fontu kullanılır.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, FrameBreak, NextPageTemplate, PageBreak, Flowable,
)

# ---------- Fonts (Türkçe) ----------
FONTS = r"C:\Windows\Fonts"
pdfmetrics.registerFont(TTFont("TR", os.path.join(FONTS, "arial.ttf")))
pdfmetrics.registerFont(TTFont("TR-B", os.path.join(FONTS, "arialbd.ttf")))
pdfmetrics.registerFont(TTFont("TR-I", os.path.join(FONTS, "ariali.ttf")))
pdfmetrics.registerFontFamily("TR", normal="TR", bold="TR-B", italic="TR-I")

# ---------- Palette ----------
BRAND = colors.HexColor("#0f766e")
BRAND_D = colors.HexColor("#115e59")
INK = colors.HexColor("#0f172a")
SUB = colors.HexColor("#475569")
LINE = colors.HexColor("#e2e8f0")
BAND = colors.HexColor("#f1f5f9")
AMBER = colors.HexColor("#b45309")
AMBERBG = colors.HexColor("#fef3c7")
GREEN = colors.HexColor("#15803d")
GREENBG = colors.HexColor("#dcfce7")
REDBG = colors.HexColor("#fee2e2")
RED = colors.HexColor("#b91c1c")

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "Fleet-App-Tanitim.pdf")

# ---------- Styles ----------
def S(name, **kw):
    base = dict(fontName="TR", fontSize=10, leading=14, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)

st_h1 = S("h1", fontName="TR-B", fontSize=17, leading=21, textColor=BRAND_D, spaceAfter=4)
st_h2 = S("h2", fontName="TR-B", fontSize=13, leading=17, textColor=BRAND_D, spaceBefore=4, spaceAfter=4)
st_body = S("body", spaceAfter=5)
st_sub = S("sub", textColor=SUB, fontSize=9, leading=12)
st_white = S("white", fontName="TR-B", fontSize=12, textColor=colors.white)
st_white_h = S("whiteh", fontName="TR-B", fontSize=10.5, textColor=colors.white)
st_lead = S("lead", fontSize=11, leading=16, textColor=SUB)
st_small = S("small", fontSize=8.5, leading=11.5, textColor=SUB)
st_card_t = S("cardt", fontName="TR-B", fontSize=10, textColor=INK)
st_step = S("step", fontSize=9, leading=12, textColor=INK)
st_step_b = S("stepb", fontName="TR-B", fontSize=9, leading=12, textColor=BRAND_D)
st_chat = S("chat", fontSize=9, leading=13, textColor=INK)
st_btn = S("btn", fontName="TR-B", fontSize=9, textColor=colors.white, alignment=1)

USABLE = A4[0] - 3.0 * cm  # margins 1.5cm each


def section_bar(title):
    t = Table([[Paragraph(title, st_white)]], colWidths=[USABLE])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRAND),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    return t


def bullets(items, style=st_body):
    rows = [[Paragraph("●", S("b", textColor=BRAND, fontSize=6)), Paragraph(x, style)] for x in items]
    t = Table(rows, colWidths=[0.5 * cm, USABLE - 0.5 * cm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (0, -1), 2),
    ]))
    return t


def card(title_html, body_flowables, width=USABLE, accent=BRAND):
    """UI 'card' mockup: colored header + bordered body."""
    header = Table([[Paragraph(title_html, st_white_h)]], colWidths=[width])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    body = Table([[f] for f in body_flowables], colWidths=[width])
    body.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
    ]))
    outer = Table([[header], [body]], colWidths=[width])
    outer.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return outer


def stat(label, value, color=INK):
    return card("", [Paragraph(label, st_small), Paragraph(value, S("v", fontName="TR-B", fontSize=15, textColor=color))], accent=colors.white)


def flow(steps):
    """Yatay akış: [kutu] -> [kutu] -> ..."""
    cells = []
    n = len(steps)
    box_w = (USABLE - (n - 1) * 0.55 * cm) / n
    row = []
    widths = []
    for i, s in enumerate(steps):
        box = Table([[Paragraph(s, S("fl", fontName="TR-B", fontSize=8.5, leading=11, textColor=BRAND_D, alignment=1))]], colWidths=[box_w])
        box.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 1, BRAND),
            ("BACKGROUND", (0, 0), (-1, -1), BAND),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]))
        row.append(box); widths.append(box_w)
        if i < n - 1:
            row.append(Paragraph("➔", S("ar", fontName="TR-B", fontSize=13, textColor=BRAND, alignment=1)))
            widths.append(0.55 * cm)
    t = Table([row], colWidths=widths)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return t


def kv_table(rows, col0=BRAND):
    data = [[Paragraph(k, S("k", fontName="TR-B", fontSize=9, textColor=colors.white)),
             Paragraph(v, S("vv", fontSize=9))] for k, v in rows]
    t = Table(data, colWidths=[5.2 * cm, USABLE - 5.2 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), col0),
        ("ROWBACKGROUNDS", (1, 0), (1, -1), [colors.white, BAND]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def model_table(rows):
    head = [Paragraph(h, st_white_h) for h in ["#", "Model", "Nasıl hesaplanır", "Örnek net"]]
    data = [head] + [[Paragraph(str(a), st_step), Paragraph(b, st_step_b), Paragraph(c, st_step), Paragraph(d, S("n", fontName="TR-B", fontSize=9, textColor=GREEN))] for a, b, c, d in rows]
    t = Table(data, colWidths=[0.8 * cm, 3.3 * cm, USABLE - 7.4 * cm, 3.3 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BAND]),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


class HBar(Flowable):
    def __init__(self, w, h=3, color=BRAND):
        super().__init__(); self.w = w; self.h = h; self.color = color
    def draw(self):
        self.canv.setFillColor(self.color); self.canv.rect(0, 0, self.w, self.h, fill=1, stroke=0)


# ---------- Build story ----------
story = []

def H1(t): story.append(Paragraph(t, st_h1))
def H2(t): story.append(KeepTogether([Spacer(1, 6), Paragraph(t, st_h2)]))
def P(t): story.append(Paragraph(t, st_body))
def SP(h=6): story.append(Spacer(1, h))
def BAR(t): story.append(KeepTogether([Spacer(1, 8), section_bar(t), Spacer(1, 6)]))

# ===== KAPAK =====
story.append(Spacer(1, 3.2 * cm))
story.append(HBar(USABLE, 5, BRAND))
SP(10)
story.append(Paragraph("Fleet Settlement App", S("cover", fontName="TR-B", fontSize=30, leading=34, textColor=BRAND_D)))
SP(6)
story.append(Paragraph("Trucking filosu için settlement (hakediş), Telegram yük otomasyonu, bakım takibi ve PDF statement uygulaması", st_lead))
SP(16)
story.append(Paragraph("Telegram'dan gelen yükleri otomatik okur, her araç için doğru hakedişi hesaplar, "
                       "profesyonel PDF statement üretir ve bakım zamanını hatırlatır.", st_body))
SP(28)
story.append(card("İçindekiler", [
    bullets([
        "1. Fleet App nedir? &nbsp; 2. Genel mimari &nbsp; 3. Telegram'dan kullanım",
        "4. Arayüzden kullanım (sayfa sayfa) &nbsp; 5. Settlement akışı + 5 ödeme modeli",
        "6. Bakım (PM) takibi &nbsp; 7. Kurulum özeti &nbsp; 8. Geliştirici eki (Codex)",
    ], st_step),
]))
SP(20)
story.append(Paragraph("Teknoloji: Next.js · Supabase · Telegram Bot · fal.ai · Vercel — tamamı ücretsiz katmanda.", st_small))
story.append(PageBreak())

# ===== 1. NEDİR =====
BAR("1. Fleet App nedir?")
P("~10–15 araçlık bir trucking operasyonunu tek yerden yönetmek için tasarlandı. En büyük darboğaz olan "
  "<b>Telegram gruplarından gelen yük bilgisini otomatik içeri almayı</b> ve <b>her aracın farklı kazanç "
  "modeline göre hakediş hesabını</b> çözer.")
SP(2)
story.append(bullets([
    "<b>Yük takibi</b> — güzergah, mil ve kazanç; Telegram'dan otomatik veya elle.",
    "<b>Esnek settlement motoru</b> — her araç/şoför için farklı yüzde, company fee, komisyon.",
    "<b>PDF statement</b> — bilingual (EN/TR) profesyonel hakediş belgesi.",
    "<b>Bakım takibi</b> — mil/tarih bazlı; zamanı gelince dashboard + Telegram uyarısı.",
    "<b>Masraf takibi</b> — yakıt, sigorta, ELD/IFTA, tolls… settlement'a otomatik düşer.",
    "<b>Dashboard</b> — haftalık gross/masraf/net, komisyon, bekleyen işler tek ekranda.",
]))
SP(4)
P("<b>Kimin için?</b> Kendi şirketinde company driver/box truck çalıştıran, owner-operator yöneten, "
  "yatırımcı aracı işleten veya dış carrier statement'ı alan filo sahipleri.")

# ===== 2. MİMARİ =====
BAR("2. Genel mimari")
P("Her şey tek bir web uygulamasında. Veriler Supabase'te, barındırma Vercel'de, yük okuma fal.ai ile, "
  "yük girişi Telegram bot ile yapılır.")
SP(4)
story.append(flow(["Telegram\ngrubu", "fal.ai\nyükü okur", "Onay\nkuyruğu", "Load\nkaydı", "Settlement\nmotoru", "PDF\nstatement"]))
SP(8)
P("<b>Paralel akış (bakım):</b>")
SP(2)
story.append(flow(["Mileage\ngüncelle", "Durum\nhesabı", "Dashboard\nuyarısı", "Günlük\nTelegram uyarısı"]))
SP(6)
P("Önemli kural: yükler <b>asla otomatik</b> kaydolmaz — fal.ai okur, sen <b>onaylarsın</b>, sonra resmi "
  "kayıt oluşur. Finalized/Paid hakedişler kilitlenir, değiştirilemez.")

story.append(PageBreak())

# ===== 3. TELEGRAM =====
BAR("3. Telegram'dan kullanım")
P("Her şoför grubunu bir kez araç + şoför ile eşlersin. Sonra o gruba düşen her yük otomatik işlenir.")
SP(2)
story.append(bullets([
    "<b>1.</b> Şoför gruba yük gönderir: Rate Confirmation PDF, Amazon Relay ekran görüntüsü veya düz mesaj.",
    "<b>2.</b> Bot dosyayı/mesajı okur (fal.ai), güzergah–mil–tutarı çıkarır.",
    "<b>3.</b> Bot gruba <b>özet + Onayla / Reddet</b> butonlarıyla yanıt verir.",
    "<b>4.</b> <b>Onayla</b> → o araca/şoföre bağlı resmi <b>Load</b> kaydı oluşur (aynı kuyruk web'de de var).",
    "<b>5.</b> Yanlış okuma olursa web'den <b>Düzenle</b> ile düzeltip onaylarsın.",
]))
SP(8)
# Telegram bot mesajı mockup
chat_lines = [
    Paragraph("🤖 <b>Yük Botu</b>", S("bot", fontName="TR-B", fontSize=9, textColor=BRAND_D)),
    Spacer(1, 3),
    Paragraph("📦 <b>Yeni yük algılandı</b>", st_chat),
    Paragraph("Load #: 111WCQBHG", st_chat),
    Paragraph("Broker: Amazon Relay", st_chat),
    Paragraph("Güzergah: BNA3 → CSG1 → MOB5", st_chat),
    Paragraph("Mil: 410 &nbsp;·&nbsp; Tutar: $1,570.51", st_chat),
    Spacer(1, 2),
    Paragraph("Onaylıyor musunuz?", st_chat),
    Spacer(1, 5),
]
btns = Table([[Paragraph("✅ Onayla", st_btn), Paragraph("❌ Reddet", st_btn)]], colWidths=[(USABLE-1*cm)/2-10, (USABLE-1*cm)/2-10])
btns.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, 0), GREEN), ("BACKGROUND", (1, 0), (1, 0), RED),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
]))
chat_lines.append(btns)
story.append(card("Telegram — bot yanıtı (örnek)", chat_lines, accent=colors.HexColor("#229ED9")))
SP(6)
P("<b>Chat ID nasıl bulunur?</b> Botu gruba ekle, gruba bir mesaj at; bot henüz eşlenmemiş grupta "
  "Chat ID'yi yanıt olarak yazar. Bu ID'yi <b>Settings → Telegram Grupları</b>'na girip araç/şoför seçersin.")

story.append(PageBreak())

# ===== 4. ARAYÜZ =====
BAR("4. Arayüzden kullanım (sayfa sayfa)")
P("Sol menüden tüm sayfalara ulaşılır. Her şey Telegram'dan girilebildiği gibi buradan da görülüp düzenlenir.")
SP(4)

# Dashboard mockup
g1 = Table([[stat("Bu Hafta Gross", "$3.914", BRAND), stat("Bu Hafta Net", "$1.760", INK),
             stat("Toplam Komisyon", "$250", GREEN), stat("Bekleyen Yük", "2", AMBER)]],
           colWidths=[USABLE/4]*4)
g1.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),2),("RIGHTPADDING",(0,0),(-1,-1),2),("VALIGN",(0,0),(-1,-1),"TOP")]))
warn = Table([[Paragraph("Unit 14105 · Oil Change", st_step), Paragraph("2.500 mi kaldı", st_small), Paragraph("Due Soon", S("ds", fontName="TR-B", fontSize=8, textColor=AMBER, alignment=2))]],
             colWidths=[USABLE*0.5-16, USABLE*0.3-16, USABLE*0.2-16])
warn.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),AMBERBG),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),("LEFTPADDING",(0,0),(-1,-1),6)]))
story.append(card("Dashboard", [g1, Spacer(1, 5), Paragraph("Bakım Uyarıları", st_card_t), Spacer(1,3), warn]))
SP(6)

story.append(kv_table([
    ("Telegram Yükleri", "Gelen yüklerin onay kuyruğu — Onayla / Düzenle / Reddet."),
    ("Loads", "Tüm yükler; elle de eklenebilir (load #, güzergah, gross, mil, durum)."),
    ("Expenses", "Masraflar; kategori + 'settlement'tan düş' işareti."),
    ("Settlements", "Hakediş oluştur (tip+araç+hafta), hesapla, PDF indir, Finalize/Paid."),
    ("Vehicles / Units", "Araç + ödeme config'i: driver %, company fee %, komisyon, sahiplik."),
    ("People", "Şoför / owner-operator / investor; varsayılan pay %'leri."),
    ("Companies / Carriers", "Kendi şirketlerin ve dış carrier'lar."),
    ("Maintenance", "Bakım kuralları + mileage güncelleme + durum."),
    ("Settings", "Telegram grup eşleme, varsayılan komisyon, PM/uyarı eşikleri."),
]))

story.append(PageBreak())

# ===== 5. SETTLEMENT =====
BAR("5. Haftalık settlement akışı + 5 ödeme modeli")
story.append(flow(["Tip + Araç +\nHafta seç", "Override\n(ops.)", "Hesapla &\nKaydet", "Dökümü\ngör", "PDF\nİndir", "Finalize →\nPaid"]))
SP(8)
P("Motor seçilen aralıktaki yükleri ve 'settlement'tan düş' işaretli masrafları toplar; araç/şoför "
  "config'ine göre net hakedişi ve bizim komisyonu hesaplar. <b>Hiçbir ödeme modeli sabit değildir.</b>")
SP(4)
story.append(model_table([
    (1, "Company Driver", "Gross × driver % − kesintiler (fee yok)", "$976,19×33% = $322,14"),
    (2, "Box Truck Driver", "(Relay+Street) × driver %", "$1.957,81×20% = $391,56"),
    (3, "Owner Operator", "Gross − company fee − yakıt/sigorta/ELD", "$10.454,39 → $6.360,98"),
    (4, "Managed / Investor", "Gross − dış fee − driver − masraf − komisyon", "$5.500 → $1.306,85"),
    (5, "External Carrier", "Dış net pay − $250 komisyon", "$6.671,19 → $6.421,19"),
]))
SP(6)
P("<b>PDF statement</b> bilingual (EN/TR): özet, hesaplama dökümü, yük detayları, masraf detayları ve "
  "imza bloğu içerir. (İmza bloğunda logo/MC/DOT/telefon/email/adres bulunmaz.)")

# ===== 6. BAKIM =====
BAR("6. Bakım (Preventive Maintenance) takibi")
P("Her araç için mil veya tarih bazlı bakım kuralı tanımlanır; aracın güncel mili girildikçe durum hesaplanır.")
SP(2)
status_tbl = Table([
    [Paragraph("Durum", st_white_h), Paragraph("Anlamı", st_white_h)],
    [Paragraph("OK", S("ok", fontName="TR-B", textColor=GREEN, fontSize=9)), Paragraph("Zamanı gelmedi", st_step)],
    [Paragraph("Due Soon", S("dsx", fontName="TR-B", textColor=AMBER, fontSize=9)), Paragraph("Eşik mesafesine girdi (ör. 2.500 mil kaldı)", st_step)],
    [Paragraph("Overdue", S("ov", fontName="TR-B", textColor=RED, fontSize=9)), Paragraph("Geçti — acil", st_step)],
], colWidths=[3.5*cm, USABLE-3.5*cm])
status_tbl.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0),BRAND), ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,BAND]),
    ("GRID",(0,0),(-1,-1),0.5,LINE), ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("LEFTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
]))
story.append(status_tbl)
SP(4)
P("Zamanı gelen bakımlar <b>Dashboard'da kart</b> olarak çıkar ve <b>günlük bir Telegram uyarısı</b> ile "
  "ilgili gruba bildirilir. Bakım yapılınca 'Yapıldı işaretle' ile yeni baz mil/tarih alınır.")

story.append(PageBreak())

# ===== 7. KURULUM =====
BAR("7. Kurulum özeti")
P("Detaylı adımlar repo içindeki <b>docs/</b> klasöründe. Kısaca:")
SP(2)
story.append(kv_table([
    ("Supabase", "Ücretsiz proje aç → supabase/schema.sql çalıştır (tablolar+RLS+bucket otomatik) → API anahtarları."),
    ("fal.ai", "Hesap → FAL_KEY (yük okuma). 'npm run smoke:fal' ile test et."),
    ("Telegram", "@BotFather → token → botu gruba ekle (admin) → setWebhook → grupları eşle."),
    ("Vercel", "GitHub'a push → import → env değişkenleri → deploy (cron otomatik)."),
    ("Ortam değişkenleri", "docs/07-ortam-degiskenleri.md — Supabase, FAL_KEY, Telegram, secret'lar."),
]))
SP(5)
P("<b>Lokal:</b> <font face='TR-B'>npm install → npm run dev</font> → Kayıt ol → (ops.) "
  "<font face='TR-B'>supabase/seed.sql</font> ile örnek veri → settlement + PDF dene.")

# ===== 8. GELİŞTİRİCİ EKİ =====
BAR("8. Geliştirici eki (Codex ile devam)")
P("Proje Codex ile geliştirilecek şekilde devredilir. Her şey repoda:")
SP(2)
story.append(bullets([
    "<b>AGENTS.md</b> — Codex'in otomatik okuduğu kurallar (settlement motoru sabit kalır, testler yeşil, RLS, fal.ai).",
    "<b>docs/</b> — 01 mimari → 10 maliyet (şema, Supabase, Telegram, fal.ai, Codex MCP).",
    "<b>Codex MCP</b> — Supabase (read-only) + fal MCP; config örnekleri docs/06'da.",
    "<b>Komutlar</b> — npm install · npm run dev · npm run build · npm test (7/7) · npm run lint · npm run smoke:fal.",
    "<b>Başlangıç</b> — klonla → npm install → Supabase şema → Kayıt ol → seed → geliştirmeye başla.",
]))
SP(8)
story.append(HBar(USABLE, 3, BRAND))
SP(4)
story.append(Paragraph("Fleet Settlement App — bu belge uygulamanın kullanımını tanıtır. "
              "Teknik detay için repo kökündeki README.md ve docs/ klasörüne bakın.", st_small))


# ---------- Page chrome ----------
def on_page(canvas, doc):
    canvas.saveState()
    # footer
    canvas.setFont("TR", 8)
    canvas.setFillColor(SUB)
    canvas.drawString(1.5 * cm, 1.0 * cm, "Fleet Settlement App")
    canvas.drawRightString(A4[0] - 1.5 * cm, 1.0 * cm, "Sayfa %d" % doc.page)
    canvas.setStrokeColor(LINE)
    canvas.line(1.5 * cm, 1.3 * cm, A4[0] - 1.5 * cm, 1.3 * cm)
    canvas.restoreState()


doc = BaseDocTemplate(
    os.path.abspath(OUT), pagesize=A4,
    leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.5 * cm, bottomMargin=1.6 * cm,
    title="Fleet Settlement App - Tanitim", author="Fleet App",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, USABLE, A4[1] - doc.topMargin - doc.bottomMargin, id="main")
doc.addPageTemplates([PageTemplate(id="t", frames=[frame], onPage=on_page)])
doc.build(story)
print("OK ->", os.path.abspath(OUT))
