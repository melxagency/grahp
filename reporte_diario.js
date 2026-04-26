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
  const cubaOffset = -5 * 60 * 60 * 1000;

  const cubaTime = new Date(now.getTime() + cubaOffset);
  cubaTime.setDate(cubaTime.getDate() - 1);

  return cubaTime.toISOString().split("T")[0];
}

// =========================
// 📊 METRICAS META
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
      (sum, item) => sum + (Number(item.value) || 0),
      0
    );
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  if (!TOKEN) {
    throw new Error("❌ PAGE_TOKEN no encontrado en GitHub Secrets");
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

    // =========================
    // 🔍 EVITAR DUPLICADOS
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

    console.log(`📊 Procesando página ${dbPageId}`);

    // =========================
    // 📊 MÉTRICAS BASE
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

    // =========================
    // 💾 INSERT
    // =========================
    await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      impresiones,
      engagement,
      reaction: reactions,
      share: 0,
      engagement_real: engagement,
      fecha: day,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT OK ${dbPageId} ${day}`);
  }
}

main();
