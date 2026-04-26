const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 AYER (CUBA)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffset = -5 * 60 * 60 * 1000;

  const cubaNow = new Date(now.getTime() + cubaOffset);
  cubaNow.setDate(cubaNow.getDate() - 1);

  return cubaNow.toISOString().split("T")[0];
}

// =========================
// 📊 INSIGHTS GENERALES
// =========================
async function getMetric(pageId, token, metric, day) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since: day,
          until: day,
          access_token: token,
        },
      }
    );

    return res.data.data?.[0]?.values?.[0]?.value || 0;
  } catch (err) {
    console.log(`❌ ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES REALES (POSTS DEL DÍA)
// =========================
async function getShares(pageId, token, day) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  const since = new Date(day);
  const until = new Date(day);
  until.setDate(until.getDate() + 1);

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "created_time,shares",
          since: since.toISOString(),
          until: until.toISOString(),
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
    console.log("❌ SHARE ERROR:", err.response?.data || err.message);
  }

  return total;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const day = getYesterdayCuba();

  console.log("📅 Día:", day);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;
    const token = page.token;

    if (!fbPageId || !token) continue;

    console.log(`📊 Página ${dbPageId}`);

    // 🔍 evitar duplicados
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ Ya existe ${dbPageId}`);
      continue;
    }

    // =========================
    // 📊 MÉTRICAS DEL DÍA
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      token,
      "page_impressions_unique",
      day
    );

    const engagement = await getMetric(
      fbPageId,
      token,
      "page_post_engagements",
      day
    );

    const reactions = await getMetric(
      fbPageId,
      token,
      "page_actions_post_reactions_total",
      day
    );

    const share = await getShares(fbPageId, token, day);

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
      engagement,
      reaction: reactions,
      share,
      engagement_real: engagement,
      fecha: day,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT ${dbPageId}`);
  }
}

main();
