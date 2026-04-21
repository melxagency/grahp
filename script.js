const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🎯 CLIENTE
const CLIENTE = "Puente Cargo";

// 📊 METRICAS META
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

// 🔁 SHARES
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

// 📅 DÍAS
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

  const { data, error } = await supabase
    .from("pages_clientes")
    .select("*")
    .eq("cliente", CLIENTE);

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  const first = data[0];

  // 📌 POST DIARIOS GLOBAL
  const post_diarios = data.reduce(
    (sum, p) => sum + (p.post_programados_diarios || 0),
    0
  );

  const days = getDays(first.fecha_inicio, first.fecha_termino);

  const id_reporte = Date.now() + Math.floor(Math.random() * 1000);

  for (const day of days) {

    const since = day;
    const untilDate = new Date(day);
    untilDate.setDate(untilDate.getDate() + 1);
    const until = untilDate.toISOString().split("T")[0];

    let totalImpressions = 0;
    let totalEngagement = 0;
    let totalShares = 0;

    for (const row of data) {
      try {

        const impressions = await getMetric(
          row.id_page,
          row.token_page,
          "page_impressions_unique",
          since,
          until
        );

        const engagement = await getMetric(
          row.id_page,
          row.token_page,
          "page_post_engagements",
          since,
          until
        );

        const shares = await getTotalShares(
          row.id_page,
          row.token_page,
          since,
          until
        );

        totalImpressions += impressions;
        totalEngagement += engagement;
        totalShares += shares;

      } catch (err) {
        console.error(`Error page ${row.id_page} ${day}:`, err.response?.data || err.message);
      }
    }

    const engagement_real = totalEngagement - totalShares;

    // 🔥 PROMEDIOS
    const promedio_impresiones_post =
      Math.round(totalImpressions / (post_diarios || 1)); // 👈 ENTERO

    const promedio_engagement_real_post =
      Number((engagement_real / (post_diarios || 1)).toFixed(4)); // 👈 4 decimales

    console.log(`TOTAL ${day}`, {
      totalImpressions,
      totalEngagement,
      totalShares,
      engagement_real,
      post_diarios
    });

    const { error: insertError } = await supabase
      .from("reportes")
      .upsert(
        {
          id_reporte,
          fecha: day,
          cliente: CLIENTE,

          Impresiones: totalImpressions,
          reactions: 0,
          shares: totalShares,
          engagement: totalEngagement,
          engagement_real,

          post_diarios,

          promedio_impresiones_post,
          promedio_engagement_real_post
        },
        {
          onConflict: "cliente, fecha"
        }
      );

    if (insertError) {
      console.error("INSERT ERROR:", insertError);
    }
  }
}

main();
