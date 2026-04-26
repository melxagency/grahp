const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 AYER (CUBA REAL)
// =========================
function getYesterdayCuba() {
  const now = new Date();

  // Cuba UTC-5
  const cubaNow = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  cubaNow.setDate(cubaNow.getDate() - 1);

  const date = cubaNow.toISOString().split("T")[0];

  return {
    since: `${date}T00:00:00`,
    until: `${date}T23:59:59`,
    date,
  };
}

// =========================
// 📊 METRICAS INSIGHTS
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

    return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 REACTIONS REALES
// =========================
async function getReactions(pageId, token) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/posts`,
      {
        params: {
          fields: "reactions.summary(true)",
          limit: 100,
          access_token: token,
        },
      }
    );

    let total = 0;

    for (const post of res.data.data || []) {
      total += post.reactions?.summary?.total_count || 0;
    }

    return total;
  } catch (err) {
    console.log("❌ REACTIONS ERROR:", err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔗 SHARES REALES
// =========================
async function getShares(pageId, token) {
  try {
    let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
    let total = 0;

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

    return total;
  } catch (err) {
    console.log("❌ SHARE ERROR:", err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages, error } = await supabase
    .from("pages")
    .select("*");

  if (error) {
    console.log("❌ SUPABASE ERROR:", error.message);
    return;
  }

  const { since, until, date } = getYesterdayCuba();

  console.log("📅 Día:", date);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;
    const token = page.token;

    if (!fbPageId || !token) continue;

    console.log(`📊 Página ${dbPageId}`);

    // =========================
    // ❌ EVITAR DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id")
      .eq("pagina", dbPageId)
      .eq("fecha", date)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ Ya existe ${dbPageId}`);
      continue;
    }

    // =========================
    // 📊 METRICS BASE
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
      "page_engaged_users",
      since,
      until
    );

    const clicks = await getMetric(
      fbPageId,
      token,
      "page_consumptions",
      since,
      until
    );

    // =========================
    // 🔥 REACTIONS + SHARES
    // =========================
    const reactions = await getReactions(fbPageId, token);
    const share = await getShares(fbPageId, token);

    // =========================
    // 📊 RATE ENGAGEMENT
    // =========================
    const rate_engagement =
      impresiones > 0 ? (engagement / impresiones) * 100 : 0;

    const result = {
      impresiones,
      engagement,
      reactions,
      share,
      clicks,
      rate_engagement: Number(rate_engagement.toFixed(2)),
    };

    console.log("📈", result);

    // =========================
    // 💾 INSERT
    // =========================
    const { error: insertError } = await supabase
      .from("reporte_diario")
      .insert({
        pagina: dbPageId,
        fecha: date,
        impresiones,
        engagement,
        reactions,
        share,
        clicks,
        rate_engagement: result.rate_engagement,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.log("❌ INSERT ERROR:", insertError.message);
    } else {
      console.log(`✅ INSERT ${dbPageId}`);
    }
  }
}

main();
