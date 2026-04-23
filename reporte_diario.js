const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📅 Día actual
const today = new Date().toISOString().split("T")[0];

// 🔹 INSIGHTS STABLE
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

    return values.reduce((sum, d) => sum + (d.value || 0), 0);
  } catch (err) {
    console.error(
      `❌ INSIGHT ERROR (${metric})`,
      err.response?.data || err.message
    );
    return 0;
  }
}

// 🚀 MAIN
async function main() {
  // 📦 servicios activos
  const { data: services, error: err1 } = await supabase
    .from("pages_services")
    .select("*");

  if (err1) {
    console.error("Supabase services error:", err1);
    return;
  }

  // 📦 páginas con credenciales
  const { data: pages, error: err2 } = await supabase
    .from("pages")
    .select("*");

  if (err2) {
    console.error("Supabase pages error:", err2);
    return;
  }

  for (const service of services) {
    // 🔥 match por nombre
    const page = pages.find(
      (p) => p.nombre === service.Nombre_pagina
    );

    if (!page) {
      console.log("❌ No existe en pages:", service.Nombre_pagina);
      continue;
    }

    const pageId = page.id_page;
    const token = page.token; // ✅ FIX DEFINITIVO

    // 🧨 validación extra
    if (!pageId || !token) {
      console.log("❌ Página incompleta:", service.Nombre_pagina);
      continue;
    }

    try {
      // 📊 métricas del día
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

      console.log(`📊 ${service.Nombre_pagina}`, {
        impressions,
        reactions,
        engagement,
      });

      // 💾 insert diario
      const { error: insertError } = await supabase
        .from("reporte_diario")
        .insert({
          pagina: service.Nombre_pagina,
          impresiones: impressions,
          reaction: reactions,
          engagement: engagement,
          share: 0,
          engagement_real: engagement,
          fecha: today,
        });

      if (insertError) {
        console.error("INSERT ERROR:", insertError);
      }

    } catch (err) {
      console.error(
        `❌ Error en ${service.Nombre_pagina}:`,
        err.response?.data || err.message
      );
    }
  }
}

main();
