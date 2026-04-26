const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function getYesterdayCuba() {
  const now = new Date();
  const cubaOffset = -5 * 60 * 60 * 1000;
  const cuba = new Date(now.getTime() + cubaOffset);
  cuba.setDate(cuba.getDate() - 1);
  return cuba.toISOString().split("T")[0];
}

async function getMetric(pageId, token, metric, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v21.0/${pageId}/insights`,
      {
        params: { metric, period: "day", since, until, access_token: token },
      }
    );
    const values = res.data.data?.[0]?.values || [];
    return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

async function getShares(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let total = 0;
  try {
    while (url) {
      const res = await axios.get(url, {
        params: { fields: "shares,created_time", limit: 100, since, until, access_token: token },
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

async function main() {
  const { data: pages } = await supabase.from("pages").select("*");
  const day = getYesterdayCuba();
  console.log("📅 Día:", day);

  for (const page of pages) {
    const fbId = page.id_page;
    const dbId = page.id;
    const token = page.token;

    if (!fbId || !token) continue;

    console.log(`📊 Página ${dbId}`);

    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id")
      .eq("pagina", dbId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ Ya existe ${dbId}`);
      continue;
    }

    const impresiones = await getMetric(fbId, token, "page_impressions_unique", day, day);
    const reactions = await getMetric(fbId, token, "page_actions_post_reactions_like_total", day, day);
    const share = await getShares(fbId, token, day, day);

    console.log("📈", { impresiones, reactions, share });

    const { error } = await supabase.from("reporte_diario").insert({
      pagina: dbId,
      impresiones,
      reaction: reactions,
      share,
      fecha: day,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.log("❌ INSERT ERROR:", error);
    } else {
      console.log(`✅ INSERT ${dbId}`);
    }
  }
}

main();
