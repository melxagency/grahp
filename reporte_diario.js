const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs)
    .toISOString()
    .split("T")[0];
}

// =========================
// 📊 METRICS CORRECTAS
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

    const values = res.data.data?.[0]?.values || [];

    return values.reduce((sum, v) => {
      if (typeof v.value === "number") return sum + v.value;
      if (typeof v.value === "object") return sum + (v.value.total || 0);
      return sum + (v.value || 0);
    }, 0);

  } catch (err) {
    return 0;
  }
}

// =========================
// 🔥 SHARE TOTAL (OK)
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
  } catch {}

  return total;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {

  const { data: pages } = await supabase.from("pages").select("*");
  const today = getCubaDate();

  // rango amplio REAL
  const since = "2000-01-01";
  const until = today;

  for (const page of pages) {

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    try {

      // =========================
      // 📊 MÉTRICAS CORRECTAS
      // =========================
      const impresiones = await getMetric(
        pageId,
        token,
        "page_impressions_unique",
        since,
        until
      );

      const reactions = await getMetric(
        pageId,
        token,
        "page_actions_post_reactions_like_total",
        since,
        until
      );

      const engagement = await getMetric(
        pageId,
        token,
        "page_post_engagements",
        since,
        until
      );

      // =========================
      // 🔥 SHARE
      // =========================
      const share = await getTotalShares(pageId, token);

      // =========================
      // 🧾 UPSERT
      // =========================
      const payload = {
        pagina: page.nombre,
        fecha: today,
        impresiones,
        reaction: reactions,
        engagement,
        engagement_real: engagement,
        share,
        post: 0,
        created_at: new Date().toISOString()
      };

      const { data: existing } = await supabase
        .from("reporte_diario_acumulado")
        .select("id_record")
        .eq("pagina", page.nombre)
        .maybeSingle();

      if (!existing) {
        await supabase.from("reporte_diario_acumulado").insert(payload);
        console.log(`📊 INSERT ${page.nombre}`);
      } else {
        await supabase
          .from("reporte_diario_acumulado")
          .update(payload)
          .eq("pagina", page.nombre);

        console.log(`🔄 UPDATE ${page.nombre}`);
      }

    } catch (err) {
      console.log(`❌ ERROR ${page.nombre}:`, err.message);
    }
  }
}

main();
