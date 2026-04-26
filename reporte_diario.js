const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs);
}

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
    console.log("METRIC ERROR", metric);
    return 0;
  }
}

async function getTotalShares(pageId, token) {
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
    console.log("SHARE ERROR");
  }

  return total;
}

function generateDays(start, end) {
  const days = [];
  const d = new Date(start);

  while (d <= end) {
    days.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 1);
  }

  return days;
}

async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const token = process.env.PAGE_TOKEN;

  if (!token) {
    console.log("PAGE_TOKEN NO EXISTE");
    process.exit(1);
  }

  const today = getCubaDate();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startDate = new Date("2026-03-01");

  const days = generateDays(startDate, yesterday);

  for (const day of days) {
    for (const page of pages) {
      const fbPageId = page.id_page;
      const dbPageId = page.id;

      if (!fbPageId) continue;

      const exists = await supabase
        .from("reporte_diario")
        .select("id_record")
        .eq("pagina", dbPageId)
        .eq("fecha", day)
        .maybeSingle();

      if (exists.data) continue;

      console.log("Procesando", dbPageId, day);

      const impresiones = await getMetric(
        fbPageId,
        token,
        "page_impressions_unique",
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

      const engagement = await getMetric(
        fbPageId,
        token,
        "page_post_engagements",
        day,
        day
      );

      const share = await getTotalShares(fbPageId, token);

      await supabase.from("reporte_diario").insert({
        pagina: dbPageId,
        impresiones,
        reaction: reactions,
        engagement,
        share,
        engagement_real: engagement,
        fecha: day,
        created_at: new Date().toISOString(),
      });

      console.log("OK", dbPageId, day);
    }
  }
}

main();
