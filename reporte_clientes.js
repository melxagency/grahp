const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const CLIENTE = "Puente Cargo";

// =========================
// 📊 METRICAS (SERIE DIARIA)
// =========================
async function getMetricSeries(pageId, token, metric, since, until) {
  const res = await axios.get(
    `https://graph.facebook.com/v19.0/${pageId}/insights`,
    {
      params: {
        metric,
        period: "day",
        since,
        until,
        access_token: token
      }
    }
  );

  return res.data.data?.[0]?.values || [];
}

// =========================
// 🔥 POSTS + REACTIONS + SHARES (CORRECTO)
// =========================
async function getPostStats(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;

  const sharesMap = {};
  const reactionsMap = {};

  const posts = [];

  // 1. traer posts
  while (url) {
    const res = await axios.get(url, {
      params: {
        fields: "id,created_time,shares",
        since,
        until,
        limit: 100,
        access_token: token
      }
    });

    posts.push(...(res.data.data || []));
    url = res.data.paging?.next || null;
  }

  // 2. reactions por post (CORRECTO)
  await Promise.all(
    posts.map(async (post) => {
      try {
        const r = await axios.get(
          `https://graph.facebook.com/v19.0/${post.id}`,
          {
            params: {
              fields: "reactions.summary(true)",
              access_token: token
            }
          }
        );

        const day = post.created_time.split("T")[0];

        const reactions =
          r.data?.reactions?.summary?.total_count || 0;

        const shares = post.shares?.count || 0;

        sharesMap[day] = (sharesMap[day] || 0) + shares;
        reactionsMap[day] = (reactionsMap[day] || 0) + reactions;

      } catch (err) {
        console.error("POST ERROR:", post.id, err.message);
      }
    })
  );

  return { sharesMap, reactionsMap };
}

// =========================
function getDays(start, end) {
  const days = [];
  let current = new Date(start);
  const last = new Date(end);

  while (current <= last) {
    days.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data, error } = await supabase
    .from("pages_clientes")
    .select("*")
    .eq("cliente", CLIENTE);

  if (error) return console.error(error);
  if (!data.length) return console.log("No data");

  const first = data[0];
  const days = getDays(first.fecha_inicio, first.fecha_termino);

  const id_reporte = Date.now() + Math.floor(Math.random() * 1000);

  const post_diarios = data.reduce(
    (sum, p) => sum + (p.post_programados_diarios || 0),
    0
  );

  const daily = {};

  // =========================
  // 📊 RECOLECCIÓN
  // =========================
  for (const row of data) {
    try {
      const impressionsSeries = await getMetricSeries(
        row.id_page,
        row.token_page,
        "page_impressions_unique",
        first.fecha_inicio,
        first.fecha_termino
      );

      const engagementSeries = await getMetricSeries(
        row.id_page,
        row.token_page,
        "page_post_engagements",
        first.fecha_inicio,
        first.fecha_termino
      );

      const { sharesMap, reactionsMap } = await getPostStats(
        row.id_page,
        row.token_page,
        first.fecha_inicio,
        first.fecha_termino
      );

      // impresiones
      for (const item of impressionsSeries) {
        const day = item.end_time.split("T")[0];
        if (!daily[day]) daily[day] = { imp: 0, eng: 0, sha: 0, rea: 0 };
        daily[day].imp += item.value || 0;
      }

      // engagement
      for (const item of engagementSeries) {
        const day = item.end_time.split("T")[0];
        if (!daily[day]) daily[day] = { imp: 0, eng: 0, sha: 0, rea: 0 };
        daily[day].eng += item.value || 0;
      }

      // shares
      for (const day in sharesMap) {
        if (!daily[day]) daily[day] = { imp: 0, eng: 0, sha: 0, rea: 0 };
        daily[day].sha += sharesMap[day];
      }

      // reactions
      for (const day in reactionsMap) {
        if (!daily[day]) daily[day] = { imp: 0, eng: 0, sha: 0, rea: 0 };
        daily[day].rea += reactionsMap[day];
      }

    } catch (err) {
      console.error("PAGE ERROR:", err.message);
    }
  }

  // =========================
  // 💾 INSERT
  // =========================
  for (const day of days) {
    const d = daily[day] || { imp: 0, eng: 0, sha: 0, rea: 0 };

    const engagement_real = d.eng - d.sha;

    const promedio_impresiones_post = Math.round(
      post_diarios ? d.imp / post_diarios : 0
    );

    const promedio_engagement_real_post = Number(
      (post_diarios ? engagement_real / post_diarios : 0).toFixed(4)
    );

    console.log("TOTAL", day, {
      imp: d.imp,
      eng: d.eng,
      shares: d.sha,
      reactions: d.rea,
      engagement_real,
      post_diarios
    });

    const { error } = await supabase.from("reportes").upsert(
      {
        id_reporte,
        fecha: day,
        cliente: CLIENTE,

        Impresiones: d.imp,
        reactions: d.rea,   // ✔ YA FUNCIONA
        shares: d.sha,
        engagement: d.eng,
        engagement_real,

        post_diarios,

        promedio_impresiones_post,
        promedio_engagement_real_post
      },
      { onConflict: "cliente, fecha" }
    );

    if (error) console.error("INSERT ERROR:", error);
  }

  // =========================
  // 🚀 EDGE FUNCTION PDF
  // =========================
  try {
    await axios.post(
      "https://cqwdrsxcylkvlscvggwt.supabase.co/functions/v1/reporte_clientes",
      { id_reporte },
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("📄 PDF GENERADO OK");
  } catch (err) {
    console.error("EDGE ERROR:", err.message);
  }
}

main();
