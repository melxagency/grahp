const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA (AYER REAL)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  const cuba = new Date(now.getTime() + cubaOffsetMs);

  cuba.setDate(cuba.getDate() - 1); // 👈 SOLO AYER

  const date = cuba.toISOString().split("T")[0];
  return date;
}

// =========================
// 📊 METRICAS FACEBOOK (FIXED)
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
    return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);
  } catch (err) {
    console.log(`❌ METRIC ERROR (${metric})`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES (FIX)
// =========================
async function getTotalShares(pageId, token, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/posts`,
      {
        params: {
          fields: "shares,created_time",
          since,
          until,
          limit: 100,
          access_token: token,
        },
      }
    );

    let total = 0;

    for (const post of res.data.data || []) {
      total += post.shares?.count || 0;
    }

    return total;
  } catch (err) {
    console.log("❌ SHARE ERROR", err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const yesterday = getYesterdayCuba();

  console.log("📅 Procesando día:", yesterday);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;
    const token = process.env.PAGE_TOKEN; // 👈 SOLO UNO GLOBAL

    if (!fbPageId || !token) continue;

    // =========================
    // ❌ EVITAR DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", yesterday)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ YA EXISTE ${dbPageId} ${yesterday}`);
      continue;
    }

    console.log(`📊 Procesando página ${dbPageId}`);

    // =========================
    // 📆 SOLO AYER
    // =========================
    const since = yesterday;
    const until = yesterday;

    // =========================
    // 📊 METRICS
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      token,
      "page_impressions_unique",
      since,
      until
    );

    const engagement = await getMetric(
      fbPageId,
      token,
      "page_post_engagements",
      since,
      until
    );

    const reactions = await getMetric(
      fbPageId,
      token,
      "page_actions_post_reactions_total",
      since,
      until
    );

    const share = await getTotalShares(fbPageId, token, since, until);

    const result = {
      impresiones,
      engagement,
      reactions,
      share,
    };

    console.log("📈 Resultado:", result);

    // =========================
    // 💾 INSERT FINAL
    // =========================
    await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      impresiones,
      engagement,
      reaction: reactions,
      share,
      engagement_real: engagement,
      fecha: yesterday,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT OK ${dbPageId} ${yesterday}`);
  }
}

main();
