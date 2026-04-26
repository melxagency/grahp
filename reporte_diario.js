const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const PAGE_TOKEN_GLOBAL = process.env.PAGE_TOKEN; // fallback opcional

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
// 📊 INSIGHTS METRICS
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
    return values.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 REACTIONS (SUMA REAL)
// =========================
async function getReactions(pageId, token, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric: "page_actions_post_reactions_total",
          period: "day",
          since,
          until,
          access_token: token,
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];

    let total = 0;

    for (const v of values) {
      const val = v.value;

      if (typeof val === "object") {
        total += Object.values(val).reduce((a, b) => a + (Number(b) || 0), 0);
      } else {
        total += Number(val) || 0;
      }
    }

    return total;
  } catch (err) {
    console.log("❌ REACTIONS ERROR:", err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES (POSTS)
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
    const token = page.token || PAGE_TOKEN_GLOBAL;

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
      console.log(`⏭️ Ya existe ${dbPageId}`);
      continue;
    }

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
      "page_post_engagements",
      day,
      day
    );

    const reactions = await getReactions(fbPageId, token, day, day);

    const share = await getShares(fbPageId, token);

    const result = {
      impresiones,
      engagement,
      reactions,
      share,
    };

    console.log("📈", result);

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
