const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// 🔌 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📅 Hoy
const today = new Date().toISOString().split("T")[0];

// 🔧 Normalizar strings (IMPORTANTE)
function normalize(str) {
  return str
    ?.toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// 🔹 INSIGHTS
async function getMetric(pageId, token, metric, since, until) {
  const url = `https://graph.facebook.com/v19.0/${pageId}/insights`;

  const res = await axios.get(url, {
    params: {
      metric,
      period: "day",
      since,
      until,
      access_token: token,
    },
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
        access_token: token,
      },
    });

    const posts = res.data.data || [];

    for (const post of posts) {
      totalShares += post.shares?.count || 0;
    }

    url = res.data.paging?.next || null;
  }

  return totalShares;
}

// 🚀 MAIN
async function main() {
  try {
    // 1️⃣ Servicios activos
    const { data: services, error: err1 } = await supabase
      .from("pages_services")
      .select("*");

    if (err1) throw err1;

    const activePages = services.filter((s) => {
      const start = s.fecha_inicio_explotacion;
      const end = s.fecha_termino_explotacion;

      return start <= today && (!end || end > today);
    });

    // 2️⃣ Páginas (tokens reales)
    const { data: pages, error: err2 } = await supabase
      .from("pages")
      .select("*");

    if (err2) throw err2;

    // 🔁 Loop
    for (const service of activePages) {
      const page = pages.find(
        (p) => normalize(p.nombre) === normalize(service.Nombre_pagina)
      );

      if (!page) {
        console.log("❌ No se encontró token:", service.Nombre_pagina);
        continue;
      }

      const pageId = page.id_page;
      const token = page.token_page;

      try {
        // 🚫 evitar duplicados
        const { data: existing } = await supabase
          .from("reporte_diario")
          .select("id_record")
          .eq("pagina", service.Nombre_pagina)
          .eq("fecha", today)
          .maybeSingle();

        if (existing) {
          console.log("⚠️ Ya existe:", service.Nombre_pagina);
          continue;
        }

        // 📊 métricas
        const impressions = await getMetric(
          pageId,
          token,
          "page_impressions_unique",
          today,
          today
        );

        const reactions = await getMetric(
          pageId,
          token,
          "page_actions_post_reactions_like_total",
          today,
          today
        );

        const engagement = await getMetric(
          pageId,
          token,
          "page_post_engagements",
          today,
          today
        );

        const shares = await getTotalShares(
          pageId,
          token,
          today,
          today
        );

        console.log(`✅ Insertando ${service.Nombre_pagina}`, {
          impressions,
          reactions,
          engagement,
          shares,
        });

        // 💾 INSERT
        const { error: insertError } = await supabase
          .from("reporte_diario")
          .insert({
            pagina: service.Nombre_pagina,
            impresiones: impressions,
            reaction: reactions,
            share: shares,
            engagement: engagement,
            engagement_real: engagement,
            fecha: today,
          });

        if (insertError) {
          console.error("❌ Insert error:", insertError);
        }
      } catch (err) {
        console.error(
          `❌ Error en ${service.Nombre_pagina}:`,
          err.response?.data || err.message
        );
      }
    }

    console.log("🚀 Proceso terminado");
  } catch (err) {
    console.error("❌ Error general:", err);
  }
}

main();
