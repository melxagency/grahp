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

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
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
    return values.reduce((sum, v) => {
      if (typeof v.value === "object" && v.value !== null) {
        return sum + Object.values(v.value).reduce((s, n) => s + (Number(n) || 0), 0);
      }
      return sum + (Number(v.value) || 0);
    }, 0);
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

async function getReactions(pageId, token, since, until) {
  const tipos = [
    "page_actions_post_reactions_like_total",
    "page_actions_post_reactions_love_total",
    "page_actions_post_reactions_wow_total",
    "page_actions_post_reactions_haha_total",
    "page_actions_post_reactions_sorry_total",
    "page_actions_post_reactions_anger_total",
  ];

  let total = 0;
  for (const metric of tipos) {
    total += await getMetric(pageId, token, metric, since, until);
  }
  return total;
}

async function getShares(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let total = 0;
  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "shares,created_time",
          limit: 100,
          since,
          until,
          access_token: token,
        },
      });
      const posts = res.data.data || [];
      for (const post of posts) {
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
  const until = nextDay(day);

  console.log(`📅 Procesando día: ${day} (until: ${until})`);

  for (const page of pages) {
    const fbId = page.id_page;
    const dbId = page.id;
    const token = page.token;

    if (!fbId || !token) continue;

    console.log(`📊 Página ${dbId}`);

    const [impresiones, reactions, share, engagement] = await Promise.all([
      getMetric(fbId, token, "page_impressions_unique", day, until),
      getReactions(fbId, token, day, until),
      getShares(fbId, token, day, until),
      getMetric(fbId, token, "page_post_engagements", day, until),
    ]);

    console.log("📈", { impresiones, reactions, share, engagement });

    const { error } = await supabase.from("reporte_diario").upsert(
      {
        pagina: dbId,
        impresiones,
        reaction: reactions,
        share,
        engagement,
        fecha: day,
        created_at: new Date().toISOString(),
      },
      { onConflict: "pagina,fecha" }
    );

    if (error) {
      console.log("❌ UPSERT ERROR:", error);
    } else {
      console.log(`✅ OK ${dbId} → ${day}`);
    }
  }

  console.log("🎉 Completado.");
}

main();
