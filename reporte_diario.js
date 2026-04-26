const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 AYER
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;

  const cuba = new Date(now.getTime() + cubaOffsetMs);
  cuba.setDate(cuba.getDate() - 1);

  return cuba.toISOString().split("T")[0];
}

// =========================
// 📊 METRIC SAFE
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

    const values = res.data.data?.[0]?.values || [];

    return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);

  } catch (err) {
    // 👇 no romper script si métrica no existe
    return 0;
  }
}

// =========================
// 🔥 SHARES
// =========================
async function getShares(pageId, token) {
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

  const day = getYesterdayCuba();

  console.log("📅 Día:", day);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;
    const token = page.token;

    if (!fbPageId || !token) continue;

    console.log(`📊 Página ${dbPageId}`);

    // evitar duplicados
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log("⏭️ Existe");
      continue;
    }

    // =========================
    // 📊 MÉTRICAS SEGURAS
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

    const share = await getShares(fbPageId, token);

    console.log("📈", {
      impresiones,
      engagement,
      reactions,
      share,
    });

    // guardar
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
