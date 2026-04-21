const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function getImpressions(pageId, token, since, until) {
  const url = `https://graph.facebook.com/v19.0/${pageId}/insights`;

  const res = await axios.get(url, {
    params: {
      metric: "page_impressions_unique",
      period: "day",
      since,
      until,
      access_token: token
    }
  });

  const values = res.data.data?.[0]?.values || [];

  return values.reduce((sum, d) => sum + (d.value || 0), 0);
}

async function main() {
  const { data, error } = await supabase
    .from("pages_clientes")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  for (const row of data) {
    const total = await getImpressions(
      row.id_page,
      row.token_page,
      row.fecha_inicio,
      row.fecha_termino
    );

    console.log(`Page ${row.id_page} -> ${total}`);

    await supabase
      .from("pages_clientes")
      .update({ Impresiones: total })
      .eq("id", row.id);
  }
}

main();
