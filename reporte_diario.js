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
  // ✅ Cargar páginas
  const { data: pages, error: pagesError } = await supabase.from("pages").select("*");
  if (pagesError || !pages?.length) {
    console.log("❌ Error cargando páginas:", pagesError);
    return;
  }

  // ✅ Buscar la fecha_inicio más lejana en contratos_servicios
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
  const days = generateDays(startDate, yesterday);

  console.log(`📅 Desde: ${startDate} → Hasta: ${yesterday} (${days.length} días)`);
  console.log(`📄 Páginas: ${pages.length}`);

  for (const day of days) {
    const until = nextDay(day);

    for (const page of pages) {
      const fbId = page.id_page;
      const dbId = page.id;
      const token = page.token;

      if (!fbId || !token) continue;

      // ✅ Solo insertar si no existe, nunca sobreescribir histórico
      const { data: exists } = await supabase
        .from("reporte_diario")
        .select("id_record")
        .eq("pagina", dbId)
        .eq("fecha", day)
        .maybeSingle();

      if (exists) {
        console.log(`⏭️  ${dbId} → ${day} ya existe`);
        continue;
      }

      const [impresiones, reactions, share, engagement] = await Promise.all([
        getMetric(fbId, token, "page_impressions_unique", day, until),
        getReactions(fbId, token, day, until),
        getShares(fbId, token, day, until),
        getMetric(fbId, token, "page_post_engagements", day, until),
      ]);

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
