const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    realtime: {
      transport: ws,
    },
  }
);

function getTodayCuba() {
  const now = new Date();
  const cubaOffset = -5 * 60 * 60 * 1000;
  const cuba = new Date(now.getTime() + cubaOffset);
  return cuba.toISOString().split("T")[0];
}

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

function prevDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function generateDays(start, end) {
  const days = [];
  const current = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (current <= last) {
    days.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMetric(pageId, token, metric, since, until, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v19.0/${pageId}/insights`,
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
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) {
        const wait = attempt * 3000;
        console.log(`⏳ Transient error en ${metric}, reintento ${attempt}/${retries} en ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        console.log(`❌ METRIC ERROR ${metric}:`, msg);
        return 0;
      }
    }
  }
  return 0;
}

async function getReactions(pageId, token, since, until, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v19.0/${pageId}/insights`,
        {
          params: {
            metric: "page_actions_post_reactions_total",
            period: "day",
            since,
            until,
            access_token: token,
          },
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
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) {
        const wait = attempt * 3000;
        console.log(`⏳ Transient error en reactions, reintento ${attempt}/${retries} en ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        console.log(`❌ REACTIONS ERROR:`, msg);
        return 0;
      }
    }
  }
  return 0;
}

async function getTotalSharesAcumulado(pageId, token) {
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
      for (const post of res.data?.data || []) {
        total += post.shares?.count || 0;
      }
      url = res.data?.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ SHARE ACUMULADO ERROR:", err.response?.data?.error?.message || err.message);
  }
  return total;
}

async function main() {
  const { data: pages, error: pagesError } = await supabase.from("pages").select("*");
  if (pagesError || !pages?.length) {
    console.log("❌ Error cargando páginas:", pagesError);
    return;
  }

  const { data: contratos, error: contratosError } = await supabase
    .from("contratos_servicios")
    .select("fecha_inicio")
    .order("fecha_inicio", { ascending: true })
    .limit(1);

  if (contratosError || !contratos?.length) {
    console.log("❌ Error cargando contratos:", contratosError);
    return;
  }

  const startDate = contratos[0].fecha_inicio.split("T")[0];
  const yesterday = getYesterdayCuba();
  const hoy = getTodayCuba();
  const allDays = generateDays(startDate, yesterday);

  console.log(`📅 Rango total: ${startDate} → ${yesterday} (${allDays.length} días)`);
  console.log(`📄 Páginas: ${pages.length}`);

  for (const page of pages) {
    const fbId = page.id_page;
    const dbId = page.id;
    const token = page.token;

    if (!fbId || !token) continue;

    const { data: registros } = await supabase
      .from("reporte_diario")
      .select("fecha")
      .eq("pagina", dbId);

    const fechasRegistradas = new Set((registros || []).map((r) => r.fecha));
    const diasFaltantes = allDays.filter((d) => !fechasRegistradas.has(d));

    if (!diasFaltantes.length) {
      console.log(`✅ Página ${dbId} completa, sin días faltantes`);
      continue;
    }

    console.log(`📊 Página ${dbId}: ${diasFaltantes.length} días faltantes`);

    // ✅ Obtener shares acumulados actuales
    const sharesAcumuladosHoy = await getTotalSharesAcumulado(fbId, token);
    await sleep(500);

    // ✅ Guardar acumulado con fecha de HOY (día de ejecución)
    const { data: acumuladoHoyExiste } = await supabase
      .from("acumulado_share_diarios")
      .select("id")
      .eq("id_pagina", dbId)
      .eq("fecha", hoy)
      .maybeSingle();

    if (!acumuladoHoyExiste) {
      await supabase.from("acumulado_share_diarios").insert({
        id_pagina: dbId,
        share: sharesAcumuladosHoy,
        fecha: hoy,
      });
      console.log(`📦 Acumulado shares guardado: página ${dbId} → ${hoy}: ${sharesAcumuladosHoy}`);
    }

    for (const day of diasFaltantes) {
      const until = nextDay(day);
      const dayPrev = prevDay(day);

      const impresiones = await getMetric(fbId, token, "page_impressions_unique", day, until);
      await sleep(300);
      const vistas_perfil = await getMetric(fbId, token, "page_views_total", day, until);
      await sleep(300);
      const reactions = await getReactions(fbId, token, day, until);
      await sleep(300);
      const engagement = await getMetric(fbId, token, "page_post_engagements", day, until);
      await sleep(300);

      // ✅ Calcular shares del día = acumulado día - acumulado día anterior
      const { data: acumuladoDia } = await supabase
        .from("acumulado_share_diarios")
        .select("share")
        .eq("id_pagina", dbId)
        .eq("fecha", day)
        .maybeSingle();

      const { data: acumuladoDiaAnterior } = await supabase
        .from("acumulado_share_diarios")
        .select("share")
        .eq("id_pagina", dbId)
        .eq("fecha", dayPrev)
        .maybeSingle();

      let share = 0;
      if (acumuladoDia && acumuladoDiaAnterior) {
        share = Math.max(0, acumuladoDia.share - acumuladoDiaAnterior.share);
      }

      await sleep(500);

      console.log(`📈 ${dbId} → ${day}`, { impresiones, vistas_perfil, reactions, share, engagement });

      const { error } = await supabase.from("reporte_diario").insert({
        pagina: dbId,
        impresiones,
        vistas_perfil,
        reaction: reactions,
        share,
        engagement,
        fecha: day,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.log(`❌ INSERT ERROR ${dbId} → ${day}:`, error.message);
      } else {
        console.log(`✅ OK ${dbId} → ${day}`);
      }
    }
  }

  console.log("🎉 Completado.");
}

main();
