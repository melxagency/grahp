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
// 📅 FECHA AYER (CUBA)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffset = -5 * 60 * 60 * 1000;
  const cubaNow = new Date(now.getTime() + cubaOffset);
  cubaNow.setDate(cubaNow.getDate() - 1);
  return cubaNow.toISOString().split("T")[0];
}

// =========================
// 📊 METRIC HELPER
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
    return values.reduce((a, b) => a + (Number(b.value) || 0), 0);
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 REACTIONS REALES (likes, love, wow...)
// =========================
async function getReactions(pageId, token) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let reactions = {
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
          fields: "reactions.type(LIKE).summary(total_count).as(like),"
                + "reactions.type(LOVE).summary(total_count).as(love),"
                + "reactions.type(WOW).summary(total_count).as(wow),"
                + "reactions.type(HAHA).summary(total_count).as(haha),"
                + "reactions.type(SAD).summary(total_count).as(sad),"
                + "reactions.type(ANGRY).summary(total_count).as(angry)",
          limit: 100,
          access_token: token,
        },
      });

      for (const post of res.data.data || []) {
        reactions.like += post.like?.summary?.total_count || 0;
        reactions.love += post.love?.summary?.total_count || 0;
        reactions.wow += post.wow?.summary?.total_count || 0;
        reactions.haha += post.haha?.summary?.total_count || 0;
        reactions.sad += post.sad?.summary?.total_count || 0;
        reactions.angry += post.angry?.summary?.total_count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ REACTIONS ERROR:", err.response?.data || err.message);
  }

  return reactions;
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
    const pageId = page.id;
    const fbId = page.id_page;
    const token = page.token;

    if (!fbId || !token) continue;

    console.log(`📊 Página ${pageId}`);

    // =========================
    // evitar duplicados
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", pageId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ existe ${pageId}`);
      continue;
    }

    // =========================
    // METRICS
    // =========================
    const impresiones = await getMetric(
      fbId,
      token,
      "page_impressions_unique",
      day,
      day
    );

    const engagement = await getMetric(
      fbId,
      token,
      "page_engaged_users",
      day,
      day
    );

    const clicks = await getMetric(
      fbId,
      token,
      "page_consumptions_unique",
      day,
      day
    );

    const reactions = await getReactions(fbId, token);
    const share = await getShares(fbId, token);

    const totalReactions =
      reactions.like +
      reactions.love +
      reactions.wow +
      reactions.haha +
      reactions.sad +
      reactions.angry;

    // =========================
    // RATE ENGAGEMENT %
    // =========================
    const rate_engagement =
      impresiones > 0
        ? ((engagement + totalReactions) / impresiones) * 100
        : 0;

    const result = {
      impresiones,
      engagement,
      reactions: totalReactions,
      share,
      clicks,
      rate_engagement: Number(rate_engagement.toFixed(2)),
    };

    console.log("📈", result);

    // =========================
    // INSERT
    // =========================
    const { error } = await supabase.from("reporte_diario").insert({
      pagina: pageId,
      fecha: day,
      impresiones,
      engagement,
      reactions: totalReactions,
      share,
      clicks,
      rate_engagement,
      engagement_real: engagement,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.log("❌ INSERT ERROR:", error.message);
    } else {
      console.log(`✅ INSERT ${pageId}`);
    }
  }
}

main();
