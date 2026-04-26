const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const TOKEN = process.env.PAGE_TOKEN;

// =========================
// 🇨🇺 FECHA CUBA (AYER)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;

  const cubaNow = new Date(now.getTime() + cubaOffsetMs);
  cubaNow.setDate(cubaNow.getDate() - 1);

  return cubaNow.toISOString().split("T")[0];
}

// =========================
// 📊 METRICS META (FIX REAL)
// =========================
async function getMetric(pageId, metric, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since,
          until,
          access_token: TOKEN,
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];

    return values.reduce(
      (sum, d) => sum + (Number(d.value) || 0),
      0
    );
  } catch (err) {
    console.log(`❌ METRIC ERROR (${metric})`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES (FIX)
# mejor endpoint sin tokens rotos en insights
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
          access_token: TOKEN,
        },
      });

      for (const post of res.data.data || []) {
        total += post.shares?.count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ SHARE ERROR", err.response?.data || err.message);
  }

  return total;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  if (!TOKEN) {
    throw new Error("❌ PAGE_TOKEN no existe en env");
  }

  const { data: pages } = await supabase.from("pages").select("*");

  const day = getYesterdayCuba();
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  const since = day;
  const until = nextDay.toISOString().split("T")[0];

  console.log("📅 Procesando día:", day);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;

    if (!fbPageId) continue;

    console.log(`📊 Procesando página ${dbPageId}`);

    // =========================
    // 🔍 DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ YA EXISTE ${dbPageId} ${day}`);
      continue;
    }

    // =========================
    // 📊 MÉTRICAS CORREGIDAS
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      "page_impressions",
      since,
      until
    );

    const engagement = await getMetric(
      fbPageId,
      "page_post_engagements",
      since,
      until
    );

    const reactions = await getMetric(
      fbPageId,
      "page_actions_post_reactions_total",
      since,
      until
    );

    const share = await getTotalShares(fbPageId);

    const result = {
      impresiones,
      engagement,
      reactions,
      share,
    };

    console.log("📈 Resultado:", result);

    // =========================
    // 💾 INSERT
    // =========================
    await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      impresiones,
      reaction: reactions,
      engagement,
      share,
      engagement_real: engagement,
      fecha: day,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT OK ${dbPageId} ${day}`);
  }
}

main();
