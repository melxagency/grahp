const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA REAL (FIX)
// =========================
function getCubaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// =========================
// 📊 METRICS META
// =========================
async function getMetric(pageId, token, metric, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since,
          until,
          access_token: token,
        },
      }
    );

    const values = res.data?.data?.[0]?.values || [];

    return values.reduce((sum, v) => sum + Number(v.value || 0), 0);
  } catch (err) {
    console.log("METRIC ERROR:", metric, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES ACUMULADOS
// =========================
async function getTotalShares(pageId, token) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "shares",
          limit: 100,
          access_token: token,
        },
      });

      for (const post of res.data.data || []) {
        total += post.shares?.count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("SHARE ERROR:", err.message);
  }

  return total;
}

// =========================
// 🚀 MAIN ACUMULADO GLOBAL
// =========================
async function main() {

  const { data: pages } = await supabase.from("pages").select("*");

  let totalImpresiones = 0;
  let totalReactions = 0;
  let totalEngagement = 0;
  let totalShares = 0;

  const today = getCubaDate();
  const yesterday = today; // acumulado hasta hoy

  for (const page of pages) {
    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    // 📊 MÉTRICAS ACUMULADAS POR PÁGINA
    const impresiones = await getMetric(
      pageId,
      token,
      "page_impressions_unique",
      "2000-01-01",
      yesterday
    );

    const engagement = await getMetric(
      pageId,
      token,
      "page_post_engagements",
      "2000-01-01",
      yesterday
    );

    const reactions = await getMetric(
      pageId,
      token,
      "page_actions_post_reactions_total",
      "2000-01-01",
      yesterday
    );

    const shares = await getTotalShares(pageId, token);

    totalImpresiones += impresiones;
    totalReactions += reactions;
    totalEngagement += engagement;
    totalShares += shares;
  }

  // =========================
  // 💾 INSERT ACUMULADO GLOBAL
  // =========================
  await supabase.from("reporte_diario_acumulado").insert({
    fecha: today,
    impresiones: totalImpresiones,
    reaction: totalReactions,
    engagement: totalEngagement,
    share: totalShares,
    created_at: new Date().toISOString(),
  });

  console.log("✅ REPORTE ACUMULADO GUARDADO");
}

main();
