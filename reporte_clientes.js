const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🎯 CLIENTE POR DEFECTO
const CLIENTE = "Puente Cargo";

// 🔹 INSIGHTS
async function getMetric(pageId, token, metric, since, until) {
  const url = `https://graph.facebook.com/v19.0/${pageId}/insights`;

  const res = await axios.get(url, {
    params: {
      metric,
      period: "day",
      since,
      until,
      access_token: token
    }
  });

  const values = res.data.data?.[0]?.values || [];

  return values.reduce((sum, d) => sum + (d.value || 0), 0);
}

// 🔹 SHARES
async function getTotalShares(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let totalShares = 0;

  while (url) {
    const res = await axios.get(url, {
      params: {
        fields: "shares,created_time",
        since,
        until,
        limit: 100,
        access_token: token
      }
    });

    for (const post of res.data.data || []) {
      totalShares += post.shares?.count || 0;
    }

    url = res.data.paging?.next || null;
  }

  return totalShares;
}

// 📅 generar días
function getDays(start, end) {
  const days = [];
  let current = new Date(start);
  const last = new Date(end);

  while (current <= last) {
    days.push(new Date(current).toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

// 🚀 MAIN
async function main() {

  // 🔍 buscar páginas del cliente
  const { data, error } = await supabase
    .from("pages_clientes")
    .select("*")
    .eq("cliente", CLIENTE);

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  if (!data.length) {
    console.log("No pages found for client");
    return;
  }

  const id_reporte = Math.floor(Math.random() * 1e9);

  const first = data[0];
  const days = getDays(first.fecha_inicio, first.fecha_termino);

  for (const day of days) {

    let totalImpressions = 0;
    let totalEngagement = 0;
    let totalShares = 0;

    for (const row of data) {
      const pageId = row.id_page;
      const token = row.token_page;

      try {
        const impressions = await getMetric(
          pageId,
          token,
          "page_impressions_unique",
          day,
          day
        );

        const engagement = await getMetric(
          pageId,
          token,
          "page_post_engagements",
          day,
          day
        );

        const shares = await getTotalShares(
          pageId,
          token,
          day,
          day
        );

        totalImpressions += impressions;
        totalEngagement += engagement;
        totalShares += shares;

      } catch (err) {
        console.error(`Error page ${pageId} ${day}:`, err.response?.data || err.message);
      }
    }

    const engagement_real = totalEngagement - totalShares;

    console.log(`TOTAL ${day}`, {
      totalImpressions,
      totalEngagement,
      totalShares,
      engagement_real
    });

    // 💾 INSERT TOTAL POR DÍA
    const { error: insertError } = await supabase
      .from("reportes")
      .insert({
        id_reporte: id_reporte,
        fecha: day,
        cliente: CLIENTE,

        Impresiones: totalImpressions,
        reactions: 0,
        shares: totalShares,
        engagement: totalEngagement,
        engagement_real: engagement_real,

        post_programados_diarios: first.post_programados_diarios || 0,
        total_post: 0,
        total_real_post: 0,

        promedio_impresiones_post: 0,
        promedio_engagement_real_post: 0
      });

    if (insertError) {
      console.error("INSERT ERROR:", insertError);
    }
  }
}

main();
