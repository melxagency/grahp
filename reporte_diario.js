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

function toUnix(dateStr) {
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
}

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

function generateDays(start, end) {
  const days = [];
  const current = new Date(start);
  while (current <= end) {
    days.push(new Date(current).toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

async function getMetric(pageId, token, metric, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since: toUnix(since),
          until: toUnix(until),
          access_token: token,
        },
      }
    );

    const data = res.data?.data || [];
    if (!data.length) return 0;

    let total = 0;
    for (const entry of data) {
      const values = entry.values || [];
      for (const v of values) {
        if (typeof v.value === "object" && v.value !== null) {
          total += Object.values(v.value).reduce((s, n) => s + (Number(n) || 0), 0);
        } else {
          total += Number(v.value) || 0;
        }
      }
    }
    return total;
  } catch (err) {
    console.error(`❌ Error en métrica ${metric} (página ${pageId}):`, err.response?.data?.error || err.message);
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
      for (const post of res.data?.data || []) {
        total += post.shares?.count || 0;
      }
      url = res.data?.paging?.next || null;
    }
  } catch (err) {
    console.error(`❌ Error en shares (página ${pageId}):`, err.response?.data?.error || err.message);
  }
  return total;
}

async function main() {
  const { data: pages, error: pagesError } = await supabase.from("pages").select("*");

  if (pagesError || !pages?.length) {
    console.error("❌ No se pudieron cargar las páginas:", pagesError);
    return;
  }

  const today = getCubaDate();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startDate = new Date("2026-03-01");
  const days = generateDays(startDate, yesterday);

  console.log(`📅 Procesando ${days.length} días para ${pages.length} páginas...`);

  for (const day of days) {
    const until = nextDay(day);

    for (const page of pages) {
      const fbPageId = page.id_page;
      const dbPageId = page.id;
      const token = page.token;

      if (!fbPageId || !token) {
        console.warn(`⚠️ Página ${dbPageId} sin id_page o token, saltando...`);
        continue;
      }

      const { data: exists } = await supabase
        .from("reporte_diario")
        .select("id_record")
        .eq("pagina", dbPageId)
        .eq("fecha", day)
        .maybeSingle();

      if (exists) {
        console.log(`⏭️  ${dbPageId} → ${day} ya existe, saltando...`);
        continue;
      }

      const [impresiones, reactions, engagement, reach, share] = await Promise.all([
        getMetric(fbPageId, token, "page_impressions", day, until),
        getMetric(fbPageId, token, "page_actions_post_reactions_like_total", day, until),
        getMetric(fbPageId, token, "page_post_engagements", day, until),
        getMetric(fbPageId, token, "page_impressions_unique", day, until),
        getTotalShares(fbPageId, token),
      ]);

      const { error: insertError } = await supabase.from("reporte_diario").insert({
        pagina: dbPageId,
        impresiones,
        reaction: reactions,
        engagement,
        share,
        reach,
        engagement_real: engagement,
        fecha: day,
        created_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error(`❌ Error insertando ${dbPageId} → ${day}:`, insertError.message);
      } else {
        console.log(`✅ ${dbPageId} → ${day} | imp:${impresiones} react:${reactions} eng:${engagement} reach:${reach} shares:${share}`);
      }
    }
  }

  console.log("🎉 Proceso completado.");
}

main();
