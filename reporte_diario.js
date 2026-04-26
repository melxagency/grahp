const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const FACEBOOK_TOKEN = process.env.PAGE_TOKEN; // ✅ TOKEN GLOBAL (GitHub Secrets)

// =========================
// 🇨🇺 FECHA CUBA
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs);
}

// =========================
// 📊 METRICS META (DÍA ÚNICO)
// =========================
async function getMetric(pageId, metric, day) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since: day,
          until: day,
          access_token: FACEBOOK_TOKEN,
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];
    return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);
  } catch (err) {
    console.log("❌ METRIC ERROR:", metric, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES (POSTS)
// =========================
async function getTotalShares(pageId) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "shares",
          limit: 100,
          access_token: FACEBOOK_TOKEN,
        },
      });

      for (const post of res.data.data || []) {
        total += post.shares?.count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ SHARE ERROR:", err.response?.data || err.message);
  }

  return total;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const today = getCubaDate();

  // 👉 SOLO AYER
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateStr = yesterday.toISOString().split("T")[0];

  console.log("📅 Procesando día:", dateStr);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;

    if (!fbPageId) continue;

    // =========================
    // 🔍 EVITAR DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", dateStr)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ YA EXISTE ${dbPageId} ${dateStr}`);
      continue;
    }

    // =========================
    // 📊 MÉTRICAS DEL DÍA
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      "page_impressions_unique",
      dateStr
    );

    const reactions = await getMetric(
      fbPageId,
      "page_actions_post_reactions_like_total",
      dateStr
    );

    const engagement = await getMetric(
      fbPageId,
      "page_post_engagements",
      dateStr
    );

    const share = await getTotalShares(fbPageId);

    // =========================
    // 💾 INSERT
    // =========================
    await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      impresiones,
      reaction: reactions,
      engagement,
      engagement_real: engagement,
      share,
      fecha: dateStr,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT OK ${dbPageId} ${dateStr}`, {
      impresiones,
      engagement,
      reactions,
      share,
    });
  }
}

main();
