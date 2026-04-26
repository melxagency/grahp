const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA (AYER)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;

  const cuba = new Date(now.getTime() + cubaOffsetMs);
  cuba.setDate(cuba.getDate() - 1);

  return cuba.toISOString().split("T")[0];
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
          access_token: token, // 👈 TOKEN POR PÁGINA
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];

    return values.reduce((sum, item) => {
      return sum + (Number(item.value) || 0);
    }, 0);

  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
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
          access_token: token, // 👈 IMPORTANTE
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

  console.log("📅 Procesando día:", day);

  for (const page of pages) {
    const fbPageId = page.id_page; // Facebook Page ID
    const dbPageId = page.id;      // ID interno
    const token = page.token;      // 👈 TOKEN REAL DE ESA PÁGINA

    if (!fbPageId || !token) {
      console.log(`⚠️ FALTA DATA page ${dbPageId}`);
      continue;
    }

    console.log(`📊 Procesando página ${dbPageId}`);

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
      console.log(`⏭️ YA EXISTE ${dbPageId}`);
      continue;
    }

    // =========================
    // 📊 MÉTRICAS
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      token,
      "page_impressions_unique",
      day,
      day
    );

    const engagement = await getMetric(
      fbPageId,
      token,
      "page_engaged_users",
      day,
      day
    );

    const reactions = await getMetric(
      fbPageId,
      token,
      "page_actions_post_reactions_total",
      day,
      day
    );

    const share = await getShares(fbPageId, token);

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

    console.log(`✅ INSERT OK ${dbPageId}`);
  }
}

main();
