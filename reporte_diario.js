const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const FACEBOOK_TOKEN = process.env.PAGE_TOKEN;

// =========================
// 🇨🇺 FECHA CUBA
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs);
}

// =========================
// 📅 FORMATEAR FECHA
// =========================
function formatDate(d) {
  return d.toISOString().split("T")[0];
}

// =========================
// 📊 METRICS META (CORREGIDO)
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
          access_token: FACEBOOK_TOKEN,
        },
      }
    );

    const values = res.data?.data?.[0]?.values || [];

    if (!values.length) return 0;

    return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);
  } catch (err) {
    console.log("METRIC ERROR:", metric, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES
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
  } catch {}

  return total;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const today = getCubaDate();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dayStr = formatDate(yesterday);

  // rango real (Meta funciona mejor así)
  const since = dayStr;
  const until = dayStr;

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;

    if (!fbPageId) continue;

    // =========================
    // 🔍 evitar duplicados
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", dayStr)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ YA EXISTE ${dbPageId} ${dayStr}`);
      continue;
    }

    // =========================
    // 📊 MÉTRICAS (CORREGIDAS)
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
      fecha: dayStr,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT ${dbPageId} ${dayStr}`);
  }
}

main();
