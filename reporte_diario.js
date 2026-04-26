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
  return new Date(now.getTime() + cubaOffsetMs);
}

// =========================
// 📊 METRICS META
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
    return values.reduce((s, d) => s + (Number(d.value) || 0), 0);
  } catch (err) {
    return 0;
  }
}

// =========================
// 🔥 SHARE TOTAL POSTS
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
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const today = getCubaDate();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // =========================
  // 📦 TRAER CONTRATOS ACTIVOS
  // =========================
  const { data: contratos } = await supabase
    .from("contratos_servicios")
    .select("*");

  const contratosActivos = contratos.filter((c) => {
    const ini = new Date(c.fecha_inicio);
    const fin = new Date(c.fecha_termino);
    const y = new Date(yesterdayStr);

    return ini <= y && fin >= y;
  });

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;
    const token = page.token;

    if (!fbPageId || !token) continue;

    // =========================
    // 🔍 VALIDAR CONTRATO ACTIVO
    // =========================
    const tieneContrato = contratosActivos.some(
      (c) => c.id_cliente === page.id_cliente
    );

    if (!tieneContrato) {
      console.log(`⏭️ SIN CONTRATO ${dbPageId}`);
      continue;
    }

    // =========================
    // 🔍 EVITAR DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", yesterdayStr)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ YA EXISTE ${dbPageId}`);
      continue;
    }

    // =========================
    // 📊 DATOS SOLO AYER
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      token,
      "page_impressions_unique",
      yesterdayStr,
      yesterdayStr
    );

    const reactions = await getMetric(
      fbPageId,
      token,
      "page_actions_post_reactions_like_total",
      yesterdayStr,
      yesterdayStr
    );

    const engagement = await getMetric(
      fbPageId,
      token,
      "page_post_engagements",
      yesterdayStr,
      yesterdayStr
    );

    const share = await getTotalShares(fbPageId, token);

    // =========================
    // 💾 INSERT
    // =========================
    await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      impresiones,
      reaction: reactions,
      engagement,
      share,
      engagement_real: engagement,
      fecha: yesterdayStr,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT ${dbPageId}`);
  }
}

main();
