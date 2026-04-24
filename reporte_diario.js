const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs)
    .toISOString()
    .split("T")[0];
}

// =========================
// 📊 METRICS META (ACUMULADO)
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
    return values.reduce((s, d) => s + (d.value || 0), 0);
  } catch {
    return 0;
  }
}

// =========================
// 🔥 SHARE TOTAL ACUMULADO
// =========================
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
  } catch {}

  return total;
}

// =========================
// 🚀 MAIN (ACUMULADO)
// =========================
async function main() {

  const { data: services } = await supabase.from("pages_services").select("*");
  const { data: pages } = await supabase.from("pages").select("*");
  const { data: postsProgramados } = await supabase.from("post_programados_fb").select("*");

  const today = getCubaDate();

  for (const service of services) {

    const page = pages.find(p => p.nombre === service.Nombre_pagina);
    if (!page) continue;

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    const startDate = service.fecha_inicio_explotacion;

    try {

      // =========================
      // 📊 MÉTRICAS ACUMULADAS
      // =========================
      const impresiones = await getMetric(pageId, token, "page_impressions_unique", startDate, today);
      const reactions = await getMetric(pageId, token, "page_actions_post_reactions_like_total", startDate, today);
      const engagement = await getMetric(pageId, token, "page_post_engagements", startDate, today);

      // =========================
      // 🧠 POSTS ACUMULADOS
      // =========================
      const totalPosts = postsProgramados
        .filter(p =>
          p.pagina === service.Nombre_pagina &&
          new Date(p.fecha_inicio) <= new Date(today)
        )
        .reduce((s, p) => {
          const inicio = new Date(p.fecha_inicio);
          const fin = p.fecha_final ? new Date(p.fecha_final) : new Date(today);

          const dias = Math.max(
            0,
            Math.floor((Math.min(fin, new Date(today)) - inicio) / (1000 * 60 * 60 * 24)) + 1
          );

          return s + (dias * p.post_diarios);
        }, 0);

      // =========================
      // 🔥 SHARE ACUMULADO
      // =========================
      const share = await getTotalShares(pageId, token);

      // =========================
      // 🧾 INSERT / UPDATE ACUMULADO
      // =========================
      const { data: existing } = await supabase
        .from("reporte_diario_acumulado")
        .select("id_record")
        .eq("pagina", service.Nombre_pagina)
        .maybeSingle();

      const payload = {
        pagina: service.Nombre_pagina,
        fecha: today,
        impresiones,
        reaction: reactions,
        engagement,
        engagement_real: engagement,
        share,
        post: totalPosts,
        created_at: new Date().toISOString()
      };

      if (!existing) {
        await supabase.from("reporte_diario_acumulado").insert(payload);
        console.log(`📊 INSERT ACUMULADO ${service.Nombre_pagina}`);
      } else {
        await supabase
          .from("reporte_diario_acumulado")
          .update(payload)
          .eq("pagina", service.Nombre_pagina);

        console.log(`🔄 UPDATE ACUMULADO ${service.Nombre_pagina}`);
      }

    } catch (err) {
      console.log(`❌ ERROR ${service.Nombre_pagina}:`, err.message);
    }
  }
}

main();
