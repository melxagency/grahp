const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// =========================
// SUPABASE
// =========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA (AYER)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffset = -5 * 60 * 60 * 1000;
  const cubaNow = new Date(now.getTime() + cubaOffset);
  cubaNow.setDate(cubaNow.getDate() - 1);
  return cubaNow.toISOString().split("T")[0];
}

// =========================
// 📊 METRICAS META (INSIGHTS)
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
// 🔥 REACCIONES (LIKES + REACTIONS)
// =========================
async function getReactions(pageId, token) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = {
    like: 0,
    love: 0,
    wow: 0,
    haha: 0,
    sad: 0,
    angry: 0,
  };

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "reactions.type(LIKE).summary(true).limit(0).as(like),"
                + "reactions.type(LOVE).summary(true).limit(0).as(love),"
                + "reactions.type(WOW).summary(true).limit(0).as(wow),"
                + "reactions.type(HAHA).summary(true).limit(0).as(haha),"
                + "reactions.type(SAD).summary(true).limit(0).as(sad),"
                + "reactions.type(ANGRY).summary(true).limit(0).as(angry)",
          limit: 100,
          access_token: token,
        },
      });

      for (const post of res.data.data || []) {
        total.like += post.like?.summary?.total_count || 0;
        total.love += post.love?.summary?.total_count || 0;
        total.wow += post.wow?.summary?.total_count || 0;
        total.haha += post.haha?.summary?.total_count || 0;
        total.sad += post.sad?.summary?.total_count || 0;
        total.angry += post.angry?.summary?.total_count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ REACTIONS ERROR:", err.response?.data || err.message);
  }

  return total;
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

    // =========================
    // EVITAR DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id")
      .eq("pagina", dbPageId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ Ya existe ${dbPageId}`);
      continue;
    }

    // =========================
    // MÉTRICAS BASE
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
      "page_post_engagements",
      day,
      day
    );

    const clicks = await getMetric(
      fbPageId,
      token,
      "page_consumptions",
      day,
      day
    );

    const reactions = await getReactions(fbPageId, token);
    const share = await getShares(fbPageId, token);

    const totalReactions =
      reactions.like +
      reactions.love +
      reactions.wow +
      reactions.haha +
      reactions.sad +
      reactions.angry;

    // =========================
    // RATE ENGAGEMENT (%)
    // =========================
    const rate_engagement =
      impresiones > 0
        ? Number(((engagement / impresiones) * 100).toFixed(2))
        : 0;

    const result = {
      impresiones,
      engagement,
      reactions: totalReactions,
      share,
      clicks,
      rate_engagement,
    };

    console.log("📈", result);

    // =========================
    // INSERT SUPABASE
    // =========================
    const { error } = await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      fecha: day,
      impresiones,
      engagement,
      reactions: totalReactions,
      share,
      clicks,
      rate_engagement,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.log("❌ INSERT ERROR:", error);
    } else {
      console.log(`✅ INSERT ${dbPageId}`);
    }
  }
}

main();
