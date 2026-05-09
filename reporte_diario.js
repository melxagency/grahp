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

async function getShares(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
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
    console.log("❌ SHARE ERROR:", err.response?.data?.error?.message || err.message);
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

    for (const day of diasFaltantes) {
      const until = nextDay(day);

      const impresiones = await getMetric(fbId, token, "page_views_total", day, until);
      await sleep(300);
      const reactions = await getReactions(fbId, token, day, until);
      await sleep(300);
      const share = await getShares(fbId, token, day, until);
      await sleep(300);
      const engagement = await getMetric(fbId, token, "page_post_engagements", day, until);
      await sleep(500);

      console.log(`📈 ${dbId} → ${day}`, { impresiones, reactions, share, engagement });

      const { error } = await supabase.from("reporte_diario").insert({
        pagina: dbId,
        impresiones,
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
